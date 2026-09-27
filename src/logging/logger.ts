type LogFields = Record<string, unknown>;

/** One JSON line per event so a later failure can be traced without reading a screenshot. */
export function log(event: string, fields: LogFields = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}
