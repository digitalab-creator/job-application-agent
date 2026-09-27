import type { Frame, Page } from "playwright";
import { answerFreeText } from "../application/answer-question.js";
import { decideField, type FieldContext } from "../application/field-map.js";
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
      fields.push({
        index,
        tag: el.tagName.toLowerCase(),
        type,
        label,
        name: el.name || "",
        required: el.required || el.getAttribute("aria-required") === "true",
        options,
      });
    });
    return fields;
  });
  return groupRadios(raw);
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

export async function fillFields(input: {
  scope: FormScope;
  fields: DetectedField[];
  ctx: FieldContext;
  persona: Persona;
  jobText: string;
}): Promise<{ blockers: string[]; answers: AnswerRecord[] }> {
  const blockers: string[] = [];
  const answers: AnswerRecord[] = [];
  for (const field of input.fields) {
    if (field.type === "file" || field.type === "search" || /recaptcha/i.test(field.name) || /recaptcha/i.test(field.label)) {
      continue;
    }
    const decision = decideField({
      label: field.label,
      required: field.required,
      type: field.tag === "textarea" ? "textarea" : field.type,
      options: field.options,
      ctx: input.ctx,
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
      if (!field.required) {
        continue;
      }
      const answered = await answerFreeText({
        question: field.label,
        persona: input.persona,
        jobText: input.jobText,
      });
      if (!answered) {
        const reason = `Required application question cannot be answered safely: "${field.label}"`;
        blockers.push(reason);
        continue;
      }
      await writeField(input.scope, field, answered.value);
      answers.push({ question: field.label, answer: answered.value, source: "llm_from_supported_facts" });
      log("FIELD_FILLED", { label: field.label, source: "llm_from_supported_facts" });
      continue;
    }
    if (decision.action === "check") {
      await input.scope.locator(`[data-agent-field="${field.index}"]`).setChecked(true);
      answers.push({ question: field.label, answer: "checked", source: decision.source });
      continue;
    }
    const value = field.type === "number" ? digitsOnly(decision.value) : decision.value;
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
  await locator.fill(value);
}

function digitsOnly(value: string): string {
  const match = value.replace(/,/g, "").match(/\d{4,6}/);
  return match?.[0] ?? value;
}

export async function uploadResume(scope: FormScope, cvPath: string): Promise<boolean> {
  const input = scope.locator('input[type="file"]').first();
  if (await input.count() === 0) {
    return false;
  }
  await input.setInputFiles(cvPath);
  const attached = await input.evaluate((element) => {
    const file = (element as HTMLInputElement).files?.[0];
    return file?.name ?? "";
  });
  const ok = attached.toLowerCase().endsWith(".pdf");
  if (ok) {
    log("CV_UPLOADED", { file: attached });
  }
  return ok;
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
