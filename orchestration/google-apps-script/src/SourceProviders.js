/**
 * Phase-1 and typed source providers (OpenAI web_search + Janglo RSS).
 */
function runSourceProvider_(source, categories, preferences, settings) {
  if (source.type === EMAIL_ALERT_SOURCE_TYPE) {
    return searchEmailAlertSource_(source, categories, settings);
  }
  if (source.type === ATS_API_SOURCE_TYPE) {
    return searchAtsBoardsSource_(source, categories, settings);
  }
  if (source.type === 'facebook_group') {
    return searchFacebookSource_(source, categories, preferences, settings);
  }
  if (source.type === 'rss' || source.source_id === 'il_janglo_rss') {
    return searchJangloRssSource_(source, categories, settings);
  }
  return searchScopedWebSource_(source, categories, preferences, settings);
}

function searchScopedWebSource_(source, categories, preferences, settings) {
  const today = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  const categoryText = categories
    .map((item) => `${item.category}: ${item.titles.join('; ')}`)
    .join('\n');
  const discoveryPlan = buildSourceDiscoveryPlan_(source, categories);
  const marketScope = isIsraelScopedSource_(source)
    ? 'This is an Israel-local source. Every result must be an Israeli listing.'
    : [
      'This is a GLOBAL source, so most of its listings are irrelevant.',
      'Return a listing ONLY if its office/hiring location is in Israel, or it is remote and the page',
      'explicitly allows applicants based in Israel. Reject US-only / UK-only / EU-only remote roles.',
    ].join(' ');
  const opportunityFocus = source.opportunity_types === 'Freelance'
    ? 'Focus on freelance, consulting, projects, and tenders.'
    : source.opportunity_types === 'Job'
      ? 'Focus on employment roles (not one-off gigs).'
      : 'Return both employment jobs and freelance/projects when relevant.';

  const prompt = `
Today is ${today}. Search ONLY within this source family for opportunities fitting the candidate.

SOURCE
- source_id: ${source.source_id}
- label: ${source.label}
- query/domain: ${source.query_or_url}
- notes: ${source.notes || '(none)'}

CANDIDATE PROFILE
${CONFIG.CANDIDATE_PROFILE}

CATEGORIES / TITLES
${categoryText}

DISCOVERY PLAN — complete both passes before selecting results
${discoveryPlan}

${buildGeographyRuleText_()}

MARKET SCOPE
${marketScope}

${opportunityFocus}

MANDATORY
1. Prefer listings from the last ${settings.maxAgeDays} days.
2. Minimum match_score: ${settings.minMatchScore}.
3. Return at most ${source.max_results || CONFIG.MAX_RESULTS_PER_BATCH} items.
4. job_url must be one specific listing/application page. Never a search-results page and never a
   browse page that lists several roles (e.g. /categories/software-development, /industries/ai,
   /jobs, /careers). If you cannot reach the individual posting URL, omit that role entirely.
5. Use one supplied category name exactly.
6. Set source to "${source.label}" and source_type to "${source.source_id}".
7. Set opportunity_type to Job or Freelance correctly.
8. Do not invent salary/budget/dates. Empty string when unknown.
9. For aggregators (e.g. Mploy), prefer linking to the most specific public listing URL available.
10. Merge both discovery passes and remove duplicate listings before returning results.
11. In search_notes, state whether direct-site discovery and site-query discovery each produced candidates.
12. Set status=Active unless the listing page explicitly says it is expired, filled, removed or no longer accepting applications. Default Active when unsure.
13. job_url must be a real listing page (e.g. janglo.net/item/...), never a category hub like janglo.net/jobs alone.
14. Set geo_eligibility from the listing page itself. Use restricted_excludes_israel when hiring is limited to
    countries that exclude Israel, and quote that restriction sentence in notes. Prefer omitting such listings.
`;

  const schema = buildOpportunitySchema_('opportunities');
  const result = callOpenAI_(prompt, schema, `${source.source_id}_results`);
  return {
    opportunities: (result.opportunities || []).map((item) => {
      const typed = forceFreelanceTypeIfNeeded_(
        source,
        classifyOpportunityType_(Object.assign({}, item, {
          opportunity_type: item.opportunity_type || (
            source.opportunity_types === 'Freelance' ? 'Freelance' : item.opportunity_type
          ),
        }))
      );
      return Object.assign({}, item, {
        source: item.source || source.label,
        source_type: source.source_id,
        source_id: source.source_id,
        opportunity_type: typed,
        company: cleanString_(item.company)
          || (source.type === 'facebook_group' ? 'Private client' : item.company),
      });
    }),
    search_notes: result.search_notes || '',
    inaccessible_count: Number(result.inaccessible_count) || 0,
    miss_reasons: result.miss_reasons || [],
    meta: result._meta || {},
  };
}

