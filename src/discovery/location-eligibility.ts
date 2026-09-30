/**
 * Discovery and apply pursue remote roles or on-site/hybrid in Israel's Central District
 * or Tel Aviv District (incl. Sharon cities), minus admin-configured excluded locations.
 */
import { getExcludedLocations, textMatchesExcludedLocation } from "../application/exclude-location.js";
import { normalizeLocationAliases } from "./location-aliases.js";

const REMOTE_FROM_ISRAEL = [
  /\bremote\s+(?:from|in)\s+israel\b/i,
  /\bwork\s+from\s+israel\b/i,
  /\bbased\s+in\s+israel\b/i,
  /\blocation\s*:\s*israel\b/i,
  /\bisrael\s*[-–]\s*remote\b/i,
  /\bremote\s*[-–]\s*israel\b/i,
  /\bfrom\s+israel\s+remotely\b/i,
  /\bcan\s+work\s+remotely\s+from\s+israel\b/i,
  /\bremote\s+work\s+from\s+israel\b/i,
  /\bworldwide\s+remote\b.*\bisrael\b/i,
  /\bisrael\b.*\bworldwide\s+remote\b/i,
];

/** Remote / WFH when not tied to a foreign-only location. */
const REMOTE_GENERAL = [
  /\bfully\s+remote\b/i,
  /\b100\s*%\s*remote\b/i,
  /\bremote\s+position\b/i,
  /\bremote\s+role\b/i,
  /\bremote\s+job\b/i,
  /\bwork\s+remotely\b/i,
  /\bremote\s+work\b/i,
  /\bwork\s+from\s+home\b/i,
  /\bwfh\b/i,
  /\bמהבית\b/,
  /\bעבודה\s+מהבית\b/,
  /\bמרחוק\b/,
  /\bעבודה\s+מרחוק\b/,
  /\b(?:full|partial)\s+remote\b/i,
  /\bremote\s*[-–]\s*ok\b/i,
  /\bremote\s+friendly\b/i,
  /\bהיברידי\b/,
  /\bhybrid\b/i,
  /\bremote\b/i,
];

const CENTRAL_DISTRICT = [
  /\btel\s*aviv\b/i,
  /\btel-?aviv\b/i,
  /\b(tlv|t\.l\.v)\b/i,
  /\bתל[\s-]?אביב\b/,
  /\bramat\s*gan\b/i,
  /\bרמת\s*גן\b/,
  /\bgivatayim\b/i,
  /\bגבעתיים\b/,
  /\bbnei\s*brak\b/i,
  /\bבני\s*ברק\b/,
  /\bpetah\s*tikva\b/i,
  /\bפתח\s*תקו?וה\b/,
  /\bholon\b/i,
  /\bחולון\b/,
  /\bbat\s*yam\b/i,
  /\bבת\s*ים\b/,
  /\brishon\s*le?zion\b/i,
  /\bראשון\s*לציון\b/,
  /\bnes\s*ziona\b/i,
  /\bנס\s*ציונה\b/,
  /\blod\b/i,
  /\bלוד\b/,
  /\bramla\b/i,
  /\bרמלה\b/,
  /\bmodiin\b/i,
  /\bמודיעין\b/,
  /\bor\s*yehuda\b/i,
  /\bאור\s*יהודה\b/,
  /\byehud\b/i,
  /\bיהוד\b/,
  /\bazor\b/i,
  /\bאזור\b/,
  /\bkiryat\s*ono\b/i,
  /\bקריית\s*אונו\b/,
  /\brehovot\b/i,
  /\bרחובות\b/,
  /\bshoham\b/i,
  /\bשוהם\b/,
  /\bel'?ad\b/i,
  /\bאלעד\b/,
  /\bמרכז\b/,
  /\bcentral\s+district\b/i,
  /\bמחוז\s*המרכז\b/,
];

/** מחוז תל אביב / Gush Dan fringe (Central overlap removed above). */
const TEL_AVIV_DISTRICT = [
  /\bherzliya\b/i,
  /\bהרצליה\b/,
  /\braanana\b/i,
  /\bra'?anana\b/i,
  /\bרעננה\b/,
  /\bkfar\s*saba\b/i,
  /\bכפר\s*סבא\b/,
  /\bhod\s*hasharon\b/i,
  /\bהוד\s*השרון\b/,
  /\bramat\s*hasharon\b/i,
  /\bרמת\s*השרון\b/,
  /\btel\s*aviv\s+district\b/i,
  /\bמחוז\s*תל\s*אביב\b/,
  /\bגוש\s*דן\b/,
  /\bgush\s*dan\b/i,
  /\bהשרון\b/,
];

const ON_SITE_ACCEPTABLE = [...CENTRAL_DISTRICT, ...TEL_AVIV_DISTRICT];

const FOREIGN_LOCATION = [
  /\bunited\s+states\b/i,
  /\bu\.s\.a?\.?\b/i,
  /\bremote\s+us\b/i,
  /\bunited\s+kingdom\b/i,
  /\buk\b/i,
  /\biceland\b/i,
  /\bpoland\b/i,
  /\bwarsaw\b/i,
  /\bwrocław\b/i,
  /\bkrakow\b/i,
  /\baustin\b/i,
  /\bmountain\s+view\b/i,
  /\bsan\s+francisco\b/i,
  /\bnashville\b/i,
  /\bnew\s+york\b/i,
  /\bseattle\b/i,
  /\bboston\b/i,
  /\bchicago\b/i,
  /\blos\s+angeles\b/i,
  /\bdublin\b/i,
  /\bberlin\b/i,
  /\bparis\b/i,
  /\bamsterdam\b/i,
  /\bsingapore\b/i,
  /\bremote\s*[-–]\s*(?:us|usa|uk|eu)\b/i,
  /\b(?:us|usa|uk|eu)\s*[-–]\s*remote\b/i,
];

