/**
 * Single source of truth for WHERE things are (geography only, no policy decisions).
 *
 * - Which Israeli cities belong to the Central / Tel Aviv District we pursue.
 * - Which foreign places and other Israeli regions are out of reach.
 *
 * NOT here: the admin block list of cities we refuse even inside those districts.
 * That lives only in data/config/excluded-locations.json (see application/exclude-location.ts).
 *
 * Consumers: discovery/location-eligibility.ts and application/office-commute.ts.
 */

/**
 * JavaScript's `\b` only understands ASCII letters, so `\bתל אביב\b` never matches Hebrew text.
 * Hebrew terms use Unicode-aware letter boundaries instead, and may carry one attached
 * prefix letter (ב "in", ל "to", מ "from", ה "the", ו "and", כ "as", ש "that").
 */
const HEBREW_PREFIX = "[בלמהוכש]?";
const NO_LETTER_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const NO_LETTER_AFTER = String.raw`(?![\p{L}\p{N}])`;

export function hebrewTerm(source: string): RegExp {
  return new RegExp(`${NO_LETTER_BEFORE}${HEBREW_PREFIX}(?:${source})${NO_LETTER_AFTER}`, "u");
}

export function latinTerm(source: string): RegExp {
  return new RegExp(String.raw`\b(?:${source})\b`, "i");
}

export function matchesAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** First matching text, used as audit evidence ("why did this job pass?"). */
export function firstMatch(patterns: readonly RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    if (found) {
      return found[0].trim();
    }
  }
  return null;
}

/** מחוז המרכז / Central District (Gush Dan core and neighbours). */
const CENTRAL_DISTRICT: readonly RegExp[] = [
  latinTerm(String.raw`tel[\s-]?aviv|tlv|t\.l\.v`),
  latinTerm(String.raw`ramat[\s-]?gan|givatayim|bnei[\s-]?brak|petah[\s-]?tikva|holon|bat[\s-]?yam`),
  latinTerm(String.raw`rishon[\s-]?le?[\s-]?zion|nes[\s-]?ziona|lod|ramla|modiin|or[\s-]?yehuda`),
  latinTerm(String.raw`yehud|azor|kiryat[\s-]?ono|rehovot|shoham|central[\s-]+district`),
  hebrewTerm(String.raw`תל[\s-]?אביב|רמת[\s-]?גן|גבעתיים|בני[\s-]?ברק|פתח[\s-]?תקו?וה|חולון|בת[\s-]?ים`),
  hebrewTerm(String.raw`ראשון[\s-]?לציון|נס[\s-]?ציונה|לוד|רמלה|מודיעין|אור[\s-]?יהודה|יהוד`),
  hebrewTerm(String.raw`קריית[\s-]?אונו|רחובות|שוהם|מחוז[\s-]?המרכז|אזור[\s-]?המרכז|מרכז[\s-]?הארץ`),
];

/** מחוז תל אביב and the Sharon / Gush Dan fringe. */
const TEL_AVIV_DISTRICT: readonly RegExp[] = [
  latinTerm(String.raw`herzliya|ra'?anana|kfar[\s-]?saba|hod[\s-]?hasharon|ramat[\s-]?hasharon`),
  latinTerm(String.raw`tel[\s-]?aviv[\s-]+district|gush[\s-]?dan`),
  hebrewTerm(String.raw`הרצליה|רעננה|כפר[\s-]?סבא|הוד[\s-]?השרון|רמת[\s-]?השרון`),
  hebrewTerm(String.raw`מחוז[\s-]?תל[\s-]?אביב|גוש[\s-]?דן|השרון`),
];

/** Cities where an on-site / hybrid role is inside our pursue geography (before the admin block list). */
export const ON_SITE_ACCEPTABLE: readonly RegExp[] = [...CENTRAL_DISTRICT, ...TEL_AVIV_DISTRICT];

/**
 * Israeli regions outside the pursue geography.
 * Cities we merely dislike (Netanya, Holon, ...) are NOT listed here; they belong to the admin block list.
 */
export const OTHER_ISRAEL_REGIONS: readonly RegExp[] = [
  latinTerm(String.raw`haifa|jerusalem|b(?:e|')?er[\s-]?sheva|beersheba|achziv|eilat`),
  hebrewTerm(String.raw`חיפה|ירושלים|באר[\s-]?שבע|אילת`),
];

/** Foreign places that make a role unreachable unless Israel remote / an Israeli office is also stated. */
export const FOREIGN_LOCATION: readonly RegExp[] = [
  latinTerm(String.raw`united[\s]+states|u\.s\.a?\.?|remote[\s,]+usa?|united[\s]+kingdom|uk|iceland|poland`),
  latinTerm(String.raw`warsaw|wrocław|krakow|austin|mountain[\s]+view|san[\s]+francisco|nashville`),
  latinTerm(String.raw`new[\s]+york|seattle|boston|chicago|los[\s]+angeles|dublin|london|berlin|paris`),
  latinTerm(String.raw`amsterdam|singapore`),
  latinTerm(String.raw`remote[\s]*[-–][\s]*(?:us|usa|uk|eu)|(?:us|usa|uk|eu)[\s]*[-–][\s]*remote`),
];

const ISRAEL_CONTEXT = /\bisrael\b|ישראל|[\u0590-\u05FF]/i;

/** True when the text (or URL host) shows the posting is Israeli: English "Israel", Hebrew letters, or .co.il. */
export function hasIsraelContext(text: string, url = ""): boolean {
  return ISRAEL_CONTEXT.test(text) || /\.co\.il\b/i.test(url);
}
