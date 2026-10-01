import type { Frame, Page } from "playwright";
import { greenhouseJobAppFrame } from "../application/greenhouse.js";
import { answerBlockedField } from "../application/answer-blocked-field.js";
import { answerFreeText } from "../application/answer-question.js";
import { decideField, isNarrativeQuestion, type FieldContext } from "../application/field-map.js";
import { isPlatformQuestion, matchPlatforms } from "../application/media-answers.js";
import { candidate } from "../config/candidate.js";
import { log } from "../logging/logger.js";
import type { AnswerRecord, Persona } from "../models/types.js";

export type FormScope = Page | Frame;

export type DetectedField = {
  index: number;
  tag: string;
  type: string;
  label: string;
  name: string;
  id: string;
  required: boolean;
  options: string[];
  optionIndexes?: number[];
  groupLabel?: string;
};

export async function readFields(scope: FormScope): Promise<DetectedField[]> {
  const raw = await scope.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("input, textarea, select"));
    const fields: DetectedField[] = [];
    const textFromRefIds = (refIds: string | null) => {
      if (!refIds) {
        return "";
      }
      return refIds
        .split(/\s+/)
        .map((ref) => document.getElementById(ref)?.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean)
        .join(" ");
    };
    nodes.forEach((node, index) => {
      const el = node as HTMLInputElement;
      el.setAttribute("data-agent-field", String(index));
      const type = (el.getAttribute("type") || el.tagName).toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button") {
        return;
      }
      const id = el.id;
      const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
      const wrapped = el.closest("label")?.innerText ?? "";
      const aria = el.getAttribute("aria-label") ?? "";
      const labelledBy = textFromRefIds(el.getAttribute("aria-labelledby"));
      const describedBy = textFromRefIds(el.getAttribute("aria-describedby"));
      const container = el.closest(".field, .application-field, .form-group, .select__container, fieldset, [data-field]");
      const containerLabel = (container?.querySelector("label, legend, .label, .application-label, h3, h4")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      let raw = aria || labelledBy || labelFor || describedBy || containerLabel || el.placeholder || wrapped || el.name;
      if (!raw && /^question_/i.test(id)) {
        raw = container?.querySelector("label")?.textContent ?? "";
      }
      if (!raw && (type === "checkbox" || type === "radio")) {
        raw = el.getAttribute("value") ?? "";
      }
      const label = (raw || "").replace(/\s+/g, " ").trim().slice(0, 240);
      const labelRequired = label.includes("*");
      const options = el.tagName === "SELECT"
        ? Array.from((el as unknown as HTMLSelectElement).options).map((option) => (option.textContent || "").trim()).filter(Boolean)
        : [];
      const group = el.closest(".elementor-field-group, fieldset");
      const groupLabel = (group?.querySelector(".elementor-field-label, legend")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
      fields.push({
        index,
        tag: el.tagName.toLowerCase(),
        type,
        label,
        name: el.name || "",
        id: el.id || "",
        required: el.required || el.getAttribute("aria-required") === "true" || labelRequired,
        options,
        groupLabel,
      });
    });
    return fields;
  });
  const labeled = raw.map((field) => ({
    ...field,
    label: field.label || field.groupLabel || field.name,
  }));
  return groupCheckboxes(groupRadios(labeled));
}

function groupRadios(fields: DetectedField[]): DetectedField[] {
  const grouped: DetectedField[] = [];
  const radios = new Map<string, DetectedField[]>();
  for (const field of fields) {
    if (field.type === "radio" && field.name) {
      const list = radios.get(field.name) ?? [];
      list.push(field);
      radios.set(field.name, list);
      continue;
    }
    grouped.push(field);
  }
  for (const [name, group] of radios) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const questionLabel = group
      .map((field) => field.groupLabel)
      .find((value) => value && value.length > 3)
      ?? group.map((field) => field.label).find((value) => value && value.length > 12)
      ?? name;
    grouped.push({
      index: first.index,
      tag: "input",
      type: "radio",
      label: questionLabel,
      name,
      id: first.id,
      required: group.some((field) => field.required),
      options: group.map((field) => field.label),
      optionIndexes: group.map((field) => field.index),
    });
  }
  return grouped;
}

