/**
 * Answers one question: does this posting still exist?
 *
 * Redirects are followed by hand because UrlFetchApp's followRedirects:true never
 * exposes the landing URL, so a removed posting that bounces to a careers hub or
 * the site root looks like a healthy HTTP 200.
 */
const CLOSED_POSTING_PATTERN = new RegExp([
  'no longer accepting applications',
  '(?:job|position|role|posting|vacancy|listing|opportunity)[^.!?]{0,60}(?:is |has been |was )?no longer (?:available|active|open|posted|accepting)',
  'this (?:job|position|role|posting|listing) (?:has )?(?:expired|been removed|been filled|been closed)',
  'position (?:has been )?filled',
  'role has been filled',
  'job (?:is )?expired',
  'position (?:is )?closed',
  'applications (?:are|have been) closed',
  'we are no longer hiring for this',
  'המשרה אינה פעילה',
  'המשרה נסגרה',
  'המשרה אוישה',
  'המשרה הוסרה',
  'המשרה כבר לא',
  'המודעה הוסרה',
  'לא ניתן להגיש מועמדות',
].join('|'), 'i');

/**
 * Landing pages that cannot be the posting. Board hubs and taxonomy listings are
 * UrlInspector's isListingHubUrl_; these are the site-root and error pages on top.
 * Matched against the path only, so query strings and hosts never false-positive.
 */
const HUB_PATH_PATTERNS = Object.freeze([
  /^\/(?:home|index(?:\.\w{2,5})?|default(?:\.\w{2,5})?)$/i,
  /^\/[a-z]{2}(?:-[a-z]{2})?$/i,
  /\/(?:404|not-found|page-not-found|pagenotfound|error|expired|no-longer-available)$/i,
]);

