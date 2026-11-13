import { requireBusinessApi } from "@/lib/api-auth";
import { assertAssistantAvailable } from "@/lib/agent/availability";
import { handleConfirm, handleMessage, handleResolve, handleResult, handleRun, handleUndo, type AskFn } from "@/lib/agent/orchestrator";
import type { Actor } from "@/lib/agent/policy";
import { db } from "@/lib/db";
import { resolveAlias } from "@/lib/agent/aliases";
import { recordTurn } from "@/lib/agent/diagnostics";
import { askGroq, GroqError, modelFor } from "@/lib/agent/groq";
import { dbTaskStore } from "@/lib/agent/task-store";
import { assertWithinBudget, recordUsage } from "@/lib/agent/usage";
import { agentTrail } from "@/lib/agent/trail";
import { enforceAgentQuota, turnRules } from "@/lib/agent/quota";
import type { AgentResponse } from "@/lib/agent/types";
import { agentRequestSchema } from "@/lib/validation/agent";
import { json, parseBody, withApi } from "@/lib/with-api";

/**
 * The assistant's one endpoint, for all three beats of a turn: say something,
 * approve something, report what the browser saw.
 *
 * It is the owner's own session that drives it, so the assistant can never
 * reach anything the owner could not reach by hand. The actor is built here
 * from that verified session and never from the request body — a task id in a
 * payload identifies a conversation, it does not grant one.
 */

export const POST = withApi("agent.message", async (req) => {
  const auth = await requireBusinessApi();
  if (auth.error) return auth.error;

  // Switched off for this business? Nothing here runs, however the request
  // got here.
  await assertAssistantAvailable(auth.session.businessId);

  const input = await parseBody(req, agentRequestSchema);
  // Three rings: this user, this business, and the shared account. A per-user
  // limit alone protected nothing that mattered — a business with five users
  // got five times the allowance, and one busy yard could spend the whole
  // account's per-minute ceiling and break the assistant for every other
  // customer. See quota.ts.
  await enforceAgentQuota(
    turnRules(
      { userId: auth.session.userId, businessId: auth.session.businessId },
      input.action === "message",
    ),
    input.lang,
  );

  const actor: Actor = {
    kind: "owner",
    businessId: auth.session.businessId,
    userId: auth.session.userId,
  };
  // Bound to this verified session, so the trail can only ever be written
  // against the business and the person the cookie proves.
  const record = agentTrail(auth.session.businessId, auth.actor);
  // The durable store, not the in-process default: a pending approval has to
  // survive a deploy, a free-tier spin-down and a second instance, or the
  // owner's "Yes, save it" becomes "That request has expired".
  const store = dbTaskStore();

  if (input.action === "message") {
    // Rate limits answer "how fast"; this answers "how much". A yard can stay
    // inside every per-minute ring and still run a monthly bill nobody
    // budgeted for, because the model is billed by tokens.
    await assertWithinBudget(auth.session.businessId, "ask", input.lang);

    // Metered as it is spent, by the only number that reflects the cost.
    // Recording is best-effort and never blocks the answer (see usage.ts).
    const businessId = auth.session.businessId;
    // The model's own reply is captured here because this is the only place it
    // exists: the orchestrator turns it into an AgentReply for the browser,
    // and "which capability did it choose, with which values" is exactly what
    // support needs and what that conversion discards.
    // Per-business model, checked against the deployment's allowlist so a
    // database row cannot point this business's spending at an unknown model.
    // Read alongside the switch, which this route already needed.
    const configured = await db.business.findFirst({
      where: { id: businessId },
      select: { assistantModel: true },
    });
    const model = modelFor(configured?.assistantModel);

    let modelReply: AgentResponse | null = null;
    let modelError: string | undefined;
    const ask: AskFn = async (args) => {
      try {
        modelReply = await askGroq(args, {
          model,
          onUsage: ({ tokens }) => void recordUsage(businessId, { askCalls: 1, askTokens: tokens }),
        });
        return modelReply;
      } catch (err) {
        modelError = err instanceof GroqError ? err.kind : "unknown";
        throw err;
      }
    };

    const reply = await handleMessage(
        {
          taskId: input.taskId,
          text: input.text,
          lang: input.lang,
          // The wire calls it `speaker` so no request body carries a field
          // named `role`; the model's own vocabulary starts here.
          history: input.history?.map((t) => ({ role: t.speaker, content: t.content })),
        },
        actor,
        { record, store, ask, lookupAlias: resolveAlias },
    );

    // Only while support has a window open on this business, and only for a
    // few days. The audit trail says what was approved; this says what was
    // heard, which is the question support actually gets asked. See
    // diagnostics.ts for why it is off by default.
    void recordTurn({
      businessId,
      userId: auth.session.userId,
      taskId: reply.taskId,
      lang: input.lang,
      utterance: input.text,
      reply: modelReply,
      errorKind: modelError,
    });

    return json(reply);
  }

  if (input.action === "confirm") {
    return json(await handleConfirm(input.taskId, actor, { record, store }, input.lang));
  }

  // The owner picked the record a mishearing meant: remember it, and carry on
  // with the right record rather than making them start over.
  if (input.action === "resolve") {
    return json(
      await handleResolve(
        { taskId: input.taskId, field: input.field, heard: input.heard, chosen: input.chosen, lang: input.lang },
        actor,
        { record, store },
      ),
    );
  }

  // "That was wrong." Finds the owner's OWN last write — the request carries
  // no id, so it cannot be aimed at another record or another person.
  if (input.action === "undo") {
    return json(await handleUndo({ lang: input.lang }, actor, { store }));
  }

  // A tapped shortcut: no model, and only the registry's no-field reads. This
  // is the path that still works when the model cannot be reached at all.
  if (input.action === "run") {
    return json(await handleRun({ workflowId: input.workflowId, lang: input.lang }, actor, { record, store }));
  }

  return json(
    await handleResult(
      input.taskId,
      actor,
      {
        verified: input.verified,
        error: input.error,
        screenText: input.screenText,
      },
      { record, store },
      input.lang,
    ),
  );
});
