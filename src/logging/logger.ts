import { AsyncLocalStorage } from "node:async_hooks";

type LogFields = Record<string, unknown>;

const logContext = new AsyncLocalStorage<{ attemptId?: string }>();

/** One JSON line per event so a later failure can be traced without reading a screenshot. */
export function log(event: string, fields: LogFields = {}): void {
  const context = logContext.getStore();
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...(context?.attemptId ? { attemptId: context.attemptId } : {}),
    ...fields,
  };
  console.log(JSON.stringify(payload));
}

export function withLogContext<T>(context: { attemptId: string }, callback: () => T): T {
  return logContext.run(context, callback);
}
