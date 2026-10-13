/**
 * Salary range estimates from published benchmarks — never guessed.
 * Keep in sync with lib/salaryBenchmark.js (Apps Script copy).
 */
const SALARY_BAND_ILS = 5000;
const SALARY_BAND_USD = 5000;
const MAX_RANGE_WIDTH_ILS = 5000;
const MAX_RANGE_WIDTH_USD = 5000;
const MAX_RANGE_WIDTH_HOURLY_ILS = 50;
const MAX_RANGE_WIDTH_HOURLY_USD = 10;

const US_LOCATION_TOKENS = Object.freeze([
  'united states', 'usa', 'u.s.', ' us ', 'us-remote', 'us remote',
  'new york', 'nyc', 'san francisco', 'bay area', 'seattle', 'austin',
  'los angeles', 'chicago', 'boston', 'denver', 'miami', 'remote - us',
  'remote us', 'north america',
]);

const CATEGORY_BENCHMARKS = Object.freeze({
  'Growth Marketing': Object.freeze({
    ILS: Object.freeze({ monthlyMin: 18000, monthlyMax: 32000 }),
    USD: Object.freeze({ annualMin: 70000, annualMax: 130000 }),
    source: 'CBS IL avg wage high-tech services 2024; BLS Marketing Managers OEWS May 2023',
  }),
  'Applied AI': Object.freeze({
    ILS: Object.freeze({ monthlyMin: 28000, monthlyMax: 55000 }),
    USD: Object.freeze({ annualMin: 120000, annualMax: 200000 }),
    source: 'CBS IL programmer avg wage 2024; BLS Software Developers OEWS May 2023',
  }),
  'Product & Growth': Object.freeze({
    ILS: Object.freeze({ monthlyMin: 22000, monthlyMax: 42000 }),
    USD: Object.freeze({ annualMin: 90000, annualMax: 160000 }),
    source: 'CBS IL high-tech avg 2024; BLS Computer & Info Research Scientists OEWS May 2023',
  }),
  'Technical Delivery': Object.freeze({
    ILS: Object.freeze({ monthlyMin: 24000, monthlyMax: 45000 }),
    USD: Object.freeze({ annualMin: 95000, annualMax: 170000 }),
    source: 'CBS IL high-tech avg 2024; BLS Software Developers OEWS May 2023',
  }),
});

const DEFAULT_BENCHMARK = Object.freeze({
  ILS: Object.freeze({ monthlyMin: 16000, monthlyMax: 28000 }),
  USD: Object.freeze({ annualMin: 65000, annualMax: 110000 }),
  source: 'CBS IL economy-wide avg wage 2024; BLS National Occupational Employment May 2023',
});

const FREELANCE_HOURLY_BENCHMARK = Object.freeze({
  ILS: Object.freeze({ hourlyMin: 150, hourlyMax: 350 }),
  USD: Object.freeze({ hourlyMin: 50, hourlyMax: 150 }),
  source: 'Israel digital marketing freelancer survey 2024; Upwork US marketing consultant rates 2024',
});

const ROLE_BENCHMARK_OVERRIDES = Object.freeze([
  {
    pattern: /\b(ppc|paid search|sem|performance marketing|קמפיינים|פרסום ממומן)\b/i,
    ILS: { monthlyMin: 17000, monthlyMax: 30000 },
    USD: { annualMin: 65000, annualMax: 115000 },
    source: 'AllJobs IL PPC manager median 2024; BLS Market Research Analysts OEWS May 2023',
  },
  {
    pattern: /\b(ai engineer|ml engineer|machine learning|llm|genai|prompt engineer)\b/i,
    ILS: { monthlyMin: 30000, monthlyMax: 58000 },
    USD: { annualMin: 130000, annualMax: 210000 },
    source: 'CBS IL high-tech programmer wages 2024; Levels.fyi AI Engineer US median 2024',
  },
  {
    pattern: /\b(full[\s-]?stack|backend|frontend|software engineer|developer|מפתח)\b/i,
    ILS: { monthlyMin: 26000, monthlyMax: 50000 },
    USD: { annualMin: 110000, annualMax: 185000 },
    source: 'CBS IL programmer wages 2024; BLS Software Developers OEWS May 2023',
  },
]);

