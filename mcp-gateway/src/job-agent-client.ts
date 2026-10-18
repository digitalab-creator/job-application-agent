import { gatewayConfig } from "./config.js";

export class JobAgentClient {
  constructor(
    private readonly baseUrl = gatewayConfig.jobAgentBaseUrl,
    private readonly token = gatewayConfig.jobAgentApiToken,
  ) {}

  async getJson(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      throw new Error(`job_agent_http_${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    }
    return json;
  }

  async postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      throw new Error(`job_agent_http_${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    }
    return json;
  }
}
