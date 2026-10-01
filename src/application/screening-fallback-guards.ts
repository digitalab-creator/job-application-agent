import { matchesOfficeCommuteSkip } from "./skip-job-screening.js";

export function shouldSkipLlmFallback(blockReason: string, label: string): boolean {
  const blob = `${blockReason} ${label}`.toLowerCase();
  if (matchesOfficeCommuteSkip(`${blockReason} ${label}`)) {
    return true;
  }
  if (/demographic|gender|race|ethnicity|veteran|disability|degree|bachelor|master|phd|university degree/i.test(blob)) {
    return true;
  }
  if (/cannot be answered safely.*decline/i.test(blob)) {
    return true;
  }
  return false;
}
