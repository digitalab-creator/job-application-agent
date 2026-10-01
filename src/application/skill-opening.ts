export type SkillListedJob = {
  title: string;
  href: string;
  snippet: string;
};

const SKILL = /engineer|developer|growth|marketing|\bai\b|backend|fullstack|full-stack|product|data|automation|ppc|applied/gi;
const REJECT = /intern|student|junior\b|receptionist|legal counsel/i;

/** When the exact title is gone, keep the opening that overlaps the candidate's work. */
export function bestSkillOpening(openings: SkillListedJob[]): SkillListedJob | null {
  let best: { job: SkillListedJob; score: number } | null = null;
  for (const job of openings) {
    const text = `${job.title} ${job.snippet}`;
    if (REJECT.test(text)) {
      continue;
    }
    const score = text.match(SKILL)?.length ?? 0;
    if (score === 0) {
      continue;
    }
    if (!best || score > best.score) {
      best = { job, score };
    }
  }
  return best?.job ?? null;
}
