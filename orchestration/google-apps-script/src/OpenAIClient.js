/**
 * Raw HTTP OpenAI Responses client for Apps Script.
 */
/**
 * options.model        — override the configured model (e.g. a cheaper one for pure scoring)
 * options.useWebSearch — false when the prompt already carries every fact needed. Skipping the
 *                        tool removes both its per-call fee and the retrieved page content that
 *                        every later turn would re-send.
 */
function callOpenAI_(prompt, schema, schemaName, instructions, options) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty(CONFIG.PROPS.OPENAI_API_KEY);
  const settings = options || {};
  const model = settings.model
    || props.getProperty(CONFIG.PROPS.OPENAI_MODEL)
    || CONFIG.DEFAULT_MODEL;
  const useWebSearch = settings.useWebSearch !== false;

  const body = {
    model,
    store: false,
    instructions: instructions || [
      'You are a meticulous opportunity-research analyst.',
      'Use web search to find and verify current public postings.',
      'Never treat a search-results page or snippet as proof that an opportunity is open.',
      'Never invent inaccessible Facebook content. If a post is not publicly readable, omit it.',
      'Return only the requested structured JSON.',
    ].join(' '),
    input: prompt,
    max_output_tokens: 6000,
    text: {
      format: {
        type: 'json_schema',
        name: schemaName || 'opportunity_search_results',
        description: 'Verified opportunity-search results for a Google Sheet.',
        strict: true,
        schema,
      },
    },
  };

  if (useWebSearch) {
    body.tools = [
      {
        type: 'web_search',
        search_context_size: CONFIG.WEB_SEARCH_CONTEXT_SIZE,
        user_location: {
          type: 'approximate',
          country: 'IL',
          city: 'Petah Tikva',
          region: 'Central District',
          timezone: CONFIG.TIME_ZONE,
        },
      },
    ];
    body.max_tool_calls = CONFIG.MAX_TOOL_CALLS;
  }

  let lastError = null;
  const startedAt = Date.now();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = UrlFetchApp.fetch(CONFIG.OPENAI_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Client-Request-Id': Utilities.getUuid(),
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      timeoutSeconds: 180,
    });

    const code = response.getResponseCode();
    const raw = response.getContentText();

    if (code >= 200 && code < 300) {
      const parsed = JSON.parse(raw);
      const outputText = extractOutputText_(parsed);
      if (!outputText) {
        throw new Error(`OpenAI returned no output text. Status: ${parsed.status || 'unknown'}`);
      }
      const result = JSON.parse(outputText);
      const usage = normalizeUsage_(parsed.usage);
      usage.webSearchCalls = countWebSearchCalls_(parsed);
      result._meta = {
        durationMs: Date.now() - startedAt,
        model,
        attempt: attempt + 1,
        usage,
        estimatedCostUsd: roundUsd_(estimateUsageCostUsd_(usage, model)),
      };
      return result;
    }

    lastError = new Error(`OpenAI API ${code}: ${truncate_(raw, 1500)}`);
    if (code !== 429 && code < 500) break;

    console.log(`Arrr, OpenAI returned ${code}. Retrying after a short tide change.`);
    Utilities.sleep(Math.pow(2, attempt) * 2000 + Math.floor(Math.random() * 800));
  }

  throw lastError || new Error('OpenAI request failed without a response.');
}

function extractOutputText_(responseJson) {
  const chunks = [];
  (responseJson.output || []).forEach((item) => {
    if (item.type !== 'message') return;
    (item.content || []).forEach((part) => {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    });
  });
  return chunks.join('').trim();
}

function buildOpportunitySchema_(resultKey) {
  const itemProperties = {
    posted_date: { type: 'string' },
    role: { type: 'string' },
    company: { type: 'string' },
    category: { type: 'string' },
    opportunity_type: { type: 'string', enum: ['Job', 'Freelance'] },
    location: { type: 'string' },
    work_mode: { type: 'string' },
    geo_eligibility: {
      type: 'string',
      enum: [
        'israel_eligible',
        'worldwide',
        'no_restriction_stated',
        'restricted_excludes_israel',
        'unknown',
      ],
    },
    salary: { type: 'string' },
    match_score: { type: 'integer', minimum: 0, maximum: 100 },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    why_it_fits: { type: 'string' },
    source: { type: 'string' },
    source_type: { type: 'string' },
    job_url: { type: 'string' },
    status: { type: 'string', enum: ['Active', 'Closed'] },
    notes: { type: 'string' },
  };

  return {
    type: 'object',
    properties: {
      [resultKey]: {
        type: 'array',
        items: {
          type: 'object',
          properties: itemProperties,
          required: Object.keys(itemProperties),
          additionalProperties: false,
        },
      },
      search_notes: { type: 'string' },
      inaccessible_count: { type: 'integer', minimum: 0 },
      miss_reasons: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'login_wall',
            'no_public_permalink',
            'too_old',
            'generic_group_url',
            'low_score',
            'irrelevant',
            'index_not_found',
          ],
        },
      },
    },
    required: [resultKey, 'search_notes', 'inaccessible_count', 'miss_reasons'],
    additionalProperties: false,
  };
}
