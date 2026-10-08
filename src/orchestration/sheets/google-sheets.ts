import { googleAccessTokenFromRefresh } from "./google-auth.js";

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
  const token = await googleAccessTokenFromRefresh(refreshToken);
  const res = await sheetsFetch(token, `/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: data.map((item) => ({ range: item.range, majorDimension: "ROWS", values: item.values })),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets batchUpdate failed (${res.status}): ${text.slice(0, 400)}`);
  }
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
