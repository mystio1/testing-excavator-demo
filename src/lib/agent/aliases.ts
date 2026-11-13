import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { normalizeText } from "./text";

/**
 * Learning what a mishearing meant.
 *
 * The vocabulary prompt already primes Whisper with the owner's real names,
 * which took "Bundapot" back to "Banda Patil" in testing. It does not always
 * work, and when it fails the owner is asked to say a name the app has just
 * demonstrated it cannot hear. Asking twice is not a fix.
 *
 * So the correction is kept. When they pick the record they meant, that
 * pairing resolves the same mishearing instantly next time, and the right
 * spelling joins the speech prompt so Whisper is less likely to repeat it.
 *
 * Two things this deliberately is NOT:
 *
 *  - a guess. An alias is only ever written when the owner themselves chose
 *    the record from a list the app built out of their own data. Nothing is
 *    inferred from a near-match.
 *  - a shortcut past matching. An alias rewrites the heard words to the
 *    record's own label; the label is then matched against the real list as
 *    usual, so a record that has since been renamed or archived still fails
 *    honestly rather than resolving to something that is gone.
 */

export type EntityKind = "machine" | "operator" | "customer" | "site";

const KINDS: readonly EntityKind[] = ["machine", "operator", "customer", "site"];

export const isEntityKind = (value: string): value is EntityKind =>
  (KINDS as readonly string[]).includes(value);

/**
 * A mishearing worth remembering is a few characters at least: "a" or "2" are
 * not corrections, they are noise, and an alias on them would hijack every
 * short answer.
 */
const MIN_HEARD = 3;

/** Remember that `heard` meant `label`, for this business and this kind. */
export async function rememberAlias(input: {
  businessId: string;
  kind: EntityKind;
  heard: string;
  label: string;
}): Promise<void> {
  const heard = normalizeText(input.heard);
  const label = input.label.trim();
  if (heard.length < MIN_HEARD || !label) return;
  // Nothing to learn when the app already heard it right.
  if (heard === normalizeText(label)) return;

  try {
    await db.agentNameAlias.upsert({
      where: { businessId_kind_heard: { businessId: input.businessId, kind: input.kind, heard } },
      create: { businessId: input.businessId, kind: input.kind, heard, label },
      // A second correction of the same mishearing to a DIFFERENT record wins:
      // the owner is the authority on what they said, and the most recent
      // answer is the best one available.
      update: { label, hits: { increment: 1 }, lastUsedAt: new Date() },
    });
  } catch (err) {
    // Failing to learn must never fail the turn the owner is waiting on.
    logger.warn("agent.alias_not_saved", { businessId: input.businessId, error: String(err) });
  }
}

/**
 * The label this business has previously said a mishearing meant, if any.
 * Returns null rather than guessing.
 */
export async function resolveAlias(
  businessId: string,
  kind: EntityKind,
  heard: string,
): Promise<string | null> {
  const key = normalizeText(heard);
  if (key.length < MIN_HEARD) return null;
  try {
    const row = await db.agentNameAlias.findUnique({
      where: { businessId_kind_heard: { businessId, kind, heard: key } },
      select: { id: true, label: true },
    });
    if (!row) return null;
    // Counted so a pairing nobody uses any more can be told from a live one.
    void db.agentNameAlias
      .update({ where: { id: row.id }, data: { hits: { increment: 1 }, lastUsedAt: new Date() } })
      .catch(() => undefined);
    return row.label;
  } catch (err) {
    logger.warn("agent.alias_lookup_failed", { businessId, error: String(err) });
    return null;
  }
}

/** Every correction this business has made, for the speech prompt. Bounded —
 * the prompt has a budget and real names come first. */
export async function knownAliases(businessId: string, take = 20): Promise<{ heard: string; label: string }[]> {
  try {
    return await db.agentNameAlias.findMany({
      where: { businessId },
      orderBy: [{ hits: "desc" }, { lastUsedAt: "desc" }],
      take,
      select: { heard: true, label: true },
    });
  } catch {
    return [];
  }
}
