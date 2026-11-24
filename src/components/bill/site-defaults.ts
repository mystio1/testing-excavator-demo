/** Site defaults for the bill forms: which site a customer works at and what
 * that site charges, so the owner does not retype what Site Analysis already has. */

export type SiteOption = {
  id: string;
  name: string;
  customerId?: string | null;
  status?: string;
  bucketRate?: number | null;
  breakerRate?: number | null;
};

/** The customer's own sites, ongoing ones first. */
export function sitesForCustomer<T extends SiteOption>(sites: T[], customerId: string): T[] {
  const rank = (s: T) => (s.status === "ACTIVE" || !s.status ? 0 : s.status === "ON_HOLD" ? 1 : 2);
  return sites
    .filter((s) => s.customerId === customerId)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The site's saved rate for a tool ("Bucket" / "Breaker"; anything else counts as Bucket). */
export function siteRateFor(site: SiteOption | undefined, attachment: string | null | undefined): number | null {
  if (!site) return null;
  const rate = /breaker|brekar/i.test(attachment ?? "") ? site.breakerRate : site.bucketRate;
  return rate != null && Number(rate) > 0 ? Number(rate) : null;
}

/** Bucket / Breaker by how many hours each has; null when neither appears. */
export function mainAttachment(items: { attachment: string | null; totalHours: number }[]): "Bucket" | "Breaker" | null {
  let bucket = 0;
  let breaker = 0;
  for (const i of items) {
    if (/breaker|brekar/i.test(i.attachment ?? "")) breaker += i.totalHours;
    else if (/bucket/i.test(i.attachment ?? "")) bucket += i.totalHours;
  }
  if (bucket === 0 && breaker === 0) return null;
  return breaker > bucket ? "Breaker" : "Bucket";
}
