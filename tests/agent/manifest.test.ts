import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allWorkflows, capabilityCatalogue } from "@/lib/agent/resolver";
import type { Workflow } from "@/lib/agent/types";

/**
 * The manifest checked against the app it is supposed to drive.
 *
 * A registry entry is a promise that a control exists on screen. This is what
 * keeps that promise honest: promote a workflow to "ready" without annotating
 * its controls and the suite fails here, long before an owner asks the
 * assistant to do it and watches it reach for a button that was never added.
 */

const SRC = join(process.cwd(), "src");

/** Every data-agent-id present anywhere in the source. Read off disk, because
 * the question is what the BUILD actually contains, not what a module exports.
 * Computed once: the tree does not change mid-run. */
const annotatedIds = (() => {
  const ids = new Set<string>();
  const pattern = /data-agent-id="([a-zA-Z0-9_-]+)"/g;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      // Prisma's generated client is enormous and contains no UI.
      if (entry.isDirectory()) {
        if (entry.name !== "generated") walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        for (const match of readFileSync(full, "utf8").matchAll(pattern)) ids.add(match[1]!);
      }
    }
  };

  walk(SRC);
  return ids;
})();

/** Everything a workflow will reach for while running. */
function controlsUsed(workflow: Workflow): string[] {
  const ids = new Set<string>();
  for (const field of workflow.fields) ids.add(field.control);
  for (const step of workflow.steps) if ("control" in step) ids.add(step.control);
  if (workflow.openWith) ids.add(workflow.openWith);
  ids.add(workflow.verify.control);
  if (workflow.cancel) ids.add(workflow.cancel.control);
  return [...ids];
}

const ready = allWorkflows().filter((w) => w.status === "ready");

describe("the registry matches the app", () => {
  it("has at least one workflow actually wired up", () => {
    expect(ready.length).toBeGreaterThan(0);
  });

  it.each(ready.map((w) => [w.id, w] as const))(
    "%s: every control it uses is annotated in the app",
    (_id, workflow) => {
      const missing = controlsUsed(workflow).filter((c) => !annotatedIds.has(c));
      expect(missing, `not annotated: ${missing.join(", ")}`).toEqual([]);
    },
  );

  it("routes a workflow starts from are real pages", () => {
    for (const workflow of ready) {
      const route = workflow.route.replace(/^\//, "");
      const page = join(SRC, "app", "(app)", route, "page.tsx");
      expect(() => readFileSync(page), `${workflow.id} -> ${workflow.route}`).not.toThrow();
    }
  });

  it("offers the model only what is wired up", () => {
    const offered = capabilityCatalogue().map((c) => c.id).sort();
    expect(offered).toEqual(ready.map((w) => w.id).sort());
  });

  it("keeps drafts out of reach rather than half-working", () => {
    const drafts = allWorkflows().filter((w) => w.status === "draft");
    const offered = new Set(capabilityCatalogue().map((c) => c.id));
    for (const draft of drafts) expect(offered.has(draft.id)).toBe(false);
  });

  it("every workflow can say how it will be checked", () => {
    for (const workflow of allWorkflows()) {
      expect(workflow.verify.control, workflow.id).toBeTruthy();
    }
  });
});

describe("the tappable shortcuts", () => {
  it("offers exactly what the registry allows a tap to run", async () => {
    // Drift either way is a bug the owner sees: a shortcut the server refuses
    // is a button that fails, and a capability missing from the list is one
    // they cannot reach when the model is down.
    const { tappableWorkflows } = await import("@/lib/agent/resolver");
    const { SHORTCUTS } = await import("@/lib/agent/shortcuts");
    expect([...SHORTCUTS.map((s) => s.id)].sort()).toEqual([...tappableWorkflows().map((w) => w.id)].sort());
  });

  it("allows only reads that need no values to be tapped", async () => {
    // A tap is not an instruction to change anything, and a shortcut that
    // needed a value would have nowhere to get it from.
    const { tappableWorkflows } = await import("@/lib/agent/resolver");
    const byId = new Map(allWorkflows().map((w) => [w.id, w]));
    for (const { id } of tappableWorkflows()) {
      const workflow = byId.get(id)!;
      expect(workflow.effect, `${id} must be a read`).toBe("READ");
      expect(workflow.fields, `${id} must need no values`).toEqual([]);
    }
  });

  it("has a label in every language for every shortcut", async () => {
    // An owner with the panel in Marathi must not meet an English button.
    const { SHORTCUTS } = await import("@/lib/agent/shortcuts");
    for (const shortcut of SHORTCUTS) {
      for (const lang of ["en", "hi", "mr"] as const) {
        expect(shortcut.label[lang]?.trim(), `${shortcut.id} (${lang})`).toBeTruthy();
      }
    }
  });
});

describe("nothing a plan can stop at comes after its submit", () => {
  it.each(ready.map((w) => [w.id, w] as const))(
    "%s: every select and pickFromList precedes the submit",
    (_id, workflow) => {
      // This is what makes EXECUTING -> COLLECTING_DETAILS safe (see
      // task-state.ts). A `select` or `pickFromList` is the only thing that
      // can stop a plan to ask which record was meant, and the owner's answer
      // rewinds the task to collect it. If one sat AFTER the submit, that
      // rewind could happen on a task that had already written something, and
      // re-running it would be how a duplicate starts.
      const submitAt = workflow.steps.findIndex((s) => s.action === "submit");
      if (submitAt < 0) return;
      const afterSubmit = workflow.steps
        .slice(submitAt + 1)
        .filter((s) => s.action === "select" || s.action === "pickFromList");
      expect(afterSubmit, `${workflow.id} picks a record after submitting`).toEqual([]);
    },
  );

  it("has at most one submit per workflow", () => {
    // Two submits would mean two writes from one approval.
    for (const workflow of ready) {
      const submits = workflow.steps.filter((s) => s.action === "submit");
      expect(submits.length, `${workflow.id} submits ${submits.length} times`).toBeLessThanOrEqual(1);
    }
  });
});