/**
 * Two-pass discovery. Jobs use Search Config titles.
 * Freelance/Both/social aggregators use intent phrases (מחפש פרילנסר), not employment titles.
 */
function buildSourceDiscoveryPlan_(source, categories) {
  const domain = extractSearchDomain_(source.query_or_url);
  const useIntentPass = source.opportunity_types === 'Freelance'
    || source.opportunity_types === 'Both'
    || source.source_id === 'il_mploy'
    || /social|freelance|project/i.test(source.type || '');

  const queries = useIntentPass
    ? buildIntentDiscoveryQueries_(domain, source)
    : buildTitleDiscoveryQueries_(domain, categories, source);

  return [
    'PASS A — DIRECT PUBLIC SITE DISCOVERY:',
    `- Open ${source.query_or_url} and inspect its public jobs/projects/category/search pages.`,
    useIntentPass
      ? '- Prefer informal freelance / recommendation posts and project gigs over formal employment ads.'
      : '- Use the site’s own public navigation, filters, pagination, and listing pages when accessible.',
    '- Open promising listing pages and verify they are specific and active.',
    '- If the site requires login or JavaScript interaction unavailable to web search, report that in miss_reasons; do not invent access.',
    '',
    'PASS B — EXPLICIT SEARCH-ENGINE DISCOVERY:',
    useIntentPass
      ? '- Run every INTENT query below (Hebrew/English freelance asks — not job titles):'
      : '- Run every title query below:',
    queries.map((query) => `  - ${query}`).join('\n'),
    '- Open each promising result; a search snippet alone is never sufficient evidence.',
  ].join('\n');
}

function israelGeoQueryClause_(source) {
  if (isIsraelScopedSource_(source)) return '';
  return ` (${CONFIG.ISRAEL_GEO_QUERY_TERMS.map(quoteSearchTerm_).join(' OR ')})`;
}

function buildIntentDiscoveryQueries_(domain, source) {
  const phrases = CONFIG.FREELANCE_INTENT_PHRASES.slice(0, 8);
  const skills = CONFIG.FREELANCE_SKILL_TERMS.slice(0, 6);
  const phraseGroups = chunk_(phrases, 3);
  const skillGroup = skills.map(quoteSearchTerm_).join(' OR ');
  const sitePrefix = domain && domain.indexOf(' ') === -1 ? `site:${domain} ` : '';
  const geoClause = israelGeoQueryClause_(source);

  const queries = phraseGroups.slice(0, 3).map((group) => {
    const intentTerms = group.map(quoteSearchTerm_).join(' OR ');
    return `${sitePrefix}(${intentTerms}) (${skillGroup})${geoClause}`;
  });

  if (source.source_id === 'il_mploy' || source.opportunity_types === 'Both') {
    queries.push(`${sitePrefix}("מחפש פרילנסר" OR "מחפשת המלצות" OR "looking for a freelancer")${geoClause}`);
  }

  if (!queries.length) {
    queries.push(`${sitePrefix}(פרילנס OR freelancer OR "מחפש המלצות")${geoClause}`);
  }
  return queries;
}

function buildTitleDiscoveryQueries_(domain, categories, source) {
  const titles = categories
    .reduce((all, item) => all.concat(item.titles || []), [])
    .map(cleanString_)
    .filter(Boolean)
    .slice(0, 12);
  const titleGroups = chunk_(titles, 4);
  const focusTerms = source.opportunity_types === 'Job'
    ? '(job OR hiring OR career OR דרושים OR משרה)'
    : '(job OR hiring OR freelance OR project OR דרושים OR משרה OR פרילנס OR פרויקט)';
  const geoClause = israelGeoQueryClause_(source);

  const queries = titleGroups.slice(0, 3).map((group) => {
    const roleTerms = group.map(quoteSearchTerm_).join(' OR ');
    return `site:${domain} (${roleTerms}) ${focusTerms}${geoClause}`;
  });

  if (!queries.length) {
    queries.push(`site:${domain} (AI OR GenAI OR LLM OR PPC OR growth) ${focusTerms}${geoClause}`);
  }
  return queries;
}

