export type SkillListedJob = {
  title: string;
  href: string;
  snippet: string;
};

const SKILL = /engineer|developer|growth|marketing|\bai\b|backend|fullstack|full-stack|product|data|automation|ppc|applied/gi;
const REJECT = /intern|student|junior\b|receptionist|legal counsel/i;

/**
 * Cheap shortlist only. The result must be opened and passed through the full
 * job-fit gate before it can influence an application.
 */
export function shortlistSkillOpenings(openings: SkillListedJob[], limit = 5): SkillListedJob[] {
  const ranked: Array<{ job: SkillListedJob; score: number }> = [];
  for (const job of openings) {
    const text = `${job.title} ${job.snippet}`;
    if (REJECT.test(text.toLowerCase())) {
      continue;
    }
    const score = text.match(SKILL)?.length ?? 0;
    if (score === 0) {
      continue;
    }
    ranked.push({ job, score });
  }
  return ranked
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.job);
}
