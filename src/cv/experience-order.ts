import { roles } from "../profile/facts.js";
import type { CvRole } from "../models/types.js";

const ROLE_ORDER = new Map(roles.map((role, index) => [role.id, index]));

/** CV sections follow the master roles list (recent → older), not LLM reordering. */
export function sortExperience(experience: CvRole[]): CvRole[] {
  return [...experience].sort((left, right) => {
    const leftIndex = ROLE_ORDER.get(left.roleId) ?? 999;
    const rightIndex = ROLE_ORDER.get(right.roleId) ?? 999;
    return leftIndex - rightIndex;
  });
}