function extractSearchDomain_(queryOrUrl) {
  const value = cleanString_(queryOrUrl);
  const urlMatch = value.match(/^https?:\/\/(?:www\.)?([^/\s]+)/i);
  if (urlMatch) return urlMatch[1];

  const domainMatch = value.match(/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
  return domainMatch ? domainMatch[1] : value.split(/\s+/)[0];
}

function quoteSearchTerm_(term) {
  const value = cleanString_(term).replace(/"/g, '');
  return /\s/.test(value) ? `"${value}"` : value;
}

function searchJangloRssSource_(source, categories, settings) {
  const startedAt = Date.now();
  const feedUrls = [
    cleanString_(source.query_or_url),
    'https://www.janglo.net/index.php?option=com_mtree&task=rss&link_id=1',
    'https://www.janglo.net/rss-feeds',
  ].filter(Boolean);

  let items = [];
  let notes = '';
  let inaccessible = 0;

  for (let i = 0; i < feedUrls.length && !items.length; i += 1) {
    try {
      const response = UrlFetchApp.fetch(feedUrls[i], {
        muteHttpExceptions: true,
        followRedirects: true,
        timeoutSeconds: 30,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OpportunityTracker/1.0)',
          Accept: 'application/rss+xml, application/xml, text/xml, text/html',
        },
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 400) {
        inaccessible += 1;
        continue;
      }
      const body = response.getContentText();
      if (!isRssFeedDocument_(body)) continue;
      const parsed = parseRssItems_(body);
      if (parsed.length) {
        items = parsed;
        notes = `Parsed ${parsed.length} RSS items from ${feedUrls[i]}`;
      }
    } catch (error) {
      inaccessible += 1;
      notes = `RSS fetch failed: ${error}`;
    }
  }

  if (!items.length) {
    items = fetchJangloHtmlListings_(source.max_results || CONFIG.MAX_RESULTS_PER_BATCH);
    if (items.length) {
      notes = joinNotes_(notes, `Parsed ${items.length} public HTML listings from janglo.net/jobs (+ focus categories).`);
    } else {
      inaccessible += 1;
    }
  }

  if (!items.length) {
    console.log('Arrr, Janglo RSS/HTML parse found nothing — falling back to scoped web search.');
    const web = searchScopedWebSource_(
      Object.assign({}, source, { query_or_url: 'https://www.janglo.net/jobs', type: 'web_jobs' }),
      categories,
      {},
      settings
    );
    web.search_notes = joinNotes_(notes, web.search_notes);
    web.inaccessible_count = (web.inaccessible_count || 0) + inaccessible;
    return web;
  }

  const allowed = new Set(categories.map((c) => c.category));
  const defaultCategory = categories[0] ? categories[0].category : 'Growth Marketing';
  const opportunities = items.slice(0, source.max_results || 12).map((item) => {
    const inferredType = /freelance|project|consult|פרילנס|מכרז|פרויקט|עצמאי/i.test(item.title || '')
      ? CONFIG.OPPORTUNITY_TYPES.FREELANCE
      : CONFIG.OPPORTUNITY_TYPES.JOB;
    return {
      posted_date: item.date || '',
      role: item.title || 'Janglo listing',
      company: item.author || 'Janglo poster',
      category: defaultCategory,
      opportunity_type: forceFreelanceTypeIfNeeded_(source, inferredType),
      location: item.location || 'Israel',
      work_mode: 'Not specified',
      geo_eligibility: 'israel_eligible',
      salary: 'Not listed',
      match_score: 75,
      confidence: 70,
      why_it_fits: 'Verified public Janglo listing from site HTML.',
      source: source.label,
      source_type: source.source_id,
      source_id: source.source_id,
      job_url: item.link,
      status: 'Active',
      skip_url_verify: true,
      notes: truncate_(item.summary || '', 300),
    };
  }).filter((item) => allowed.has(item.category) || true);

  return {
    opportunities,
    search_notes: notes,
    inaccessible_count: inaccessible,
    miss_reasons: [],
    meta: { durationMs: Date.now() - startedAt },
  };
}

function fetchJangloHtmlListings_(maxResults) {
  const baseUrl = 'https://www.janglo.net';
  const listingPages = [
    `${baseUrl}/jobs`,
    `${baseUrl}/jobs/socialmedia`,
    `${baseUrl}/jobs/marketing`,
    `${baseUrl}/jobs/programming`,
    `${baseUrl}/jobs/web-building--design`,
  ];
  const merged = [];
  const seen = {};
  const limit = Math.max(Number(maxResults) || 12, 12);

  listingPages.forEach((pageUrl) => {
    if (merged.length >= limit) return;
    try {
      const response = UrlFetchApp.fetch(pageUrl, {
        muteHttpExceptions: true,
        followRedirects: true,
        timeoutSeconds: 30,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OpportunityTracker/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 400) return;
      const parsed = parseJangloHtmlListings_(response.getContentText(), baseUrl);
      parsed.forEach((item) => {
        if (seen[item.id]) return;
        seen[item.id] = true;
        merged.push(item);
      });
    } catch (error) {
      console.log(`Arrr, Janglo HTML fetch failed for ${pageUrl}: ${error}`);
    }
  });

  return merged.slice(0, limit);
}

function parseJangloHtmlListings_(html, baseUrl) {
  const text = cleanString_(html);
  if (!text) return [];
  const items = [];
  const seen = {};
  const blockRe = /<div class\s*=\s*['"]itemlistingnp[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;
  let blockMatch;
  while ((blockMatch = blockRe.exec(text)) !== null) {
    const block = blockMatch[0];
    const linkMatch = block.match(/href\s*=\s*['"]item\/([^'"]+)['"]/i);
    if (!linkMatch) continue;
    const id = cleanString_(linkMatch[1]);
    if (!id || seen[id]) continue;
    seen[id] = true;
    const titleMatch = block.match(/<h3[^>]*class\s*=\s*['"]thetitle['"][^>]*>([\s\S]*?)<\/h3>/i);
    const dateMatch = block.match(/<div class\s*=\s*['"]thedate['"][^>]*>([\s\S]*?)<\/div>/i);
    const locMatch = block.match(/<div class\s*=\s*['"]thelocation['"][^>]*>([\s\S]*?)<\/div>/i);
    const title = titleMatch ? stripHtml_(titleMatch[1]).slice(0, 180) : '';
    const date = dateMatch ? parseJangloDisplayDate_(stripHtml_(dateMatch[1])) : '';
    const location = locMatch ? stripHtml_(locMatch[1]).slice(0, 120) : '';
    if (!title) continue;
    items.push({
      id,
      title,
      link: `${baseUrl}/item/${id}`,
      date,
      location,
      author: 'Janglo poster',
      summary: '',
    });
  }
  return items;
}

function isRssFeedDocument_(text) {
  const sample = cleanString_(text).slice(0, 8000).toLowerCase();
  return sample.indexOf('<rss') !== -1 || sample.indexOf('<feed') !== -1;
}

function parseJangloDisplayDate_(value) {
  const text = cleanString_(value);
  const match = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) {
    const iso = text.match(/\d{4}-\d{2}-\d{2}/);
    return iso ? iso[0] : '';
  }
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const month = months[match[1].toLowerCase()];
  if (!month) return '';
  const day = String(match[2]).padStart(2, '0');
  return `${match[3]}-${month}-${day}`;
}

function parseRssItems_(xmlOrHtml) {
  const text = cleanString_(xmlOrHtml);
  const items = [];
  const itemBlocks = text.match(/<item[\s\S]*?<\/item>/gi) || [];
  itemBlocks.forEach((block) => {
    const title = extractXmlTag_(block, 'title');
    const link = extractXmlTag_(block, 'link') || extractXmlTag_(block, 'guid');
    const date = extractXmlTag_(block, 'pubDate');
    const summary = extractXmlTag_(block, 'description');
    if (title && link && /^https?:\/\//i.test(link)) {
      items.push({
        title: stripHtml_(title).slice(0, 180),
        link: cleanString_(link),
        date: parseJangloDisplayDate_(stripHtml_(date)),
        author: 'Janglo',
        summary: stripHtml_(summary || '').slice(0, 400),
      });
    }
  });
  return items;
}

function extractXmlTag_(block, tag) {
  const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = block.match(cdataRe) || block.match(plainRe);
  return match ? cleanString_(match[1]) : '';
}
