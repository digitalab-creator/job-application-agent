import type { CvDocument, Persona } from "../models/types.js";
import { factById, roleById } from "../profile/facts.js";
import { headlineForLeadIdentity, resolveLeadIdentity, skillsForLeadIdentity, summaryFactIdForLeadIdentity } from "./lead-identity.js";
import { personaDefaults, portfolioFor } from "./persona.js";

/** CV made only from approved fact text. No model wording, so it cannot invent a claim. */
export function buildVerbatim(persona: Persona): CvDocument {
  const defaults = personaDefaults[persona];
  const leadIdentity = resolveLeadIdentity({ persona });
  const summaryFactId = summaryFactIdForLeadIdentity(leadIdentity);
  return {
    headlineId: headlineForLeadIdentity(leadIdentity),
    summary: textOf(summaryFactId),
    summaryFactIds: [summaryFactId],
    selectedSkills: [...skillsForLeadIdentity(leadIdentity)],
    educationFactIds: [...defaults.educationFactIds],
    includePortfolio: true,
    portfolioKey: portfolioFor(persona),
    experience: Object.entries(defaults.roleFactIds).map(([roleId, factIds]) => {
      const role = roleById(roleId);
      if (!role) {
        throw new Error(`Unknown role in persona defaults: ${roleId}`);
      }
      return {
        roleId,
        title: role.defaultTitle[persona],
        bullets: factIds.map((id) => ({
          factIds: [id],
          text: textOf(id),
        })),
      };
    }),
  };
}

function textOf(id: string): string {
  const fact = factById(id);
  if (!fact) {
    throw new Error(`Missing fact ${id}`);
  }
  return fact.text;
}
