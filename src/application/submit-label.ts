/** One pattern for every career-site submit control. Passed into the page so the browser uses the same rule. */
export const SUBMIT_LABEL_PATTERN = "^(apply( now)?|submit( application| your application)?|send( application)?)$";

export function isSubmitControlLabel(text: string): boolean {
  return new RegExp(SUBMIT_LABEL_PATTERN, "i").test(text.replace(/\s+/g, " ").trim());
}
