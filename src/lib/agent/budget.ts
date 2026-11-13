/**
 * How long the owner can be made to wait, written down in one place.
 *
 * Every timeout in the assistant used to be a number next to the code that
 * used it, which is fine until you add them up. A read is four waits in a row
 * — ask the model, navigate, verify the screen, then summarise what is on it —
 * and nothing anywhere said what the total could reach. It was 40 seconds.
 *
 * Somebody holding a phone in a yard does not wait 40 seconds; they tap again,
 * which is how one instruction becomes two. So the budget is explicit, the
 * pieces have to fit inside it, and `tests/agent/budget.test.ts` adds them up
 * and fails if they stop fitting.
 *
 * These are ceilings, not targets. Measured typical values on a healthy
 * connection: the model answers in under a second, navigation is instant, the
 * screen settles in a few hundred milliseconds.
 */

/**
 * The whole turn, end to end, including a read's second model call.
 *
 * Chosen from what a person tolerates, not from what the parts need. The
 * figure that really decides whether it feels broken is worstCaseSilentMs —
 * the part with nothing to look at — which is held to ten seconds. The rest of
 * a turn is a form visibly being filled in, which an owner will watch.
 *
 * It was forty seconds before anybody added it up.
 */
export const TURN_BUDGET_MS = 18_000;

/** Understanding what was said. The expensive call, and the one that fails. */
export const MODEL_MS = 6_000;

/**
 * Summarising what ended up on screen, for a read.
 *
 * Deliberately shorter than MODEL_MS: by this point the page is already open
 * and correct, so the fallback ("I've opened it for you — please have a look")
 * is a genuinely useful answer. Spending as long again on a nicer sentence is
 * not worth the owner's silence.
 */
export const SUMMARY_MS = 4_000;

/** Waiting for an intermediate control — a dialog mounting, a field
 * appearing. Shorter than VERIFY_MS because the page is visibly moving while
 * this happens, and because being early here only costs a retry of the step. */
export const CONTROL_MS = 4_000;

/** Waiting for a control's text to stop changing before quoting it. */
export const SETTLE_MS = 400;

/**
 * Speech to text. Outside the turn budget on purpose: the owner is not waiting
 * in silence, they have just finished speaking and know they did.
 */
export const TRANSCRIBE_MS = 20_000;

/** A spoken instruction is seconds long; this is a ceiling on a stuck
 * recording, not a target. */
export const MAX_RECORDING_MS = 30_000;

/**
 * Waiting to find out whether a save actually landed.
 *
 * The most generous wait in here, deliberately — and it was cut to 6s once
 * while balancing the budget, which immediately produced a browser run where a
 * job that had saved was reported as "I couldn't confirm". That is the exact
 * harm this number exists to prevent, so it gets the margin and the write
 * budget absorbs it.
 *
 * Every other timeout costs a
 * retry when it fires early; this one costs a WRONG ANSWER — "I couldn't
 * confirm" about a record that saved perfectly well, which sends the owner to
 * do it again by hand and risk a second one.
 */
export const VERIFY_MS = 8_000;

/**
 * The silent part of a turn: understanding, and summarising.
 *
 * This is the number that actually matters for how broken it feels. While a
 * form is being driven the screen is visibly moving and an owner will wait;
 * while nothing is happening they will not.
 */
export const worstCaseSilentMs = MODEL_MS + SUMMARY_MS;

/**
 * The longest a read can take: understand, then wait for the page, then read
 * it back. Navigation and the dialog are inside CONTROL_MS.
 */
export const worstCaseReadMs = MODEL_MS + CONTROL_MS + SETTLE_MS + SUMMARY_MS;

/** The longest a write can take: understand, drive the form, confirm it. */
export const worstCaseWriteMs = MODEL_MS + CONTROL_MS + VERIFY_MS;