const SENIORITY_RULES = Object.freeze([
  { pattern: /\b(intern|junior|entry[\s-]?level|graduate|מתחיל|זוטר)\b/i, factor: 0.75 },
  { pattern: /\b(senior|sr\.?|lead|principal|staff|head of|מנהל בכיר|בכיר)\b/i, factor: 1.25 },
  { pattern: /\b(director|vp|vice president|chief|סמנכ|מנכ"ל)\b/i, factor: 1.55 },
]);

function detectSalaryCurrency_(location, workMode) {
  const blob = `${cleanString_(location)} ${cleanString_(workMode)}`.toLowerCase();
  if (US_LOCATION_TOKENS.some((token) => blob.includes(token))) return 'USD';
  if (/\b(usd|\$|dollar)\b/i.test(blob)) return 'USD';
  return 'ILS';
}

function resolveSalaryBenchmark_(category, role) {
  const roleText = cleanString_(role);
  const override = ROLE_BENCHMARK_OVERRIDES.find((item) => item.pattern.test(roleText));
  if (override) {
    return {
      ILS: override.ILS,
      USD: override.USD,
      source: override.source,
    };
  }

  const categoryKey = cleanString_(category);
  if (CATEGORY_BENCHMARKS[categoryKey]) return CATEGORY_BENCHMARKS[categoryKey];
  return DEFAULT_BENCHMARK;
}

function resolveSeniorityFactor_(role) {
  const roleText = cleanString_(role);
  const match = SENIORITY_RULES.find((rule) => rule.pattern.test(roleText));
  return match ? match.factor : 1;
}

function roundDownToBand_(value, band) {
  return Math.floor(value / band) * band;
}

function roundUpToBand_(value, band) {
  return Math.ceil(value / band) * band;
}

function formatSalaryAmount_(value) {
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function applySeniorityToRange_(min, max, factor) {
  return {
    min: Math.round(min * factor),
    max: Math.round(max * factor),
  };
}

function buildCappedRange_(min, max, step, maxWidth) {
  const midpoint = Math.round((min + max) / 2);
  const naturalWidth = Math.max(max - min, 0);

  if (naturalWidth <= maxWidth) {
    let roundedMin = roundDownToBand_(min, step);
    let roundedMax = roundUpToBand_(max, step);
    if (roundedMax <= roundedMin) roundedMax = roundedMin + step;
    if (roundedMax - roundedMin > maxWidth) {
      roundedMin = roundDownToBand_(midpoint - maxWidth / 2, step);
      roundedMax = roundedMin + maxWidth;
    }
    return { min: roundedMin, max: roundedMax };
  }

  const roundedMin = roundDownToBand_(midpoint - maxWidth / 2, step);
  return { min: roundedMin, max: roundedMin + maxWidth };
}

function buildMonthlySalaryRange_(min, max, currency) {
  const step = currency === 'USD' ? SALARY_BAND_USD : SALARY_BAND_ILS;
  const maxWidth = currency === 'USD' ? MAX_RANGE_WIDTH_USD : MAX_RANGE_WIDTH_ILS;
  const range = buildCappedRange_(min, max, step, maxWidth);
  return `${formatSalaryAmount_(range.min)}–${formatSalaryAmount_(range.max)} ${currency}/mo`;
}

function buildAnnualSalaryRange_(min, max) {
  const range = buildCappedRange_(min, max, SALARY_BAND_USD, MAX_RANGE_WIDTH_USD);
  return `${formatSalaryAmount_(range.min)}–${formatSalaryAmount_(range.max)} USD/yr`;
}

function buildHourlySalaryRange_(min, max, currency) {
  const step = currency === 'USD' ? MAX_RANGE_WIDTH_HOURLY_USD : MAX_RANGE_WIDTH_HOURLY_ILS;
  const range = buildCappedRange_(min, max, step, step);
  return `${formatSalaryAmount_(range.min)}–${formatSalaryAmount_(range.max)} ${currency}/hr`;
}

function parseListedSalary_(text) {
  const value = cleanString_(text);
  if (!value || value === 'Not listed') return null;

  const normalized = value.replace(/,/g, '').toLowerCase();
  const currency = /\b(usd|\$|dollar)\b/i.test(normalized) || /\$/.test(value) ? 'USD' : 'ILS';
  const isHourly = /\b(hour|hr|\/h|לשעה|שעתי)\b/i.test(normalized);
  const isAnnual = /\b(year|yr|annual|שנתי|לשנה)\b/i.test(normalized) || /\bk\b/i.test(normalized);

  const numbers = normalized.match(/\d+(?:\.\d+)?/g);
  if (!numbers || !numbers.length) return null;

  const parsed = numbers.map((n) => {
    let num = Number(n);
    if (/\bk\b/i.test(normalized) && num < 1000) num *= 1000;
    return num;
  });

  const min = Math.min(...parsed);
  const max = Math.max(...parsed);
  return { min, max, currency, isHourly, isAnnual };
}

function formatParsedSalary_(parsed) {
  if (!parsed) return '';
  if (parsed.isHourly) return buildHourlySalaryRange_(parsed.min, parsed.max, parsed.currency);
  if (parsed.currency === 'USD' && parsed.isAnnual) return buildAnnualSalaryRange_(parsed.min, parsed.max);
  if (parsed.currency === 'USD' && parsed.max >= 10000) return buildAnnualSalaryRange_(parsed.min, parsed.max);
  if (parsed.currency === 'USD') return buildMonthlySalaryRange_(parsed.min, parsed.max, 'USD');
  return buildMonthlySalaryRange_(parsed.min, parsed.max, 'ILS');
}

function parseSalaryRangeText_(text) {
  const value = cleanString_(text);
  if (!value || value === 'Not listed') return null;

  const normalized = value.toLowerCase();
  const currency = /usd/.test(normalized) ? 'USD' : 'ILS';
  let period = 'monthly';
  if (/\/hr\b|\/hour\b|לשעה|שעתי/i.test(normalized)) period = 'hourly';
  else if (/\/yr\b|\/year\b|שנתי/i.test(normalized)) period = 'annual';

  const numbers = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/g);
  if (!numbers || !numbers.length) return null;

  const parsed = numbers.map((n) => {
    let num = Number(n);
    if (/\bk\b/i.test(normalized) && num < 1000) num *= 1000;
    return num;
  });

  return {
    min: Math.min(...parsed),
    max: Math.max(...parsed),
    currency,
    period,
  };
}

function listedSalaryToRange_(parsed) {
  if (!parsed) return null;
  let period = 'monthly';
  if (parsed.isHourly) period = 'hourly';
  else if (parsed.isAnnual || (parsed.currency === 'USD' && parsed.max >= 10000)) period = 'annual';
  return {
    min: parsed.min,
    max: parsed.max,
    currency: parsed.currency,
    period,
  };
}

function toMonthlyIlsMax_(range) {
  if (!range) return null;

  let max = range.max;
  if (range.period === 'hourly') max *= CONFIG.FULL_TIME_MONTHLY_HOURS;
  else if (range.period === 'annual') max /= 12;
  if (range.currency === 'USD') max *= CONFIG.USD_TO_ILS_RATE;

  return Math.round(max);
}

function resolveSalaryRangeForFloor_(salaryText, estSalaryText) {
  const listed = listedSalaryToRange_(parseListedSalary_(salaryText));
  if (listed) return listed;
  return parseSalaryRangeText_(estSalaryText);
}

function evaluateSalaryFloor_(salaryText, estSalaryText) {
  const floor = CONFIG.MIN_MONTHLY_SALARY_ILS;
  const range = resolveSalaryRangeForFloor_(salaryText, estSalaryText);
  if (!range) return { ok: true, reason: 'unparsed' };

  const maxMonthlyIls = toMonthlyIlsMax_(range);
  if (maxMonthlyIls === null) return { ok: true, reason: 'unparsed' };
  if (maxMonthlyIls < floor) {
    return { ok: false, reason: 'below_min_salary', maxMonthlyIls, floor };
  }
  return { ok: true, maxMonthlyIls, floor };
}

function estimateSalaryRange_(candidate) {
  const salary = cleanString_(candidate.salary);
  const listed = parseListedSalary_(salary);
  if (listed) {
    return {
      display: formatParsedSalary_(listed),
      source: 'Listed on posting',
    };
  }

  const currency = detectSalaryCurrency_(candidate.location, candidate.work_mode);
  const isFreelance = cleanString_(candidate.opportunity_type) === CONFIG.OPPORTUNITY_TYPES.FREELANCE;
  const benchmark = resolveSalaryBenchmark_(candidate.category, candidate.role);
  const seniority = resolveSeniorityFactor_(candidate.role);

  if (isFreelance) {
    const hourly = FREELANCE_HOURLY_BENCHMARK[currency] || FREELANCE_HOURLY_BENCHMARK.ILS;
    const adjusted = applySeniorityToRange_(hourly.hourlyMin, hourly.hourlyMax, seniority);
    return {
      display: buildHourlySalaryRange_(adjusted.min, adjusted.max, currency),
      source: FREELANCE_HOURLY_BENCHMARK.source,
    };
  }

  if (currency === 'USD') {
    const usd = benchmark.USD || DEFAULT_BENCHMARK.USD;
    const adjusted = applySeniorityToRange_(usd.annualMin, usd.annualMax, seniority);
    return {
      display: buildAnnualSalaryRange_(adjusted.min, adjusted.max),
      source: benchmark.source,
    };
  }

  const ils = benchmark.ILS || DEFAULT_BENCHMARK.ILS;
  const adjusted = applySeniorityToRange_(ils.monthlyMin, ils.monthlyMax, seniority);
  return {
    display: buildMonthlySalaryRange_(adjusted.min, adjusted.max, 'ILS'),
    source: benchmark.source,
  };
}
