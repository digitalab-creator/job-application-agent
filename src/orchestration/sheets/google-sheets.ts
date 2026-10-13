import { googleAccessTokenFromRefresh } from "./google-auth.js";

export { googleAccessTokenFromRefresh };

export type SheetRow = Record<string, string | number> & { row_number?: number };

async function sheetsFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export async function readSheetValues(
  refreshToken: string,
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const token = await googleAccessTokenFromRefresh(refreshToken);
  const encoded = encodeURIComponent(range);
  const res = await sheetsFetch(token, `/${spreadsheetId}/values/${encoded}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets read failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

export async function appendSheetRows(
  refreshToken: string,
  spreadsheetId: string,
  range: string,
  rows: string[][],
): Promise<void> {
  const token = await googleAccessTokenFromRefresh(refreshToken);
  const encoded = encodeURIComponent(range);
  const res = await sheetsFetch(
    token,
    `/${spreadsheetId}/values/${encoded}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: rows }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets append failed (${res.status}): ${text.slice(0, 400)}`);
  }
}

export async function batchUpdateSheet(
  refreshToken: string,
  spreadsheetId: string,
  data: Array<{ range: string; values: string[][] }>,
): Promise<void> {
  let lastError = "Sheets batchUpdate failed";
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const token = await googleAccessTokenFromRefresh(refreshToken);
    const res = await sheetsFetch(token, `/${spreadsheetId}/values:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: data.map((item) => ({ range: item.range, majorDimension: "ROWS", values: item.values })),
      }),
    });
    if (res.ok) {
      return;
    }
    const text = await res.text();
    lastError = `Sheets batchUpdate failed (${res.status}): ${text.slice(0, 400)}`;
    if (res.status !== 429 && res.status !== 503) {
      throw new Error(lastError);
    }
    await sleep(Math.min(60_000, 2_000 * attempt * attempt));
  }
  throw new Error(lastError);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SpreadsheetSheetMeta = {
  properties?: { sheetId?: number; title?: string };
  basicFilter?: unknown;
};

async function spreadsheetsBatchUpdate(
  accessToken: string,
  spreadsheetId: string,
  requests: unknown[],
): Promise<void> {
  if (requests.length === 0) {
    return;
  }
  const res = await sheetsFetch(accessToken, `/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets batchUpdate failed (${res.status}): ${text.slice(0, 400)}`);
  }
}

/**
 * Remove sheet-level basic filters (not filter views) so Apps Script append/format and API writes stay safe.
 * Returns sheetIds that had a filter cleared.
 */
export async function clearBasicFiltersOnSheets(
  accessToken: string,
  spreadsheetId: string,
  sheetIds: number[],
): Promise<number[]> {
  const want = new Set(sheetIds);
  if (want.size === 0) {
    return [];
  }
  const metaRes = await sheetsFetch(
    accessToken,
    `/${spreadsheetId}?fields=sheets(properties.sheetId,title,basicFilter)`,
  );
  if (!metaRes.ok) {
    const text = await metaRes.text();
    throw new Error(`Sheets metadata read failed (${metaRes.status}): ${text.slice(0, 400)}`);
  }
  const meta = (await metaRes.json()) as { sheets?: SpreadsheetSheetMeta[] };
  const requests: unknown[] = [];
  const cleared: number[] = [];
  for (const sheet of meta.sheets ?? []) {
    const sheetId = sheet.properties?.sheetId;
    if (sheetId === undefined || !want.has(sheetId) || !sheet.basicFilter) {
      continue;
    }
    requests.push({ clearBasicFilter: { sheetId } });
    cleared.push(sheetId);
  }
  await spreadsheetsBatchUpdate(accessToken, spreadsheetId, requests);
  return cleared;
}

export function headerRowToObjects(header: string[], rows: string[][]): SheetRow[] {
  const out: SheetRow[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const cells = rows[i];
    const obj: SheetRow = { row_number: i + 2 };
    for (let c = 0; c < header.length; c += 1) {
      const key = header[c]?.trim();
      if (!key) {
        continue;
      }
      obj[key] = cells[c] ?? "";
    }
    out.push(obj);
  }
  return out;
}