function groupCheckboxes(fields: DetectedField[]): DetectedField[] {
  const byName = new Map<string, DetectedField[]>();
  for (const field of fields) {
    if (field.type !== "checkbox" || !field.name) {
      continue;
    }
    const list = byName.get(field.name) ?? [];
    list.push(field);
    byName.set(field.name, list);
  }
  const emitted = new Set<string>();
  const grouped: DetectedField[] = [];
  for (const field of fields) {
    const group = field.type === "checkbox" && field.name ? byName.get(field.name) : undefined;
    if (!group || group.length < 2) {
      grouped.push(field);
      continue;
    }
    if (emitted.has(field.name)) {
      continue;
    }
    emitted.add(field.name);
    const label = group.map((item) => item.groupLabel).find((value) => value && value.length > 0) || field.name;
    grouped.push({
      index: group[0]?.index ?? field.index,
      tag: "input",
      type: "checkbox-group",
      label,
      name: field.name,
      id: group[0]?.id ?? field.id,
      required: /\*/.test(label) || group.some((item) => item.required),
      options: group.map((item) => item.label),
      optionIndexes: group.map((item) => item.index),
    });
  }
  return grouped;
}

export async function fillFields(input: {
  scope: FormScope;
  fields: DetectedField[];
  ctx: FieldContext;
  persona: Persona;
  jobText: string;
}): Promise<{ blockers: string[]; answers: AnswerRecord[] }> {
  const blockers: string[] = [];
  const answers: AnswerRecord[] = [];
  let phoneFilled = false;
  const platformField = input.fields.find((field) => field.type === "checkbox-group" && isPlatformQuestion(field.label, field.options));
  const platformPlan = platformField ? matchPlatforms(platformField.options, candidate.media.platforms) : null;
  const ctx: FieldContext = { ...input.ctx, otherPlatformsText: platformPlan?.otherText ?? "" };
  for (const field of input.fields) {
    if (/phone/i.test(field.label) && phoneFilled) {
      continue;
    }
    if (field.type === "file" || /recaptcha/i.test(field.name) || /recaptcha/i.test(field.label)) {
      continue;
    }
    if (field.type === "search" && !/country/i.test(`${field.label} ${field.groupLabel}`)) {
      continue;
    }
    const decision = decideField({
      label: field.label,
      name: field.name,
      id: field.id,
      groupLabel: field.groupLabel,
      required: field.required,
      type: field.tag === "textarea" ? "textarea" : field.type,
      options: field.options,
      ctx,
    });
    if (decision.action === "blank" || decision.action === "upload") {
      continue;
    }
    if (decision.action === "block") {
      const questionLabel = fieldQuestionLabel(field);
      const recovered = await answerBlockedField({
        question: questionLabel,
        fieldType: field.tag === "textarea" ? "textarea" : field.type,
        options: field.options,
        persona: input.persona,
        jobText: input.jobText,
        company: ctx.company ?? "",
        role: ctx.role ?? "",
        blockReason: decision.reason,
      });
      if (recovered) {
        try {
          await writeField(input.scope, field, recovered.value);
          answers.push({
            question: questionLabel,
            answer: recovered.value,
            source: recovered.learnedFactId ? `llm_learned:${recovered.learnedFactId}` : "llm_from_supported_facts",
          });
          log("FIELD_FILLED", { label: questionLabel, source: "llm_blocked_field_fallback" });
          continue;
        } catch (error) {
          const message = error instanceof Error ? error.message : "field_fill_failed";
          blockers.push(`LLM answer could not be written for "${questionLabel}": ${message}`);
        }
      } else {
        blockers.push(`No grounded answer (rules + LLM): ${decision.reason}`);
        log("REVIEW_REQUIRED", { question: questionLabel, reason: decision.reason });
      }
      continue;
    }
    if (decision.action === "llm") {
      if (!field.required && !isNarrativeQuestion(field.label)) {
        continue;
      }
      const answered = await answerFreeText({
        question: field.label,
        persona: input.persona,
        jobText: input.jobText,
        company: ctx.company ?? "",
        role: ctx.role ?? "",
      });
      if (!answered) {
        const reason = `Could not write a grounded answer for "${field.label}"`;
        blockers.push(reason);
        log("REVIEW_REQUIRED", { question: field.label, reason });
        continue;
      }
      await writeField(input.scope, field, answered.value);
      answers.push({ question: field.label, answer: answered.value, source: "llm_from_supported_facts" });
      log("FIELD_FILLED", { label: field.label, source: "llm_from_supported_facts" });
      continue;
    }
    if (decision.action === "check-options") {
      try {
        await checkOptions(input.scope, field, decision.values);
      } catch (error) {
        const message = error instanceof Error ? error.message : "checkbox_fill_failed";
        blockers.push(`Could not check required options for "${field.label}": ${message}`);
        log("VALIDATION_FAILED", { label: field.label, message });
        continue;
      }
      answers.push({ question: field.label, answer: decision.values.join(", "), source: decision.source });
      log("FIELD_FILLED", { label: field.label, source: decision.source });
      continue;
    }
    if (decision.action === "check") {
      await input.scope.locator(`[data-agent-field="${field.index}"]`).setChecked(true);
      answers.push({ question: field.label, answer: "checked", source: decision.source });
      continue;
    }
    const value = field.type === "number" && /salary|budget|compensation|שכר/i.test(field.label)
      ? digitsOnly(decision.value)
      : decision.value;
    try {
      await writeField(input.scope, field, value);
    } catch (error) {
      const message = error instanceof Error ? error.message : "field_fill_failed";
      if (field.required) {
        blockers.push(`Could not fill required field "${field.label}": ${message}`);
      }
      log("VALIDATION_FAILED", { label: field.label, message });
      continue;
    }
    answers.push({ question: field.label, answer: value, source: decision.source });
    log("FIELD_FILLED", { label: field.label, source: decision.source });
    if (/phone/i.test(field.label)) {
      phoneFilled = true;
    }
  }
  return { blockers, answers };
}

