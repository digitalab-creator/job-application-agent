import fs from "node:fs";
import path from "node:path";
import { log } from "../logging/logger.js";
import type { Fact, FactPersona, Persona } from "../models/types.js";

type LearnedStore = {
  facts: Fact[];
};

const DEFAULT_PATH = path.join(process.cwd(), "data/config/learned-facts.json");

function storePath(): string {
  return process.env.LEARNED_FACTS_PATH?.trim() || DEFAULT_PATH;
}

function readStore(): LearnedStore {
  const file = storePath();
  if (!fs.existsSync(file)) {
    return { facts: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as LearnedStore;
    return { facts: Array.isArray(parsed.facts) ? parsed.facts : [] };
  } catch (error) {
    log("LEARNED_FACTS_READ_FAILED", {
      message: error instanceof Error ? error.message : "read_failed",
      path: file,
    });
    return { facts: [] };
  }
}

export function learnedFacts(): Fact[] {
  return readStore().facts;
}

export function learnedFactById(id: string): Fact | undefined {
  return learnedFacts().find((fact) => fact.id === id);
}

export function questionFactId(question: string, persona: Persona): string {
  const norm = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const hash = [...question].reduce((acc, ch) => ((acc * 31 + ch.charCodeAt(0)) >>> 0), 7);
  return `learned-q-${persona}-${norm || "field"}-${hash.toString(16)}`;
}

export function learnedAnswerForQuestion(question: string, persona: Persona): string | null {
  const id = questionFactId(question, persona);
  const fact = learnedFactById(id);
  const text = fact?.text?.trim();
  return text && text.length > 0 ? text : null;
}

export function upsertLearnedFact(input: {
  id: string;
  text: string;
  tags: string[];
  personas: FactPersona[];
}): Fact {
  const fact: Fact = {
    id: input.id,
    roleId: null,
    text: input.text.trim(),
    tags: input.tags,
    personas: input.personas,
    verified: true,
  };
  const store = readStore();
  const next = store.facts.filter((item) => item.id !== fact.id);
  next.push(fact);
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ facts: next }, null, 2)}\n`, "utf8");
  log("LEARNED_FACT_SAVED", { id: fact.id, tags: fact.tags.join(",") });
  return fact;
}
