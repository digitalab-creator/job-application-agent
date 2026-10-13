/**
 * Job alert email ingestion.
 *
 * Boards that forbid scraping still mail their listings to a subscriber, so this reads
 * the alerts already sitting in Gmail instead of visiting those sites. Links are pulled
 * out deterministically and one model call scores the batch, so the run cost does not
 * grow with the number of boards subscribed to.
 */

/**
 * Per-board link recognition. Alert mail wraps every link in click tracking, so the
 * posting id is the only stable part — each board rebuilds a canonical URL from it.
 */
const ALERT_BOARDS = Object.freeze([
  Object.freeze({
    id: 'linkedin',
    label: 'LinkedIn Jobs',
    pattern: /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d{6,})/i,
    canonical: (id) => `https://www.linkedin.com/jobs/view/${id}/`,
  }),
  Object.freeze({
    id: 'alljobs',
    label: 'AllJobs',
    pattern: /alljobs\.co\.il\/[^\s"'<>]*?JobID=(\d+)/i,
    canonical: (id) => `https://www.alljobs.co.il/Search/UploadSingle.aspx?JobID=${id}`,
  }),
  Object.freeze({
    id: 'indeed',
    label: 'Indeed Israel',
    pattern: /indeed\.com\/[^\s"'<>]*?[?&]jk=([0-9a-f]{8,})/i,
    canonical: (id) => `https://il.indeed.com/viewjob?jk=${id}`,
  }),
  Object.freeze({
    id: 'drushim',
    label: 'Drushim',
    pattern: /drushim\.co\.il\/(?:job|jobs)\/(\d+)/i,
    canonical: (id) => `https://www.drushim.co.il/job/${id}/`,
  }),
  Object.freeze({
    id: 'jobmaster',
    label: 'JobMaster',
    pattern: /jobmaster\.co\.il\/(?:job|jobs)\/[^\s"'<>]*?(\d{4,})/i,
    canonical: (id) => `https://www.jobmaster.co.il/job/${id}/`,
  }),
]);

/** Alert mail is mostly chrome: unsubscribe, prefs, app-store badges, the board's own home page. */
const ALERT_NOISE_URL_PATTERN = new RegExp([
  'unsubscribe', 'optout', 'opt-out', 'preferences', 'settings', 'privacy', 'terms',
  'help\\.', 'support\\.', 'itunes', 'apps\\.apple', 'play\\.google', 'facebook\\.com',
  'twitter\\.com', 'instagram\\.com', 'youtube\\.com', 'psettings', 'account',
].join('|'), 'i');

function readJobAlertEmails_(options) {
  const config = CONFIG.GMAIL_ALERTS;
  const settings = options || {};
  const label = cleanString_(settings.label) || config.LABEL;
  const lookbackDays = Number(settings.lookbackDays) || config.LOOKBACK_DAYS;
  const query = `label:${label} newer_than:${lookbackDays}d`;

  let threads = [];
  try {
    threads = GmailApp.search(query, 0, config.MAX_THREADS);
  } catch (error) {
    // Most likely the added Gmail scope has not been re-authorized yet. Report it and let
    // the rest of the run continue rather than losing every other source to one channel.
    const reason = `Cannot read Gmail (${error}). Open the Sheet and re-authorize the script.`;
    log_('WARN', `Job alert ingestion skipped — ${reason}`, query);
    return { links: [], threadCount: 0, messageCount: 0, label, query, error: reason };
  }

  if (!threads.length) {
    console.log(`Arrr, no job alert mail under label "${label}" in the last ${lookbackDays} days.`);
    return { links: [], threadCount: 0, messageCount: 0, label, query };
  }

  const collected = [];
  const seenUrls = {};
  let messageCount = 0;

  threads.forEach((thread) => {
    thread.getMessages()
      .slice(-config.MAX_MESSAGES_PER_THREAD)
      .forEach((message) => {
        messageCount += 1;
        let body = '';
        try {
          body = message.getBody() || message.getPlainBody() || '';
        } catch (error) {
          console.log(`Arrr, could not read an alert message: ${error}`);
          return;
        }
        extractAlertJobLinks_(body).forEach((link) => {
          if (seenUrls[link.url]) return;
          if (collected.length >= config.MAX_LINKS_PER_RUN) return;
          seenUrls[link.url] = true;
          collected.push(Object.assign({}, link, {
            received: formatAlertDate_(message.getDate()),
          }));
        });
      });
  });

  console.log(`Arrr, ${collected.length} job links from ${messageCount} alert messages.`);
  return {
    links: collected,
    threadCount: threads.length,
    messageCount,
    label,
    query,
  };
}

/**
 * Pull postings out of one alert email. Anchor text carries the role title on every
 * board tried, so it is kept as a hint rather than asking the model to invent one.
 */
function extractAlertJobLinks_(html) {
  const body = cleanString_(html);
  if (!body) return [];

  const found = [];
  const seen = {};

  function record(rawUrl, titleHint) {
    const url = unwrapTrackingUrl_(rawUrl);
    if (!url || ALERT_NOISE_URL_PATTERN.test(url)) return;

    for (let i = 0; i < ALERT_BOARDS.length; i += 1) {
      const board = ALERT_BOARDS[i];
      const match = url.match(board.pattern);
      if (!match) continue;
      const canonical = board.canonical(match[1]);
      if (seen[canonical]) return;
      seen[canonical] = true;
      found.push({
        url: canonical,
        board: board.id,
        boardLabel: board.label,
        title: truncate_(stripHtml_(titleHint), 200),
      });
      return;
    }
  }

  const anchorRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchorRe.exec(body)) !== null) {
    record(anchor[1], anchor[2]);
  }

  // Plain-text alerts have no anchors, so sweep bare URLs as well.
  const bareRe = /https?:\/\/[^\s"'<>]+/gi;
  let bare;
  while ((bare = bareRe.exec(body)) !== null) {
    record(bare[0], '');
  }

  return found;
}

/**
 * Click trackers carry the real destination as an encoded query parameter. Unwrap it so
 * the board patterns match the posting rather than the redirector's own domain.
 */
function unwrapTrackingUrl_(rawUrl) {
  let url = decodeHtmlEntities_(rawUrl);
  if (!/^https?:\/\//i.test(url)) return '';

  for (let hop = 0; hop < 3; hop += 1) {
    const encoded = url.match(/[?&](?:url|u|target|redirect|redirect_uri|dest|destination|link)=([^&]+)/i);
    if (!encoded) break;
    let decoded = '';
    try {
      decoded = decodeURIComponent(encoded[1]);
    } catch (error) {
      console.log(`Arrr, undecodable tracking link skipped: ${error}`);
      break;
    }
    if (!/^https?:\/\//i.test(decoded)) break;
    url = decoded;
  }

  return url;
}

function formatAlertDate_(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

/**
 * Source provider entry point. Reads the labelled inbox, then scores everything found in
 * a single call — no web search, since the alert already supplies role, board and URL.
 */
function searchEmailAlertSource_(source, categories, settings) {
  const startedAt = Date.now();
  const inbox = readJobAlertEmails_({ label: cleanString_(source.query_or_url) });

  if (!inbox.links.length) {
    return {
      opportunities: [],
      search_notes: inbox.error || `No job alert mail under label "${inbox.label}". `
        + 'Create saved-search alerts on the boards and a Gmail filter applying that label.',
      inaccessible_count: inbox.error ? 1 : 0,
      miss_reasons: [],
      meta: { durationMs: Date.now() - startedAt },
    };
  }

  const listings = inbox.links.map((link) => ({
    url: link.url,
    title: link.title,
    sourceLabel: link.boardLabel,
    details: link.received ? `emailed: ${link.received}` : '',
  }));

  const scored = scoreFetchedListings_(listings, categories, settings, {
    originDescription: 'job alert emails the candidate subscribed to',
    schemaName: 'email_alert_results',
    minMatchScore: CONFIG.GMAIL_ALERTS.MIN_MATCH_SCORE,
    evidenceNote: 'An alert gives little beyond the title, so keep confidence below 60.',
  });

  const byUrl = {};
  inbox.links.forEach((link) => { byUrl[link.url] = link; });

  const opportunities = reconcileScoredListings_(scored, listings, (item, listing) => {
    const link = byUrl[listing.url];
    return Object.assign({}, item, {
      source: link.boardLabel,
      // Keeps per-board attribution in the sheet even though one row owns the stats.
      source_type: `email_${link.board}`,
      source_id: source.source_id,
      opportunity_type: classifyOpportunityType_(item),
      posted_date: cleanString_(item.posted_date) || link.received,
    });
  });

  return {
    opportunities,
    search_notes: joinNotes_(
      `Read ${inbox.messageCount} alert messages under "${inbox.label}" and found ${inbox.links.length} postings.`,
      scored.search_notes || ''
    ),
    inaccessible_count: 0,
    miss_reasons: scored.miss_reasons || [],
    meta: scored._meta || { durationMs: Date.now() - startedAt },
  };
}

/**
 * Menu diagnostic: proves the label, filter and parsing work before a real run depends on them.
 */
function checkJobAlertInbox() {
  const inbox = readJobAlertEmails_({});
  const byBoard = {};
  inbox.links.forEach((link) => {
    byBoard[link.boardLabel] = (byBoard[link.boardLabel] || 0) + 1;
  });

  const summary = inbox.links.length
    ? `Found ${inbox.links.length} job links in ${inbox.messageCount} messages: ${JSON.stringify(byBoard)}`
    : `No job links found. Searched: ${inbox.query}`;

  log_('INFO', `Job alert inbox check — ${summary}`, JSON.stringify({
    query: inbox.query,
    threads: inbox.threadCount,
    messages: inbox.messageCount,
    byBoard,
    sample: inbox.links.slice(0, 10),
  }, null, 2));

  const ui = tryGetUi_();
  if (ui) ui.alert(summary);
}
