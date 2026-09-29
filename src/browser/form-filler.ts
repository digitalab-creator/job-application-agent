import type { Frame, Page } from "playwright";
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
  required: boolean;
  options: string[];
  optionIndexes?: number[];
  groupLabel?: string;
};

export async function readFields(scope: FormScope): Promise<DetectedField[]> {
  const raw = await scope.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("input, textarea, select"));
    const fields: DetectedField[] = [];
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
      const raw = aria || labelFor || el.placeholder || el.name || wrapped;
      const label = (raw || "").replace(/\s+/g, " ").trim().slice(0, 240);
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
        required: el.required || el.getAttribute("aria-required") === "true",
        options,
        groupLabel,
      });
    });
    return fields;
  });
  return groupCheckboxes(groupRadios(raw));
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
    grouped.push({
      index: first.index,
      tag: "input",
      type: "radio",
      label: name,
      name,
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
  const platformField = input.fields.find((field) => field.type === "checkbox-group" && isPlatformQuestion(field.label, field.options));
  const platformPlan = platformField ? matchPlatforms(platformField.options, candidate.media.platforms) : null;
  const ctx: FieldContext = { ...input.ctx, otherPlatformsText: platformPlan?.otherText ?? "" };
  for (const field of input.fields) {
    if (field.type === "file" || field.type === "search" || /recaptcha/i.test(field.name) || /recaptcha/i.test(field.label)) {
      continue;
    }
    const decision = decideField({
      label: field.label,
      required: field.required,
      type: field.tag === "textarea" ? "textarea" : field.type,
      options: field.options,
      ctx,
    });
    if (decision.action === "blank" || decision.action === "upload") {
      continue;
    }
    if (decision.action === "block") {
      blockers.push(decision.reason);
      log("REVIEW_REQUIRED", { question: field.label, reason: decision.reason });
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

function digitsOnly(value: string): string {
  const match = value.replace(/,/g, "").match(/\d{4,6}/);
  return match?.[0] ?? value;
}

export async function uploadResume(page: Page, cvPath: string): Promise<boolean> {
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
      }).catch(() => "");
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
