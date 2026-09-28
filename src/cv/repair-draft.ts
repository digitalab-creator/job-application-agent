import { roles } from "../profile/facts.js";

/**
 * Models often return JSON that is almost valid: portfolioKey null, or roleId omitted.
 * Repair those two shapes before schema parse. Do not invent bullets or employers.
 */
export function repairCvDraft(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const draft = { ...(raw as Record<string, unknown>) };
  if (draft.portfolioKey === null || draft.portfolioKey === "") {
    delete draft.portfolioKey;
  }
  if (!Array.isArray(draft.experience)) {
    return draft;
  }
  draft.experience = draft.experience.map((item, index) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    const row = { ...(item as Record<string, unknown>) };
    if (typeof row.roleId !== "string" || row.roleId.trim() === "") {
      const roleId = roles[index]?.id;
      if (roleId) {
        row.roleId = roleId;
      }
    }
    return row;
  });
  return draft;
}
