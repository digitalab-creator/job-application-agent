/** Normalize common job-board spellings so metro regexes match. */
const ALIAS_REPLACEMENTS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bkefar[\s-]?sava\b/gi, replacement: "kfar saba" },
  { pattern: /\bkfar[\s-]?sava\b/gi, replacement: "kfar saba" },
  { pattern: /\bpetach[\s-]?tikva(h)?\b/gi, replacement: "petah tikva" },
  { pattern: /\bpetaḥ[\s-]?tikva\b/gi, replacement: "petah tikva" },
  { pattern: /\btel[\s-]?aviv[\s-]?yafo\b/gi, replacement: "tel aviv" },
  { pattern: /\brishon[\s-]?le[\s-]?zion\b/gi, replacement: "rishon lezion" },
  { pattern: /\bramat[\s-]?ha[\s-]?sharon\b/gi, replacement: "ramat hasharon" },
  { pattern: /\bhod[\s-]?ha[\s-]?sharon\b/gi, replacement: "hod hasharon" },
  { pattern: /\bmodi[\s-]?in[\s-]?maccabim[\s-]?reut\b/gi, replacement: "modiin" },
  { pattern: /\bneurim\b|\bne[\s-]?urim\b/gi, replacement: "neurim" },
  { pattern: /\bherzliyya\b/gi, replacement: "herzliya" },
  { pattern: /\braanana\b/gi, replacement: "raanana" },
  { pattern: /\bkefar[\s-]?saba\b/gi, replacement: "kfar saba" },
  { pattern: /\bb(?:e|')?er[\s-]?sheva\b/gi, replacement: "beer sheva" },
  { pattern: /\bbeersheba\b/gi, replacement: "beer sheva" },
  { pattern: /\bgiv(?:at)?[\s-]?atayim\b/gi, replacement: "givatayim" },
  { pattern: /\bbnei[\s-]?berak\b/gi, replacement: "bnei brak" },
  { pattern: /\bbinyamina\b/gi, replacement: "binyamina" },
  { pattern: /\bgivat[\s-]?shmuel\b/gi, replacement: "givat shmuel" },
  { pattern: /\brosh[\s-]?ha(?:'|a)?ayin\b/gi, replacement: "rosh haayin" },
];

export function normalizeLocationAliases(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  for (const { pattern, replacement } of ALIAS_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
