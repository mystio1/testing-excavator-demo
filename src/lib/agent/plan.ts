import { resolve } from "./resolver";
import type { UiAction, Workflow } from "./types";

/**
 * Turns a registered workflow plus collected values into the exact list of
 * operations the browser will perform — and refuses to produce one otherwise.
 *
 * This is the last gate before the page is touched, and it is deliberately
 * dull: every operation names a control the registry declared, carries a value
 * the workflow declared, and is one of a closed set of verbs. There is no
 * branch here that a cleverly worded request could widen, because nothing in
 * this file reads the request.
 */

export type UiOperation =
  | { action: "navigate"; route: string }
  | { action: "click"; control: string }
  | { action: "fill"; control: string; value: string }
  | { action: "select"; control: string; value: string }
  | { action: "pickFromList"; control: string; query: string }
  | { action: "waitFor"; control: string }
  | { action: "submit"; control: string };

export type PlanResult =
  | { ok: true; operations: UiOperation[]; verify: string; cancel: string | null }
  | { ok: false; reason: "UNKNOWN_WORKFLOW" | "MISSING_VALUE" | "UNKNOWN_CONTROL"; detail: string };

/** Every control a workflow is allowed to name, gathered from its own
 * definition. A step pointing anywhere else is a broken registry entry, and
 * failing loudly here beats clicking something unintended. */
function declaredControls(workflow: Workflow): Set<string> {
  const controls = new Set<string>(workflow.fields.map((f) => f.control));
  for (const step of workflow.steps) if ("control" in step) controls.add(step.control);
  if (workflow.openWith) controls.add(workflow.openWith);
  controls.add(workflow.verify.control);
  if (workflow.cancel) controls.add(workflow.cancel.control);
  return controls;
}

export function planWorkflow(workflowId: string, fields: Record<string, string | number>): PlanResult {
  const workflow = resolve(workflowId);
  if (!workflow) {
    return { ok: false, reason: "UNKNOWN_WORKFLOW", detail: workflowId };
  }

  const allowed = declaredControls(workflow);
  const operations: UiOperation[] = [];

  for (const step of workflow.steps) {
    if ("control" in step && !allowed.has(step.control)) {
      return { ok: false, reason: "UNKNOWN_CONTROL", detail: step.control };
    }

    switch (step.action) {
      case "navigate":
        operations.push({ action: "navigate", route: step.route });
        break;
      case "click":
        operations.push({ action: "click", control: step.control });
        break;
      case "waitFor":
        operations.push({ action: "waitFor", control: step.control });
        break;
      case "submit":
        operations.push({ action: "submit", control: step.control });
        break;
      case "fill":
      case "select":
      case "pickFromList": {
        const value = fields[step.fromField];
        if (value === undefined || value === null || value === "") {
          // An optional field with nothing in it is skipped, not blanked: the
          // form's own default (today's date, the current meter) is better than
          // an empty box.
          const field = workflow.fields.find((f) => f.name === step.fromField);
          if (field && !field.required) break;
          return { ok: false, reason: "MISSING_VALUE", detail: step.fromField };
        }
        const text = String(value);
        if (step.action === "pickFromList") {
          operations.push({ action: "pickFromList", control: step.control, query: text });
        } else {
          operations.push({ action: step.action, control: step.control, value: text });
        }
        break;
      }
    }
  }

  return {
    ok: true,
    operations,
    verify: workflow.verify.control,
    cancel: workflow.cancel?.control ?? null,
  };
}

const ALLOWED_ACTIONS = new Set<UiAction>([
  "navigate",
  "click",
  "fill",
  "select",
  "pickFromList",
  "waitFor",
  "read",
  "submit",
]);

/**
 * Re-checked in the browser before anything runs, because the plan crosses a
 * network boundary to get there. Cheap, and it means a tampered payload fails
 * on arrival rather than being trusted for having come from "the server".
 */
export function isExecutableOperation(op: unknown): op is UiOperation {
  if (typeof op !== "object" || op === null) return false;
  const candidate = op as { action?: unknown; control?: unknown; route?: unknown };
  if (typeof candidate.action !== "string") return false;
  if (!ALLOWED_ACTIONS.has(candidate.action as UiAction)) return false;
  if (candidate.action === "navigate") return typeof candidate.route === "string";
  return typeof candidate.control === "string";
}
