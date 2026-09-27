import { z } from "zod";
import type { ListedJob } from "./openings.js";

/** Closed decision. Only "good" may open a job. Anything else means do not apply. */
export const openingFitSchema = z.object({
  fit: z.enum(["good", "none"]),
  index: z.number().int(),
  reason: z.string(),
});

export type OpeningChoice = {
  job: ListedJob;
  reason: string;
};

/** Accept a model answer only when it marks one listed opening as a good match. */
export function acceptOpeningChoice(raw: unknown, openings: ListedJob[]): OpeningChoice | null {
  const parsed = openingFitSchema.safeParse(raw);
  if (!parsed.success || parsed.data.fit !== "good") {
    return null;
  }
  const job = openings[parsed.data.index];
  if (!job) {
    return null;
  }
  return { job, reason: parsed.data.reason };
}
