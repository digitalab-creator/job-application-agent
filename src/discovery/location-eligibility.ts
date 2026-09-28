/**
 * Discovery only adds jobs in Israel or roles that explicitly allow working remotely from Israel.
 */

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

const ISRAEL_SITE = [
  /\bisrael\b/i,
  /\btel\s*aviv\b/i,
  /\btel-?aviv\b/i,
  /\b(tlv|t\.l\.v)\b/i,
  /\braanana\b/i,
  /\bherzliya\b/i,
  /\bnetanya\b/i,
  /\bhaifa\b/i,
  /\bjerusalem\b/i,
  /\bgivatayim\b/i,
  /\bpetah\s*tikva\b/i,
  /\bholon\b/i,
  /\bbeer\s*sheva\b/i,
  /\brehovot\b/i,
  /\bkfar\s*saba\b/i,
  /\bramat\s*gan\b/i,
  /\bhod\s*hasharon\b/i,
  /\bmodiin\b/i,
  /\bhybrid\b.*\bisrael\b/i,
  /\bisrael\b.*\bhybrid\b/i,
];

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

export function isDiscoveryLocationEligible(title: string, snippet: string, url = ""): boolean {
  const titleText = title.replace(/\s+/g, " ").trim();
  const urlText = decodeURIComponent(url);

  if (REMOTE_FROM_ISRAEL.some((re) => re.test(titleText) || re.test(urlText))) {
    return true;
  }
  // Comeet puts the workplace in the job title. A Warsaw title stays ineligible even if the description mentions Israel.
  if (FOREIGN_LOCATION.some((re) => re.test(titleText)) && !ISRAEL_SITE.some((re) => re.test(titleText))) {
    return false;
  }

  const text = `${titleText} ${snippet}`.replace(/\s+/g, " ").trim();
  if (REMOTE_FROM_ISRAEL.some((re) => re.test(text) || re.test(urlText))) {
    return true;
  }
  if (ISRAEL_SITE.some((re) => re.test(text) || re.test(urlText))) {
    return true;
  }
  if (FOREIGN_LOCATION.some((re) => re.test(text))) {
    return false;
  }
  return true;
}
