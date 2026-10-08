/** Phrases that mean the application was actually received. A bare "thank you" on a job ad is not enough. */
const THANK_YOU_RULES: RegExp[] = [
  /thank you!?\s*your application has been submitted/i,
  /thanks for applying/i,
  /thank you for applying/i,
  /thank you for (your |submitting your )?application/i,
  /your application has been submitted/i,
  /application (has been |was )?(successfully )?(received|submitted|sent)/i,
  /successfully submitted/i,
  /we (have |'ve )?received your application/i,
  /your application (has been |was )?sent/i,
  /you have successfully applied/i,
  /we got your cv/i,
  /your cv will be reviewed/i,
  /grateful for your time and interest/i,
  /your submission was successful/i,
  /the form was sent successfully/i,
  /we (have |'ve )?received your (message|submission)/i,
  /your application was sent/i,
  /application sent successfully/i,
  /thanks for applying/i,
  /thank you for applying to/i,
  /thanks!?\s*we(?:'re| are) reviewing your application/i,
  /you have already applied/i,
  /you'?ve already applied/i,
  /previously applied for this job/i,
  /תודה[^\n]{0,80}(נשלחה|התקבלה|הוגשה|הגשת)/,
  /המועמדות (שלך )?התקבלה/,
];

export function thankYouMatch(text: string, url = ""): string | null {
  if (/thank|confirmation|application-submitted|successfully-applied/i.test(url)) {
    const fromUrl = url.match(/thank[^/?#]*|confirmation|application-submitted|successfully-applied/i)?.[0];
    if (fromUrl) {
      return fromUrl;
    }
  }
  for (const rule of THANK_YOU_RULES) {
    const found = text.match(rule);
    if (found?.[0]) {
      return found[0].replace(/\s+/g, " ").trim().slice(0, 180);
    }
  }
  return null;
}
