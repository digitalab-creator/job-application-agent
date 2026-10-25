export type GreenhouseOtpFailureReason =
  | "missing_mailbox_config"
  | "gmail_authorization_failed"
  | "gmail_list_failed"
  | "no_matching_message"
  | "poll_timeout"
  | "webhook_misconfigured"
  | "webhook_bad_response"
  | "invalid_code_shape";

export function greenhouseOtpFailureHint(reason: GreenhouseOtpFailureReason): string {
  switch (reason) {
    case "missing_mailbox_config":
      return "Workspace mailbox Gmail token and GREENHOUSE_OTP_WEBHOOK_URL are both unavailable.";
    case "gmail_authorization_failed":
      return "Gmail API rejected the workspace refresh token (re-authorize mailbox OAuth).";
    case "gmail_list_failed":
      return "Gmail API message list failed (check API quota and mailbox access).";
    case "no_matching_message":
      return "No recent Greenhouse verification email matched this application (wrong mailbox, company filter, or not sent yet).";
    case "poll_timeout":
      return "Verification email was not found within the configured OTP timeout.";
    case "webhook_misconfigured":
      return "Optional n8n OTP webhook did not return a code (native Gmail path is preferred when configured).";
    case "webhook_bad_response":
      return "OTP webhook returned non-JSON or malformed payload.";
    case "invalid_code_shape":
      return "OTP webhook returned a code with unexpected format.";
    default:
      return `OTP fetch failed (${reason}).`;
  }
}
