/**
 * Pure rules for "this page is an account / email gate, not a fillable apply form".
 * Browser code gathers URL/text/field flags; this decides. Keep Playwright out.
 */
export function looksLikeLoginWall(input: {
  url: string;
  title?: string;
  text: string;
  hasPassword: boolean;
  hasEmail?: boolean;
  hasResumeFile?: boolean;
}): boolean {
  const title = input.title ?? "";
  const blob = `${title}\n${input.text}`;
  const loginCopy = /sign in|log[\s-]?in|create an account|create your account|enter your information|candidate (login|portal)|welcome page/i.test(blob)
    || /\blogin\b/i.test(title)
    || /\/jobs\/[^/]+\/login\b/i.test(input.url)
    || /[?&]login=/i.test(input.url);

  if (input.hasPassword && loginCopy) {
    return true;
  }

  // Resume upload means we already reached an application form.
  if (input.hasResumeFile) {
    return false;
  }

  // iCIMS / Phenom-style: Apply lands on email + GDPR before any password or CV field.
  if (input.hasEmail && loginCopy) {
    return true;
  }

  return false;
}
