import { candidate } from "../config/candidate.js";
import { HEADLINES, factById, roleById } from "../profile/facts.js";
import type { CvDocument, Persona } from "../models/types.js";
import { formatRoleDateRange } from "./dates.js";
import { portfolioUrlForDoc } from "./portfolio.js";
import { polishCvText } from "./prose.js";

export function renderCvHtml(doc: CvDocument, persona: Persona): string {
  const portfolioUrl = portfolioUrlForDoc(doc, persona);
  const roles = doc.experience.map((role) => {
    const record = roleById(role.roleId);
    if (!record) {
      return "";
    }
    const bullets = role.bullets.map((bullet) => `<li>${escapeHtml(polishCvText(bullet.text))}</li>`).join("");
    return `<section>
      <h2>${escapeHtml(record.company)}</h2>
      <p class="meta">${escapeHtml(role.title)} · ${escapeHtml(formatRoleDateRange(record.start, record.end))}</p>
      <ul>${bullets}</ul>
    </section>`;
  }).join("");
  const education = doc.educationFactIds
    .map((id) => factById(id)?.text)
    .filter((text): text is string => Boolean(text))
    .map((text) => `<li>${escapeHtml(text)}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; line-height: 1.35; margin: 0; }
  h1 { font-size: 18pt; letter-spacing: 0.04em; margin: 0 0 2px; }
  h2 { font-size: 12pt; margin: 12px 0 0; }
  h3 { font-size: 11pt; margin: 14px 0 2px; }
  p, ul { margin: 0 0 6px; }
  ul { padding-left: 18px; }
  li { margin: 0 0 3px; hyphens: none; -webkit-hyphens: none; }
  .summary, .skills { hyphens: none; -webkit-hyphens: none; overflow-wrap: break-word; }
  .headline { font-weight: 700; }
  .contact, .meta { font-size: 10pt; }
</style></head>
<body>
  <h1>${escapeHtml(candidate.fullName)}</h1>
  <p class="headline">${escapeHtml(HEADLINES[doc.headlineId])}</p>
  <p class="contact">${escapeHtml(candidate.location.city)}, ${escapeHtml(candidate.location.country)} · ${escapeHtml(candidate.phone.display)} · ${escapeHtml(candidate.email)}</p>
  <p class="contact">${contactLine(portfolioUrl)}</p>
  <h3>Summary</h3>
  <p class="summary">${escapeHtml(polishCvText(doc.summary))}</p>
  <h3>Skills</h3>
  <p class="skills">${escapeHtml(polishCvText(doc.selectedSkills.join(" · ")))}</p>
  <h3>Experience</h3>
  ${roles}
  ${education ? `<h3>Education</h3><ul>${education}</ul>` : ""}
</body></html>`;
}

function contactLine(portfolioUrl: string): string {
  const base = `LinkedIn: ${escapeHtml(candidate.linkedin)} · GitHub: ${escapeHtml(candidate.github)}`;
  if (!portfolioUrl) {
    return base;
  }
  return `${base} · Portfolio: ${escapeHtml(portfolioUrl)}`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
