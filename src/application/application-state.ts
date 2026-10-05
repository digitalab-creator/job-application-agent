export type ApplicationState =
  | "job_page"
  | "career_listing"
  | "application_entry"
  | "application_form"
  | "application_step"
  | "submitted"
  | "confirmation"
  | "manual_gate";

export function applicationStateFromEvidence(input: {
  careersPage?: boolean;
  applicationEntry?: boolean;
  formDetected?: boolean;
  nextStep?: boolean;
  submitted?: boolean;
  confirmed?: boolean;
  manualGate?: boolean;
}): ApplicationState {
  if (input.confirmed) return "confirmation";
  if (input.manualGate) return "manual_gate";
  if (input.submitted) return "submitted";
  if (input.nextStep) return "application_step";
  if (input.formDetected) return "application_form";
  if (input.applicationEntry) return "application_entry";
  if (input.careersPage) return "career_listing";
  return "job_page";
}
