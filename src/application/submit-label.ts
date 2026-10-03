/** One pattern for every career-site submit control. Passed into the page so the browser uses the same rule. */
export const SUBMIT_LABEL_PATTERN = "^(apply( now| for this (job|position|role))?|submit( application| your application)?|send( application)?|i'?m interested|שלח|שלחו)$";

export function isSubmitControlLabel(text: string): boolean {
  return new RegExp(SUBMIT_LABEL_PATTERN, "i").test(text.replace(/\s+/g, " ").trim());
}