const NOT_FOUND_TITLE_PATTERN = /(?:\b404\b|page not found|page cannot be found|page (?:no longer|does ?n[o']?t) exist|הדף לא נמצא)/i;

/**
 * Boards such as Greenhouse answer a dead posting with a 301 to their board root
 * carrying an error flag, e.g. /unframe?error=true, which is a 200 page.
 */
const ERROR_QUERY_PATTERN = /[?&](?:error|errorcode|not_?found|jobnotfound|expired|invalid)(?:=[^&]*)?(?:&|$)/i;

/**
 * A hostname that does not resolve is not a hiccup: the careers site itself was
 * torn down, so the posting is gone. Everything else that throws (timeouts,
 * refused connections, TLS trouble) may recover, so it only earns a strike.
 */
const DEAD_HOST_FAILURE_PATTERN = /(?:dns error|(?:unable|could not|couldn't|failed) to resolve|name (?:not|could not be) resolved|no such host|nxdomain|unknown host|invalid (?:url|argument)|malformed url)/i;

function inspectJobUrl_(url) {
  return inspectJobUrls_([url])[0];
}

/**
 * Checks many URLs at once. Every hop of the redirect chain runs as one parallel
 * fetchAll round, so N postings cost about as much wall time as the slowest one.
 */
function inspectJobUrls_(urls) {
  const targets = (urls || []).map((url) => cleanString_(url));
  if (!targets.length) return [];

  return resolveFinalResponses_(targets).map((resolved) => {
    try {
      return classifyLiveness_(resolved);
    } catch (error) {
      console.log(`Arrr, liveness check was inconclusive for ${resolved.originalUrl}: ${error}`);
      return inconclusiveVerdict_('URL check failed; treated as inconclusive.');
    }
  });
}

function resolveFinalResponses_(urls) {
  const results = new Array(urls.length);
  let pending = urls.map((url, index) => ({ index, originalUrl: url, currentUrl: url, hops: 0 }));

  while (pending.length) {
    const outcomes = fetchWithoutRedirects_(pending.map((item) => item.currentUrl));
    const nextPending = [];

    pending.forEach((item, position) => {
      const outcome = outcomes[position] || { response: null, failure: null };
      const response = outcome.response;
      if (!response) {
        results[item.index] = {
          originalUrl: item.originalUrl,
          finalUrl: item.currentUrl,
          response: null,
          failure: outcome.failure,
        };
        return;
      }

      const code = response.getResponseCode();
      const location = code >= 300 && code < 400
        ? headerValue_(response.getAllHeaders(), 'location')
        : '';

      if (location && item.hops < CONFIG.LIVENESS.MAX_REDIRECT_HOPS) {
        const target = resolveRedirectUrl_(location, item.currentUrl);

        // Judge the target before fetching it: a hub or error landing page is
        // already proof the posting is gone, and skipping that fetch also keeps
        // the verdict when the hub itself is slow or blocks us.
        const verdict = classifyRedirectTarget_(item.originalUrl, target);
        if (verdict) {
          results[item.index] = { originalUrl: item.originalUrl, finalUrl: target, response: null, verdict };
          return;
        }

        nextPending.push({
          index: item.index,
          originalUrl: item.originalUrl,
          currentUrl: target,
          hops: item.hops + 1,
        });
        return;
      }

      results[item.index] = { originalUrl: item.originalUrl, finalUrl: item.currentUrl, response };
    });

    pending = nextPending;
  }

  return results;
}

/** Returns one { response, failure } outcome per URL, in the order given. */
function fetchWithoutRedirects_(urls) {
  const outcomes = [];

  chunk_(urls.map(buildLivenessRequest_), CONFIG.LIVENESS.MAX_PARALLEL_FETCH).forEach((batch) => {
    try {
      UrlFetchApp.fetchAll(batch).forEach((response) => outcomes.push({ response, failure: null }));
    } catch (error) {
      // fetchAll rejects the whole batch when a single URL fails at the network
      // level, so retry one by one to keep the other checks alive and to learn
      // which URL actually failed.
      console.log(`Arrr, a batched URL check sank, retrying one by one: ${error}`);
      batch.forEach((request) => outcomes.push(fetchLivenessSingle_(request)));
    }
  });

  return outcomes;
}

function fetchLivenessSingle_(request) {
  try {
    return { response: UrlFetchApp.fetch(request.url, request), failure: null };
  } catch (error) {
    const message = cleanString_(error && error.message ? error.message : error);
    const deadHost = DEAD_HOST_FAILURE_PATTERN.test(message);
    console.log(`Arrr, URL check failed for ${request.url} (${deadHost ? 'dead host' : 'unreachable'}): ${message}`);
    return { response: null, failure: { deadHost, message } };
  }
}

function buildLivenessRequest_(url) {
  return {
    url,
    method: 'get',
    followRedirects: false,
    muteHttpExceptions: true,
    validateHttpsCertificates: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; OpportunityTracker/1.0)',
      Accept: 'text/html,application/xhtml+xml',
    },
    timeoutSeconds: CONFIG.LIVENESS.FETCH_TIMEOUT_SECONDS,
  };
}

function classifyLiveness_(resolved) {
  if (resolved.verdict) return resolved.verdict;

  const response = resolved.response;
  if (!response) {
    const failure = resolved.failure;
    if (failure && failure.deadHost) {
      return closedVerdict_(`Host no longer exists (${failure.message}).`);
    }
    return unreachableVerdict_(failure ? `Unreachable: ${failure.message}` : 'URL check failed; page did not load.');
  }

  const code = response.getResponseCode();
  if (code === 404 || code === 410) {
    return closedVerdict_(`Direct page returned HTTP ${code}.`);
  }
  if (code === 401 || code === 403) {
    return inconclusiveVerdict_(`HTTP ${code}; public access blocked or login wall.`);
  }
  if (code >= 300 && code < 400) {
    return inconclusiveVerdict_(`HTTP ${code}; redirect chain did not resolve.`);
  }
  if (code < 200 || code >= 400) {
    return inconclusiveVerdict_(`HTTP ${code}; treated as inconclusive.`);
  }

  const html = response.getContentText().slice(0, CONFIG.LIVENESS.MAX_BODY_CHARS);
  const plain = stripHtml_(html);

  if (/janglo\.net/i.test(resolved.finalUrl) && isJangloRemovedListingPage_(plain)) {
    return closedVerdict_('Janglo listing page is invalid or the post was removed.');
  }
  if (isNotFoundTitle_(html)) {
    return closedVerdict_('Page title reports a missing page (soft 404).');
  }
  if (CLOSED_POSTING_PATTERN.test(plain)) {
    return {
      definitelyClosed: true,
      reason: 'Direct page contains explicit closed/expired wording.',
      accessible: true,
    };
  }

  return { definitelyClosed: false, reason: '', accessible: true };
}

/**
 * Returns a closed verdict when the redirect landed somewhere that cannot be the
 * posting any more, or null when the landing page is still plausibly the job.
 */
function classifyRedirectTarget_(originalUrl, finalUrl) {
  const from = normalizeUrl_(originalUrl);
  const to = normalizeUrl_(finalUrl);
  if (!to || from === to) return null;

  if (isHubOrRootUrl_(finalUrl)) {
    return closedVerdict_(`Redirected to a hub or site root (${finalUrl}); the posting is gone.`);
  }
  if (ERROR_QUERY_PATTERN.test(finalUrl)) {
    return closedVerdict_(`Redirected to an error page (${finalUrl}); the posting is gone.`);
  }

  // Only strong ids are trusted here: a slug rename is a normal redirect, but
  // losing a numeric/uuid posting id means the posting itself is gone.
  const postingId = extractStrongJobId_(originalUrl);
  if (postingId && to.indexOf(String(postingId).toLowerCase()) === -1) {
    return closedVerdict_(`Redirected away from posting ${postingId} to ${finalUrl}.`);
  }

  return null;
}

function isHubOrRootUrl_(url) {
  const path = urlPath_(url).replace(/\/+$/, '');
  if (!path) return true;
  if (HUB_PATH_PATTERNS.some((pattern) => pattern.test(path))) return true;
  return isListingHubUrl_(url);
}

function resolveRedirectUrl_(location, baseUrl) {
  const value = cleanString_(location);
  if (!value) return baseUrl;
  if (/^https?:\/\//i.test(value)) return value;

  const base = cleanString_(baseUrl).match(/^(https?:)\/\/([^/]+)(\/[^?#]*)?/i);
  if (!base) return value;

  const scheme = base[1];
  const origin = `${scheme}//${base[2]}`;
  if (value.indexOf('//') === 0) return `${scheme}${value}`;
  if (value.charAt(0) === '/') return `${origin}${value}`;

  const basePath = (base[3] || '/').replace(/[^/]*$/, '');
  return `${origin}${basePath}${value}`;
}

function headerValue_(headers, name) {
  const target = String(name).toLowerCase();
  const keys = Object.keys(headers || {});

  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index].toLowerCase() !== target) continue;
    const value = headers[keys[index]];
    return cleanString_(Array.isArray(value) ? value[value.length - 1] : value);
  }

  return '';
}

function isNotFoundTitle_(html) {
  const match = cleanString_(html).match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!match) return false;
  return NOT_FOUND_TITLE_PATTERN.test(stripHtml_(match[1]));
}

function isJangloRemovedListingPage_(plainText) {
  const value = cleanString_(plainText);
  if (!value) return false;
  return /invalid\s+url/i.test(value)
    || /listing\s+(?:is\s+)?(?:no longer|not)\s+(?:available|active)/i.test(value)
    || /this\s+(?:listing|post)\s+(?:has been\s+)?(?:removed|deleted|expired)/i.test(value);
}

function closedVerdict_(reason) {
  return { definitelyClosed: true, reason, accessible: false, unreachable: false };
}

function inconclusiveVerdict_(reason) {
  return { definitelyClosed: false, reason, accessible: false, unreachable: false };
}

/** Not proof of death on its own, but it earns the row a strike in the recheck. */
function unreachableVerdict_(reason) {
  return { definitelyClosed: false, reason, accessible: false, unreachable: true };
}
