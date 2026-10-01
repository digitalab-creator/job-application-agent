export function shouldSkipLlmFallback(blockReason: string, label: string): boolean {
  const blob = `${blockReason} ${label}`.toLowerCase();
  if (/demographic|gender|race|ethnicity|veteran|disability|degree|bachelor|master|phd|university degree/i.test(blob)) {
    return true;
  }
  if (/cannot be answered safely.*decline/i.test(blob)) {
    return true;
  }
  return false;
}