async function writeField(scope: FormScope, field: DetectedField, value: string): Promise<void> {
  if (field.type === "radio" && field.optionIndexes) {
    const matchAt = field.options.findIndex((option) => option.toLowerCase() === value.toLowerCase() || option.toLowerCase().includes(value.toLowerCase()));
    const optionIndex = field.optionIndexes[matchAt];
    if (matchAt < 0 || optionIndex === undefined) {
      throw new Error(`No radio option matching ${value}`);
    }
    await scope.locator(`[data-agent-field="${optionIndex}"]`).evaluate((element) => {
      (element as HTMLInputElement).click();
    });
    return;
  }
  const locator = scope.locator(`[data-agent-field="${field.index}"]`);
  const fieldBlob = `${field.name} ${field.id} ${field.label}`;
  if (/country_phone_code|phone_country_code|dial.code/i.test(fieldBlob)) {
    const prefer = field.options.find((option) => /\+972|^972|\(\+972\)|israel/i.test(option))
      ?? field.options.find((option) => /israel/i.test(option));
    const pick = prefer ?? value;
    if (field.tag === "select" && field.options.length > 0) {
      await locator.selectOption({ label: pick }).catch(async () => {
        await locator.selectOption({ value: pick });
      });
      return;
    }
    await locator.fill(pick);
    return;
  }
  if (field.id === "country" || (/country/i.test(field.label) && !/phone.code|country_phone/i.test(fieldBlob))) {
    const country = field.id === "country" ? scope.locator("#country") : locator;
    await country.click({ timeout: 5000 }).catch(() => undefined);
    await country.fill(value);
    const option = scope.getByRole("option", { name: new RegExp(value, "i") }).first();
    if (await option.count().catch(() => 0)) {
      await option.click({ timeout: 3000 }).catch(() => undefined);
    } else {
      await country.press("Enter").catch(() => undefined);
    }
    await scope.waitForTimeout(600).catch(() => undefined);
    return;
  }
  if (/phone/i.test(field.label) || field.id === "phone" || field.type === "tel") {
    const phone = scope.locator("#phone");
    if (await phone.count().catch(() => 0)) {
      await phone.click({ timeout: 5000 }).catch(() => undefined);
      await phone.fill(nationalPhoneDigits(value));
      await phone.press("Tab").catch(() => undefined);
      return;
    }
  }
  if (field.id.startsWith("question_") && /store and process my data/i.test(field.label)) {
    const consent = scope.locator(`#${field.id}`);
    const option = scope.locator('div[role="option"]').filter({ hasText: new RegExp(`^${value}$`, "i") }).first();
    await consent.click({ timeout: 5000, force: true }).catch(() => undefined);
    await consent.fill(value);
    if (await option.count().catch(() => 0)) {
      await option.click({ timeout: 5000 }).catch(() => undefined);
    } else {
      await consent.press("ArrowDown").catch(() => undefined);
      await consent.press("Enter").catch(() => undefined);
    }
    return;
  }
  if (field.tag === "select") {
    const labels = field.options;
    const match = labels.find((option) => option.toLowerCase() === value.toLowerCase())
      ?? labels.find((option) => option.toLowerCase().includes(value.toLowerCase()));
    if (!match) {
      throw new Error(`No option matching ${value} for ${field.label}`);
    }
    await locator.selectOption({ label: match });
    return;
  }
  try {
    await locator.fill(value);
  } catch (error) {
    const wrote = await locator.evaluate((element, next) => {
      const input = element as HTMLInputElement | HTMLTextAreaElement;
      if (!("value" in input)) {
        return false;
      }
      input.value = next;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.value === next;
    }, value).catch(() => false);
    if (!wrote) {
      throw error;
    }
  }
  if (field.type === "tel") {
    await locator.evaluate((element, international) => {
      const input = element as HTMLInputElement;
      const pageWindow = window as unknown as {
        intlTelInputGlobals?: {
          getInstance?: (node: HTMLInputElement) => { setCountry: (code: string) => void; setNumber: (number: string) => void } | null;
        };
        angular?: { element: (node: Element) => { triggerHandler: (name: string) => void } };
      };
      const tel = pageWindow.intlTelInputGlobals?.getInstance?.(input);
      tel?.setCountry("il");
      tel?.setNumber(international);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      pageWindow.angular?.element(input).triggerHandler("input");
      pageWindow.angular?.element(input).triggerHandler("change");
    }, candidate.phone.international);
  }
}

