export const ISRAEL_PHONE_PREFIX = "+972";

/** Return the actual option label for Israel, or null when the form has no usable Israel option. */
export function israelPhoneCountryOption(options: readonly string[]): string | null {
  return options.find((option) => /(?:^|[^\d])\+?972(?:[^\d]|$)/.test(option))
    ?? options.find((option) => /(?:^|[\s(,-])israel(?:[\s),-]|$)|ישראל/i.test(option))
    ?? null;
}

/** Country-code inputs must never receive the candidate's complete phone number. */
export function countryCodeValue(options: readonly string[]): string {
  return israelPhoneCountryOption(options) ?? ISRAEL_PHONE_PREFIX;
}
