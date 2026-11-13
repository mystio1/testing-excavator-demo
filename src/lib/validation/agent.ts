import { z } from "zod";
import { AGENT_LANGS } from "@/lib/agent/types";

/**
 * Everything the assistant endpoint accepts. The browser is not trusted to
 * send a sensible shape, and neither is anything that reaches it: a long
 * message, a forged task id or an invented action all get a 422 here rather
 * than a surprise further in.
 */

/** Long enough for a spoken sentence, short enough that nobody pastes a book
 * into a prompt we pay for. */
const message = z.string().trim().min(1, "Say something first").max(500, "That is too long");

const taskId = z.string().uuid().optional();
const lang = z.enum(AGENT_LANGS).default("en");

/**
 * Past turns the client replays for context. Bounded on purpose — an unbounded
 * history is somebody else's token bill and a slower answer.
 *
 * Each turn names its "speaker" rather than using the word the chat APIs use,
 * because that word means a user's privilege level in this app and is
 * server-owned — a request body may never carry a field by that name (see the
 * guard in tests/unit/route-inventory.test.ts). The rename to the model's own
 * vocabulary happens server-side, in the route.
 */
const history = z
  .array(z.object({ speaker: z.enum(["user", "assistant"]), content: z.string().max(500) }).strict())
  .max(12)
  .optional();

export const agentRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), taskId, lang, text: message, history }).strict(),
  // The owner picked the record a mishearing meant. `chosen` has to be one of
  // the labels the browser offered, which the server checks against the task's
  // own workflow — a payload cannot name a record they were never shown.
  z
    .object({
      action: z.literal("resolve"),
      taskId: z.string().uuid(),
      lang,
      field: z.string().min(1).max(60),
      heard: z.string().min(1).max(200),
      chosen: z.string().min(1).max(200),
    })
    .strict(),
  // "That was wrong" — take me to the last thing you saved. Carries no id:
  // the server finds the owner's own most recent write, so a payload cannot
  // point this at somebody else's record.
  z.object({ action: z.literal("undo"), lang }).strict(),
  // A tapped shortcut. The id is checked against the registry's own allowlist
  // of no-field reads server-side; this only bounds its shape.
  z
    .object({
      action: z.literal("run"),
      lang,
      workflowId: z.string().min(1).max(60).regex(/^[a-z][a-z0-9._]*$/, "Unknown capability"),
    })
    .strict(),
  z.object({ action: z.literal("confirm"), taskId: z.string().uuid(), lang }).strict(),
  z
    .object({
      action: z.literal("result"),
      taskId: z.string().uuid(),
      lang,
      /** Came from the app's own screen in the browser, never from the model. */
      verified: z.boolean(),
      error: z.string().max(300).optional(),
      /** What the screen showed, so a question can be answered from it.
       * Bounded: it goes into a prompt, and a whole page is neither useful
       * there nor cheap. */
      screenText: z.string().max(4000).optional(),
    })
    .strict(),
]);

export type AgentRequest = z.infer<typeof agentRequestSchema>;

/** Recording that the voice notice was shown and agreed to — or withdrawn,
 * which must be as easy to express as agreeing. */
export const voiceConsentSchema = z
  .object({ granted: z.boolean(), lang })
  .strict();