async function checkOptions(scope: FormScope, field: DetectedField, values: string[]): Promise<void> {
  const indexes = field.optionIndexes ?? [];
  for (const value of values) {
    const matchAt = field.options.findIndex((option) => option.trim().toLowerCase() === value.trim().toLowerCase());
    const optionIndex = indexes[matchAt];
    if (matchAt < 0 || optionIndex === undefined) {
      throw new Error(`No checkbox option matching ${value}`);
    }
    const locator = scope.locator(`[data-agent-field="${optionIndex}"]`);
    await locator.setChecked(true, { force: true }).catch(async () => {
      await locator.evaluate((element) => {
        const input = element as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }
}

function fieldQuestionLabel(field: DetectedField): string {
  const parts = [field.label, field.groupLabel, field.name, field.id]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
  return parts[0] ?? "required field";
}

function digitsOnly(value: string): string {
  const match = value.replace(/,/g, "").match(/\d{4,6}/);
  return match?.[0] ?? value;
}

/** Greenhouse keeps the country code in its own control, so the phone box wants the national number. */
function nationalPhoneDigits(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("972")) {
    digits = digits.slice(3);
  }
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

export async function waitForResumeUploadTarget(page: Page, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scopes: FormScope[] = [page, ...page.frames()];
    for (const scope of scopes) {
      const count = await scope.locator('input[type="file"]').count().catch(() => 0);
      if (count > 0) {
        return true;
      }
    }
    await page.waitForTimeout(250);
  }
  return false;
}

export async function uploadResume(page: Page, cvPath: string): Promise<boolean> {
  await waitForResumeUploadTarget(page).catch(() => undefined);
  const fileName = cvPath.split("/").pop() || "cv.pdf";
  const scopes: FormScope[] = [page, ...page.frames()];
  const ranked: Array<{ scope: FormScope; index: number; rank: number }> = [];
  for (const scope of scopes) {
    const inputs = scope.locator('input[type="file"]');
    const count = await inputs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const hint = await inputs.nth(index).evaluate((element) => {
        const input = element as HTMLInputElement;
        return `${input.name} ${input.id} ${input.accept} ${input.getAttribute("aria-label") || ""}`.toLowerCase();
      }, { timeout: 2_000 }).catch(() => "");
      const rank = /resume|cv|curriculum/.test(hint) ? 2 : /cover|portfolio/.test(hint) ? 0 : 1;
      ranked.push({ scope, index, rank });
    }
  }
  ranked.sort((left, right) => right.rank - left.rank);
  for (const candidate of ranked) {
    if (candidate.rank === 0) {
      continue;
    }
    const input = candidate.scope.locator('input[type="file"]').nth(candidate.index);
    try {
      await input.setInputFiles(cvPath, { timeout: 5000 });
    } catch (error) {
      log("CV_UPLOAD_RETRY", { message: error instanceof Error ? error.message : "setInputFiles_failed" });
      continue;
    }
    log("CV_UPLOADED", { file: fileName });
    return true;
  }
  return false;
}

export async function richestFormScope(page: Page): Promise<FormScope> {
  let best: FormScope = page;
  let bestCount = await page.locator("input, textarea, select").count();
  for (const frame of page.frames()) {
    const count = await frame.locator("input, textarea, select").count().catch(() => 0);
    if (count > bestCount) {
      best = frame;
      bestCount = count;
    }
  }
  return best;
}

/** Prefer Greenhouse embed over parent-page cookie banners and newsletter fields. */
export async function applyFormScope(page: Page): Promise<FormScope> {
  const greenhouse = greenhouseJobAppFrame(page);
  if (greenhouse) {
    const resumeInputs = await greenhouse.locator('input[type="file"]').count().catch(() => 0);
    const emailInputs = await greenhouse.locator('input[type="email"]').count().catch(() => 0);
    if (resumeInputs > 0 || emailInputs > 0) {
      return greenhouse;
    }
  }
  return richestFormScope(page);
}
