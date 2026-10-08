type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

let cached: { accessToken: string; expiresAt: number } | null = null;

export async function googleAccessTokenFromRefresh(refreshToken: string): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are required for Sheets.");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as GoogleTokenResponse;
  cached = {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(60, json.expires_in) * 1000,
  };
  return json.access_token;
}
