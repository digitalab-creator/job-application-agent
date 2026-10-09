import { AsyncLocalStorage } from "node:async_hooks";
import type { SearchPolicy } from "./search-policy.js";
import { defaultSearchPolicy } from "./search-policy.js";

const policyStore = new AsyncLocalStorage<SearchPolicy>();

export function getSearchPolicy(): SearchPolicy {
  return policyStore.getStore() ?? defaultSearchPolicy();
}

export async function withSearchPolicy<T>(policy: SearchPolicy, fn: () => Promise<T>): Promise<T> {
  return policyStore.run(policy, fn);
}
