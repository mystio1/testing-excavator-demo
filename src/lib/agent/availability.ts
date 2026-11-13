import { ApiHttpError } from "@/lib/api-error";
import { db } from "@/lib/db";

/**
 * Is the assistant switched on for this business?
 *
 * Checked on the server, in every assistant route, which is what makes it a
 * switch rather than a hidden button. The panel also hides itself when it is
 * off, but that is only politeness: a client is something a person can keep a
 * stale copy of, and an installed APK keeps one for months (see
 * docs/architecture.md on additive API changes).
 *
 * It exists because of a shape of problem that has no other answer: when the
 * assistant does the wrong thing for ONE business, the alternative to a switch
 * is a deploy that takes it away from everybody while that one case is worked
 * out. Default on, so nothing changes for anyone until someone turns it off.
 */
export async function assertAssistantAvailable(businessId: string): Promise<void> {
  const business = await db.business.findFirst({
    where: { id: businessId },
    select: { assistantEnabled: true },
  });
  if (!business?.assistantEnabled) {
    // Said as a state of the account, not as a fault of the person asking, and
    // it says the rest of the app is unaffected — which is the whole point of
    // being able to switch off just this.
    throw new ApiHttpError(
      "FORBIDDEN",
      "The assistant is switched off for this account. Everything else works as usual.",
    );
  }
}