const OTHER_ISRAEL_REGIONS = [
  /\bhaifa\b/i,
  /\bחיפה\b/,
  /\bjerusalem\b/i,
  /\bירושלים\b/,
  /\bbeer\s*sheva\b/i,
  /\bבאר\s*שבע\b/,
  /\bnetanya\b/i,
  /\bנתניה\b/,
  /\bachziv\b/i,
  /\beilat\b/i,
  /\bאילת\b/,
];

function combinedText(title: string, snippet: string, url: string): string {
  const titleText = title.replace(/\s+/g, " ").trim();
  const urlText = decodeURIComponent(url);
  const text = `${titleText} ${snippet}`.replace(/\s+/g, " ").trim();
  const raw = `${titleText} ${text} ${urlText}`.trim();
  return normalizeLocationAliases(raw);
}

function isForeignOnlySite(title: string, snippet: string, url: string): boolean {
  const titleText = title.replace(/\s+/g, " ").trim();
  if (FOREIGN_LOCATION.some((re) => re.test(titleText)) && !ON_SITE_ACCEPTABLE.some((re) => re.test(titleText))) {
    return true;
  }
  const text = combinedText(title, snippet, url);
  if (FOREIGN_LOCATION.some((re) => re.test(text))) {
    const hasIsraelRemote = REMOTE_FROM_ISRAEL.some((re) => re.test(text));
    const hasOnSiteMetro = ON_SITE_ACCEPTABLE.some((re) => re.test(text));
    if (!hasIsraelRemote && !hasOnSiteMetro) {
      return true;
    }
  }
  return false;
}

function isRemoteEligible(title: string, snippet: string, url: string): boolean {
  const text = combinedText(title, snippet, url);
  if (REMOTE_FROM_ISRAEL.some((re) => re.test(text))) {
    return true;
  }
  if (isForeignOnlySite(title, snippet, url)) {
    return false;
  }
  return REMOTE_GENERAL.some((re) => re.test(text));
}

function isOnSiteMetroEligible(title: string, snippet: string, url: string): boolean {
  const text = combinedText(title, snippet, url);
  if (ON_SITE_ACCEPTABLE.some((re) => re.test(text))) {
    return true;
  }
  return matchesIsraeliSharonPlaintext(text);
}

/** "Sharon" alone matches US towns (Sharon, CT). Require Israel context for Latin "sharon". */
function matchesIsraeliSharonPlaintext(text: string): boolean {
  if (!/\bsharon\b/i.test(text)) {
    return false;
  }
  if (/\bsharon,\s*(ct|ma|pa|nh|vt|usa|u\.s\.)\b/i.test(text)) {
    return false;
  }
  return /\bisrael\b/i.test(text) || /[\u0590-\u05FF]/.test(text);
}

function isOtherIsraelRegionOnly(title: string, snippet: string, url: string): boolean {
  const text = combinedText(title, snippet, url);
  const other = OTHER_ISRAEL_REGIONS.some((re) => re.test(text));
  const metro = ON_SITE_ACCEPTABLE.some((re) => re.test(text));
  const remote = isRemoteEligible(title, snippet, url);
  return other && !metro && !remote;
}

export type LocationRulesVerdict = "eligible" | "ineligible" | "needs_lookup";

/** Job appears Israeli but rules cannot confirm remote / metro districts / excluded city. */
export function isIsraelLocationUncertain(title: string, snippet: string, url: string): boolean {
  const blob = combinedText(title, snippet, url);
  if (/\bisrael\b/i.test(blob)) {
    return true;
  }
  if (/\.co\.il\b/i.test(url)) {
    return true;
  }
  if (/[\u0590-\u05FF]/.test(blob)) {
    return true;
  }
  try {
    if (/comeet\.com/i.test(url) && /location=.*israel/i.test(decodeURIComponent(url))) {
      return true;
    }
  } catch {
    // ignore bad URLs
  }
  return false;
}

export function classifyLocationRules(
  title: string,
  snippet: string,
  url = "",
  excludedLocations: readonly string[] = getExcludedLocations(),
): LocationRulesVerdict {
  const blob = combinedText(title, snippet, url);
  if (textMatchesExcludedLocation(blob, excludedLocations)) {
    return "ineligible";
  }
  if (isForeignOnlySite(title, snippet, url)) {
    return "ineligible";
  }
  if (isRemoteEligible(title, snippet, url)) {
    return "eligible";
  }
  if (isOnSiteMetroEligible(title, snippet, url)) {
    return "eligible";
  }
  if (isOtherIsraelRegionOnly(title, snippet, url)) {
    return "ineligible";
  }
  if (isIsraelLocationUncertain(title, snippet, url)) {
    return "needs_lookup";
  }
  return "ineligible";
}

export function isDiscoveryLocationEligible(
  title: string,
  snippet: string,
  url = "",
  excludedLocations: readonly string[] = getExcludedLocations(),
): boolean {
  return classifyLocationRules(title, snippet, url, excludedLocations) === "eligible";
}
