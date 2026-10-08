import type { Frame, Page } from "playwright";
import {
  applicationFormScoreInBrowser,
  countFileInputsInBrowser,
  hasEmailInputInBrowser,
  readFieldsInBrowser,
} from "./form-browser.js";
import { answerBlockedField } from "../application/answer-blocked-field.js";
import { answerFreeText } from "../application/answer-question.js";
import { decideField, isNarrativeQuestion, type FieldContext } from "../application/field-map.js";
import { isPlatformQuestion, matchPlatforms } from "../application/media-answers.js";
import { countryCodeValue, israelPhoneCountryOption } from "../application/phone-country-code.js";
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
  const raw = await scope.evaluate(readFieldsInBrowser);
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
}): Promise<{ blockers: string[]; answers: AnswerRecord[]; skipJob?: { reason: string } }> {
  const blockers: string[] = [];
  const answers: AnswerRecord[] = [];
  let phoneFilled = false;
  const platformField = input.fields.find((field) => field.type === "checkbox-group" && isPlatformQuestion(field.label, field.options));
  const platformPlan = platformField ? matchPlatforms(platformField.options, candidate.media.platforms) : null;
  const ctx: FieldContext = {
    ...input.ctx,
    otherPlatformsText: platformPlan?.otherText ?? "",
    jobText: input.jobText,
  };
  const orderedFields = [...input.fields].sort((a, b) => {
    const rank = (field: DetectedField) => {
      if (/^search$/i.test(field.label.trim()) && input.fields.some((item) => /phone/i.test(item.label))) {
        return 0;
      }
      if (/phone|tel|mobile/i.test(field.label)) {
        return 1;
      }
      return 2;
    };
    return rank(a) - rank(b);
  });
  for (const field of orderedFields) {
    if (/phone/i.test(field.label) && phoneFilled) {
      continue;
    }
    if (field.type === "file" || /recaptcha/i.test(field.name) || /recaptcha/i.test(field.label)) {
      continue;
    }
    if (/^search$/i.test(field.label.trim())) {
      const hasPhone = input.fields.some((item) => /phone|tel|mobile/i.test(`${item.label} ${item.name} ${item.id}`));
      if (hasPhone) {
        const locator = input.scope.locator(`[data-agent-field="${field.index}"]`);
        try {
          await pickSearchableOption(input.scope, locator, "Israel");
          answers.push({ question: field.label, answer: "Israel", source: "candidate_profile" });
          log("FIELD_FILLED", { label: field.label, source: "phone_country_search" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "phone_country_search_failed";
          if (field.required) {
            blockers.push(`Could not fill phone country search: ${message}`);
          }
          log("VALIDATION_FAILED", { label: field.label, message });
        }
        continue;
      }
    }
    if (field.type === "search" && !/country|website|portfolio|url/i.test(`${field.label} ${field.groupLabel}`)) {
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
    if (decision.action === "skip_job") {
      log("JOB_SKIPPED_SCREENING", { question: fieldQuestionLabel(field), reason: decision.reason });
      return { blockers: [], answers, skipJob: { reason: decision.reason } };
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
  await syncPhoneInputs(input.scope);
  return { blockers, answers };
}

type IntlTelInstance = {
  setCountry: (code: string) => void;
  setNumber: (number: string) => void;
  getNumber?: () => string;
};

/**
 * Comeet intl-tel-input keeps a separate visible `name=phone` from data-agent-field targets.
 * The server's IP often presets Germany (+49). An Israeli mobile under +49 stays invalid,
 * so this always switches the visible widget to Israel and writes the national number.
 */
export async function syncPhoneInputs(scope: FormScope): Promise<void> {
  const localPhone = candidate.phone.local.replace(/\D/g, "");
  await scope.evaluate(({ international, localPhone: national }) => {
    const pageWindow = window as unknown as {
      intlTelInputGlobals?: { getInstance?: (node: HTMLInputElement) => IntlTelInstance | null };
      intlTelInput?: { getInstance?: (node: HTMLInputElement) => IntlTelInstance | null };
      angular?: {
        element: (node: Element) => {
          triggerHandler: (name: string) => void;
          controller?: (name: string) => { $setViewValue: (value: string) => void } | undefined;
          scope?: () => { $apply: (fn: () => void) => void };
        };
      };
    };
    const fallbackNational = national || (international.startsWith("+972") ? `0${international.slice(4)}` : international);
    const candidates = Array.from(
      document.querySelectorAll('input[name="phone"], input.iti__tel-input, input[type="tel"]'),
    ) as HTMLInputElement[];
    for (const input of candidates) {
      const style = window.getComputedStyle(input);
      if (style.display === "none" || style.visibility === "hidden") {
        continue;
      }
      const tel = pageWindow.intlTelInputGlobals?.getInstance?.(input)
        ?? pageWindow.intlTelInput?.getInstance?.(input);
      if (tel) {
        tel.setCountry("il");
        tel.setNumber(international);
      }
      const digits = (input.value || "").replace(/\D/g, "");
      if (digits.length < 9) {
        input.value = fallbackNational;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      const angularEl = pageWindow.angular?.element(input);
      angularEl?.triggerHandler("input");
      angularEl?.triggerHandler("change");
      const model = angularEl?.controller?.("ngModel");
      const ngScope = angularEl?.scope?.();
      if (model && ngScope) {
        try {
          ngScope.$apply(() => model.$setViewValue(input.value));
        } catch {
          model.$setViewValue(input.value);
        }
      }
    }
  }, { international: candidate.phone.international, localPhone });
  await selectIsraelPhoneCountry(scope, localPhone);
}

/** Click the flag menu when the plugin API did not move the country off the IP default. */
async function selectIsraelPhoneCountry(scope: FormScope, localPhone: string): Promise<void> {
  const flag = scope.locator(".iti__selected-country, .iti__selected-flag").first();
  if (await flag.count().catch(() => 0) === 0) {
    return;
  }
  const label = `${await flag.getAttribute("title").catch(() => "") ?? ""} ${await flag.getAttribute("aria-label").catch(() => "") ?? ""}`;
  if (/israel/i.test(label)) {
    return;
  }
  await flag.click({ timeout: 3000, force: true }).catch(() => undefined);
  const israel = scope.locator(".iti__country, [role='option']").filter({ hasText: /israel/i }).first();
  if (await israel.count().catch(() => 0)) {
    await israel.click({ timeout: 3000, force: true }).catch(() => undefined);
  }
  const phone = scope.locator('input[name="phone"], input.iti__tel-input').first();
  if (await phone.count().catch(() => 0)) {
    await phone.fill(localPhone).catch(() => undefined);
    await phone.press("Tab").catch(() => undefined);
  }
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
    const pick = countryCodeValue(field.options);
    if (field.tag === "select" && field.options.length > 0) {
      const option = israelPhoneCountryOption(field.options);
      if (!option) {
        throw new Error("No Israel (+972) option for country phone code");
      }
      await locator.selectOption({ label: option }).catch(async () => {
        await locator.selectOption({ value: option });
      });
      return;
    }
    await locator.fill(pick);
    return;
  }
  if (field.id === "country" || (/country/i.test(field.label) && !/phone.code|country_phone/i.test(fieldBlob))) {
    const country = field.id === "country" ? scope.locator("#country") : locator;
    await pickSearchableOption(scope, country, value);
    return;
  }
  if (/phone/i.test(field.label) || field.id === "phone" || field.type === "tel") {
    const phoneById = scope.locator("#phone");
    const target = (await phoneById.count().catch(() => 0)) > 0 ? phoneById : locator;
    const digits = phoneDigitsForForm(value);
    await target.click({ timeout: 5000 }).catch(() => undefined);
    await target.fill(digits);
    await target.press("Tab").catch(() => undefined);
    await target.evaluate((element, international) => {
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
    return;
  }
  if (field.id.startsWith("question_")) {
    const questionLocator = scope.locator(`[data-agent-field="${field.index}"]`);
    if (field.tag === "select" && field.options.length > 0) {
      const match = field.options.find((option) => option.toLowerCase() === value.toLowerCase())
        ?? field.options.find((option) => option.toLowerCase().includes(value.toLowerCase()));
      if (!match) {
        throw new Error(`No option matching ${value} for ${field.label}`);
      }
      await questionLocator.selectOption({ label: match });
      return;
    }
    await pickSearchableOption(scope, questionLocator, value);
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

/** Searchable country/city widgets (Greenhouse, Lever, Ashby, custom React selects). Never block on a hung .fill(). */
async function pickSearchableOption(scope: FormScope, input: ReturnType<FormScope["locator"]>, value: string): Promise<void> {
  await input.click({ timeout: 3000, force: true }).catch(() => undefined);
  await input.fill(value, { timeout: 2500 }).catch(async () => {
    await input.pressSequentially(value, { delay: 30, timeout: 2500 }).catch(() => undefined);
  });
  const option = scope.locator('[role="option"], li[role="option"], .select__option').filter({ hasText: new RegExp(value, "i") }).first();
  if (await option.count().catch(() => 0)) {
    await option.click({ timeout: 3000, force: true }).catch(() => undefined);
  } else {
    await input.press("ArrowDown").catch(() => undefined);
    await input.press("Enter").catch(() => undefined);
  }
  await scope.waitForTimeout(400).catch(() => undefined);
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

/** Comeet wants local `05…` digits; Greenhouse often wants national without leading 0. */
function phoneDigitsForForm(value: string): string {
  const localDigits = candidate.phone.local.replace(/\D/g, "");
  const incoming = value.replace(/\D/g, "");
  if (localDigits && (incoming === localDigits || incoming === `972${localDigits.slice(1)}` || incoming.endsWith(localDigits.slice(1)))) {
    return localDigits;
  }
  return nationalPhoneDigits(value);
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
      const count = await countDeepFileInputs(scope);
      if (count > 0) {
        return true;
      }
    }
    await page.waitForTimeout(250);
  }
  return false;
}

export async function waitForReadableApplyForm(page: Page, timeoutMs = 25_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scope = await applyFormScope(page);
    const fields = await readFields(scope).catch(() => []);
    if (fields.length > 0) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function countDeepFileInputs(scope: FormScope): Promise<number> {
  const locatorCount = await scope.locator('input[type="file"]').count().catch(() => 0);
  if (locatorCount > 0) {
    return locatorCount;
  }
  return scope.evaluate(countFileInputsInBrowser).catch(() => 0);
}

export async function pageHasDeepFileInput(page: Page): Promise<boolean> {
  for (const scope of [page, ...page.frames()]) {
    if ((await countDeepFileInputs(scope)) > 0) {
      return true;
    }
  }
  return false;
}

export async function pageHasDeepEmailInput(page: Page): Promise<boolean> {
  for (const scope of [page, ...page.frames()]) {
    const shallow = await scope.locator('input[type="email"]').count().catch(() => 0);
    if (shallow > 0) {
      return true;
    }
    const deep = await scope.evaluate(hasEmailInputInBrowser).catch(() => false);
    if (deep) {
      return true;
    }
  }
  return false;
}

export async function revealApplicationForm(page: Page): Promise<void> {
  if (await pageHasAnyResumeField(page)) {
    return;
  }
  const scopes: FormScope[] = [page, ...page.frames()];
  for (const scope of scopes) {
    const control = scope.getByRole("link", { name: /^(apply now|apply for this job|apply|i'm interested|i am interested)$/i }).first();
    const button = scope.getByRole("button", { name: /^(apply now|apply|i'm interested)$/i }).first();
    const target = (await control.count().catch(() => 0)) ? control : button;
    if (await target.count().catch(() => 0)) {
      await target.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      if (await pageHasAnyResumeField(page)) {
        return;
      }
    }
    const attach = scope.getByText(/^(attach|upload)\b/i).first();
    if (await attach.count().catch(() => 0)) {
      await attach.click({ timeout: 3000 }).catch(() => undefined);
    }
  }
}

async function pageHasAnyResumeField(page: Page): Promise<boolean> {
  for (const scope of [page, ...page.frames()]) {
    if ((await countDeepFileInputs(scope)) > 0) {
      return true;
    }
  }
  return false;
}

export async function uploadResume(page: Page, cvPath: string): Promise<boolean> {
  await revealApplicationForm(page);
  await waitForResumeUploadTarget(page, 25_000).catch(() => undefined);
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
  const scopes: FormScope[] = [page, ...page.frames()];
  const ranked = await Promise.all(scopes.map(async (scope, index) => ({
    scope,
    index,
    score: await applicationFormScore(scope),
  })));
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.scope ?? page;
}

/** Rank by application semantics, not merely by the number of inputs. */
export async function applyFormScope(page: Page): Promise<FormScope> {
  return richestFormScope(page);
}

async function applicationFormScore(scope: FormScope): Promise<number> {
  return scope.evaluate(applicationFormScoreInBrowser).catch(() => 0);
}
