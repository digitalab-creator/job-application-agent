/** Narrow title-only filter for specialisms that are not evidenced in candidate profile.
 * This is a *discovery* guard only. It never alters apply-time fact matching or existing rows.
 * Do not add broad AI/ML/backend exclusions: applied engineering is still a viable lane.
 */
export function specialistDiscoveryReason(title: string): string | null {
  const t = title.toLowerCase();
  if (/\b(computer vision|3d vision|visual perception|image recognition)\b/.test(t)
      && /\b(engineer|researcher|scientist|lead)\b/.test(t)) return "computer_vision_specialist";
  if (/\b(research scientist|machine learning scientist|deep learning researcher)\b/.test(t)) return "research_scientist";
  if (/\b(kernel engineer|embedded firmware|compiler engineer|gpu driver)\b/.test(t)) return "specialist_systems_engineer";
  return null;
}
