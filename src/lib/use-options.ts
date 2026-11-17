"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { swrFetcher } from "@/lib/api-client";

/**
 * The dropdown lists every work form needs — customers, sites, operators.
 *
 * Why these have their own hook rather than a bare `useSWR` per dialog:
 *
 * 1. **"No customers" was being shown for a list that was still loading.**
 *    A call site that only reads `data` cannot tell "none exist" from "not
 *    here yet" or "the request failed", so every one of them rendered the
 *    empty-state copy and disabled Save. On a slow yard connection that is
 *    what the owner saw — "Add a customer below to get started", with the
 *    customers right there in the Customers page — and the only way out was to
 *    reload the app until a fetch happened to win. This returns `isLoading`
 *    and `error` separately so a form can say "Loading…" or offer Retry and
 *    never claim the list is empty unless the server actually said so.
 *
 * 2. **It stops re-fetching the same list over and over.** These lists change
 *    rarely (a customer is added now and then) but are opened constantly, and
 *    each dialog was fetching its own copy on every open. One shared key plus
 *    a long dedupe window means the second and later openings are instant off
 *    the cache, which is the "must be very fast" part: the request that used
 *    to be on the critical path of opening the form has usually already
 *    happened.
 *
 * 3. **It retries by itself.** A failed options fetch used to stay failed
 *    until the whole app was reloaded. SWR's own retry plus revalidation when
 *    the window regains focus or the device comes back online recovers without
 *    the owner touching anything.
 */

/** Options are lists of records, not live figures: a slightly stale copy is
 * always better than a spinner, and a wrong one is corrected within the
 * minute. Kept here so every options call site behaves identically. */
const OPTIONS_SWR: SWRConfiguration = {
  // Re-use a copy fetched in the last minute instead of hitting the network
  // again when a dialog opens.
  dedupingInterval: 60_000,
  // Show the previous list while a refresh is in flight rather than blanking.
  keepPreviousData: true,
  revalidateOnFocus: true,
  revalidateIfStale: true,
  revalidateOnReconnect: true,
  // A handful of quick retries covers a dropped request on a yard connection;
  // beyond that the form shows its Retry button rather than hammering.
  errorRetryCount: 5,
  errorRetryInterval: 2_000,
};

export type OptionsResult<T> = {
  items: T[];
  /** First load, with nothing to show yet. Never render an "empty" message
   * while this is true. */
  isLoading: boolean;
  /** The fetch failed and there is still nothing to show. */
  error: Error | undefined;
  /** Fetch again now (the Retry button). */
  retry: () => void;
  /** The server answered and genuinely has none of these. Distinct from
   * "nothing yet", which is `isLoading`. */
  isEmpty: boolean;
};

function useOptions<Response, Item>(
  key: string | null,
  pick: (response: Response) => Item[],
): OptionsResult<Item> {
  const { data, error, mutate } = useSWR<Response>(key, swrFetcher, OPTIONS_SWR);
  const items = data ? pick(data) : [];
  return {
    items,
    isLoading: key !== null && data === undefined && !error,
    // While a previous list is still on screen a failed refresh is not worth
    // reporting — the form has something usable to show.
    error: data === undefined ? (error as Error | undefined) : undefined,
    retry: () => void mutate(),
    isEmpty: data !== undefined && items.length === 0,
  };
}

export type CustomerOption = { id: string; name: string; companyName: string | null };
export type SiteOption = { id: string; name: string; customerId: string | null };
export type OperatorOption = { id: string; name: string };

/** Every customer of the business, for a picker. Pass `enabled: false` to hold
 * the request back (a dialog that is not open yet). */
export function useCustomerOptions(enabled = true) {
  return useOptions<{ customers: CustomerOption[] }, CustomerOption>(
    enabled ? "/api/customers/options" : null,
    (r) => r.customers,
  );
}

/** Every site, each carrying the customer it belongs to. */
export function useSiteOptions(enabled = true) {
  return useOptions<{ sites: SiteOption[] }, SiteOption>(enabled ? "/api/sites/options" : null, (r) => r.sites);
}

/** Every operator of the business, for a picker. */
export function useOperatorOptions(enabled = true) {
  return useOptions<{ operators: OperatorOption[] }, OperatorOption>(
    enabled ? "/api/operators/options" : null,
    (r) => r.operators,
  );
}
