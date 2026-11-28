import { matchEntity, type Candidate } from "./matching";

/**
 * Working out WHICH machine the owner means, before anything is put to them
 * for approval.
 *
 * Until this existed, the spoken name travelled untouched to the approval card
 * ("machine: JCB") and was only matched against the machine cards in the
 * browser, after the owner had already said yes. So the owner approved a
 * sentence, never a machine — and with two JCBs, or a machine they call by its
 * operator ("Patil wali machine") or its site ("Wakad wali"), there was no way
 * to say which one was about to be written to.
 *
 * Now the machine is identified first, from three things the owner might say:
 * its name or number, the operator assigned to it, or the site it is at. A
 * confident match is read back with its operator and site so the owner can
 * catch a wrong one; two matches is a question; none is a question that asks
 * for the operator or the site instead.
 *
 * Pure on purpose — the records are handed in — so every one of those rules is
 * tested without a database.
 */

export type MachineRecord = {
  id: string;
  name: string;
  machineNumber: string | null;
  /** Assigned operator's name, if any. */
  operator: string | null;
  /** Site of its running job, else its current site. */
  site: string | null;
  status: string;
  /** Whether a job is running — a reading or a stop needs one. */
  hasActiveJob: boolean;
};

export type MachineHints = {
  /** The name or number as spoken. */
  machine?: string | null;
  /** "Patil wali machine": who runs it. */
  operator?: string | null;
  /** "Wakad wali JCB": where it is. */
  site?: string | null;
};

export type Identified =
  | { kind: "found"; machine: MachineRecord; via: "machine" | "operator" | "site" | "only" }
  | { kind: "choose"; options: MachineRecord[] }
  /** `heard` is set when a name WAS said and matched nothing. */
  | { kind: "unknown"; heard?: string };

/**
 * Exactly the label the machine card carries (`data-agent-label` in
 * machine-card.tsx). The identified machine is written back into the field in
 * this form, so the browser's own match later lands on the same card with no
 * second chance to pick a different one.
 */
export function machineLabel(m: Pick<MachineRecord, "name" | "machineNumber">): string {
  return [m.name, m.machineNumber].filter(Boolean).join(" ");
}

const clean = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");

/** Which records a spoken value could mean, by one attribute. */
function byAttribute(records: MachineRecord[], spoken: string, pick: (m: MachineRecord) => string | null) {
  const candidates: Candidate[] = records
    .filter((m) => pick(m))
    .map((m) => ({ value: m.id, label: pick(m)! }));
  const result = matchEntity(spoken, candidates);
  if (result.kind === "none") return [];
  const ids = new Set(result.kind === "unique" ? [result.match.value] : result.matches.map((c) => c.value));
  return records.filter((m) => ids.has(m.id));
}

/** Narrow a set by another attribute when it was said; keep the set when the
 * extra detail matches none of them (better to ask than to throw away). */
function narrow(set: MachineRecord[], spoken: string, pick: (m: MachineRecord) => string | null) {
  if (!spoken || set.length < 2) return set;
  const narrowed = byAttribute(set, spoken, pick);
  return narrowed.length > 0 ? narrowed : set;
}

export function identifyMachine(records: MachineRecord[], hints: MachineHints): Identified {
  const machine = clean(hints.machine);
  const operator = clean(hints.operator);
  const site = clean(hints.site);

  const settle = (set: MachineRecord[], via: "machine" | "operator" | "site"): Identified | null => {
    let s = set;
    s = narrow(s, operator, (m) => m.operator);
    s = narrow(s, site, (m) => m.site);
    if (s.length === 1) return { kind: "found", machine: s[0]!, via };
    if (s.length > 1) return { kind: "choose", options: s };
    return null;
  };

  if (machine) {
    const hit = settle(byAttribute(records, machine, machineLabel), "machine");
    if (hit) return hit;
    // Asked "which machine?", people answer with whatever they know it by:
    // "Patil wala", "Wakad wali". A name that is no machine is tried as the
    // operator and then the site before giving up on it.
    const asOperator = !operator ? settle(byAttribute(records, machine, (m) => m.operator), "operator") : null;
    if (asOperator) return asOperator;
    const asSite = !site ? settle(byAttribute(records, machine, (m) => m.site), "site") : null;
    if (asSite) return asSite;
  }
  if (operator) {
    const hit = settle(byAttribute(records, operator, (m) => m.operator), "operator");
    if (hit) return hit;
  }
  if (site) {
    const hit = settle(byAttribute(records, site, (m) => m.site), "site");
    if (hit) return hit;
  }
  // Nothing said and only one machine in the yard: there is nothing to ask.
  // It is still read back, so a wrong assumption is caught at approval.
  if (!machine && !operator && !site && records.length === 1) {
    return { kind: "found", machine: records[0]!, via: "only" };
  }
  return machine ? { kind: "unknown", heard: machine } : { kind: "unknown" };
}

/** "JCB-01 (operator Patil, at Wakad)" — what the owner hears for approval. */
export function describeMachine(m: MachineRecord, words: { operator: string; at: string }): string {
  const extras = [m.operator ? `${words.operator} ${m.operator}` : null, m.site ? `${words.at} ${m.site}` : null].filter(
    Boolean,
  );
  return extras.length ? `${machineLabel(m)} (${extras.join(", ")})` : machineLabel(m);
}

/** Workflows that can only run against a machine with a job in progress. */
export const NEEDS_ACTIVE_JOB = new Set(["reading.add", "work.stop"]);
