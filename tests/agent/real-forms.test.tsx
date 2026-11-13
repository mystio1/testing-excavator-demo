// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { executePlan } from "@/lib/agent/ui-controller";
import { planWorkflow } from "@/lib/agent/plan";

/**
 * The controller against the app's REAL dialogs.
 *
 * `ui-controller.test.ts` proves the controller's decisions against markup
 * written here. That is not the same claim as "it fills this app's forms":
 * these inputs are Base UI components wrapped in controlled React state, and
 * setting a DOM value on a controlled input only works if React is actually
 * told. If it is not, React resets the field to its stale state on the next
 * render and the form submits EMPTY — the one failure mode the controller's
 * setValue() exists to prevent, and the one no hand-written markup can test.
 *
 * So these render the components the owner really sees, run the real planned
 * operations against them, and assert on the body the API would have received.
 * That last part matters: what is on screen is not the claim, what gets saved
 * is.
 */

const sent = vi.hoisted(() => ({ body: null as Record<string, unknown> | null, url: "" }));

vi.mock("@/lib/api-client", () => ({
  apiFetch: async (url: string, init?: { body?: string }) => {
    sent.url = url;
    sent.body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    // Shaped like a real create response: a form that reads the new record's
    // id back would otherwise throw and never reach its redirect.
    return { customer: { id: "cus_new" }, id: "cus_new" };
  },
  ApiError: class ApiError extends Error {},
  swrFetcher: async () => ({}),
  // Money dialogs send an Idempotency-Key so a double submit cannot double-pay.
  newIdempotencyKey: () => "test-idempotency-key",
}));

/** The customer form navigates to the new customer on success. There is no
 * Next router in a unit test, so this records where it would have gone. */
const routed = vi.hoisted(() => ({ to: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      routed.to = href;
    },
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: async () => undefined }),
  default: () => ({ data: undefined, isLoading: false }),
}));

const { StartWorkDialog } = await import("@/app/(app)/excavators/detail/start-work-dialog");
const { AddLeaveDialog } = await import("@/app/(app)/operators/detail/add-leave-dialog");

const customers = [
  { id: "cus_1", name: "Shree Constructions", companyName: null },
  { id: "cus_2", name: "Patil Developers", companyName: null },
];

/** A site that already exists and already belongs to a customer, and one brand
 * new name. The difference between them turned out to matter. */
const sites = [{ id: "s1", name: "Wagholi", customerId: "cus_2" }];

/**
 * Let the form's own async submit finish.
 *
 * executePlan() returning "done" means every operation landed, NOT that the
 * save completed — the click starts an async handler it does not await. That
 * gap is exactly why a task is only ever marked SUCCEEDED by a separate verify
 * step against the screen, and never by the plan finishing.
 */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  sent.body = null;
  sent.url = "";
  routed.to = "";
});
afterEach(cleanup);

/**
 * The operations the real registry produces, so a test cannot pass against a
 * step order the app does not actually use — which is the whole point: the bug
 * these found was in the ORDER, not in any one step.
 *
 * `outside` names the controls that live on the surrounding page rather than in
 * the dialog under test (a tab, a machine card). Only those are dropped; every
 * operation that touches the dialog runs exactly as planned.
 */
const planFor = (
  id: string,
  fields: Record<string, string | number>,
  outside: string[] = [],
) => {
  const plan = planWorkflow(id, fields);
  if (!plan.ok) throw new Error(`could not plan ${id}: ${plan.reason} ${plan.detail}`);
  const skip = new Set(outside);
  return plan.operations.filter(
    (o) => o.action !== "navigate" && o.action !== "pickFromList" && !("control" in o && skip.has(o.control)),
  );
};

describe("starting a job through the real dialog", () => {
  it("sends the customer, site, date and meter the owner approved", async () => {
    render(
      <StartWorkDialog
        excavatorId="ex_1"
        currentHourMeter={1200}
        currentOperatorName="Banda Patil"
        defaultSiteName={null}
        customers={customers}
        sites={sites}
      />,
    );

    const outcome = await executePlan(
      planFor("work.start", {
        machine: "Komatsu PC200",
        customer: "Shree Constructions",
        site: "Hinjawadi Phase 2",
        startHourMeter: 1200,
        startDate: "2026-10-23",
      }),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome).toEqual({ status: "done" });

    // The claim is not "the boxes look filled" — it is what the app sent.
    expect(sent.url).toBe("/api/excavators/ex_1/start-work");
    expect(sent.body).toMatchObject({
      customerId: "cus_1",
      siteName: "Hinjawadi Phase 2",
      startDate: "2026-10-23",
      startHourMeter: 1200,
    });
  });

  it("keeps the chosen customer when the site is one the app already knows", async () => {
    // "Wagholi" belongs to cus_2. The owner said cus_1, and the owner wins.
    render(
      <StartWorkDialog
        excavatorId="ex_1"
        currentHourMeter={900}
        currentOperatorName="Banda Patil"
        defaultSiteName={null}
        customers={customers}
        sites={sites}
      />,
    );

    await executePlan(
      planFor("work.start", {
        machine: "Komatsu PC200",
        customer: "Shree Constructions",
        site: "Wagholi",
        startHourMeter: 900,
      }),
      () => undefined,
      { waitMs: 400 },
    );

    expect(sent.body).toMatchObject({ customerId: "cus_1", siteName: "Wagholi" });
  });

  it("does not quietly send a blank customer", async () => {
    // The failure this whole file exists for: a customer that never reached
    // React's state arrives as "" and the job is filed against nobody.
    render(
      <StartWorkDialog
        excavatorId="ex_1"
        currentHourMeter={1200}
        currentOperatorName="Banda Patil"
        defaultSiteName={null}
        customers={customers}
        sites={sites}
      />,
    );

    await executePlan(
      planFor("work.start", {
        machine: "Komatsu PC200",
        customer: "Patil Developers",
        site: "A Brand New Site",
        startHourMeter: 1200,
      }),
      () => undefined,
      { waitMs: 400 },
    );

    expect(sent.body?.customerId).toBe("cus_2");
    expect(sent.body?.customerId).not.toBe("");
  });

  it("picks up customers that arrive after the dialog is already open", async () => {
    // The real sequence: the page renders, the dialog is opened, and only then
    // does /api/customers/options land. Copying the prop into useState froze
    // the list at empty forever — "Add a customer below to get started" for an
    // owner who has customers, with Save disabled and no way out but closing
    // the dialog. The agent cannot close and reopen, so it simply failed.
    const { rerender } = render(
      <StartWorkDialog
        excavatorId="ex_1"
        currentHourMeter={1200}
        currentOperatorName="Banda Patil"
        defaultSiteName={null}
        customers={[]}
        sites={[]}
      />,
    );

    // Open it while the list is still loading.
    document.querySelector<HTMLElement>('[data-agent-id="start-work-trigger"]')!.click();
    await settle();
    expect(document.querySelector('[data-agent-id="customerId"]')).toBeNull();

    // The fetch lands.
    rerender(
      <StartWorkDialog
        excavatorId="ex_1"
        currentHourMeter={1200}
        currentOperatorName="Banda Patil"
        defaultSiteName={null}
        customers={customers}
        sites={sites}
      />,
    );
    await settle();
    expect(document.querySelector('[data-agent-id="customerId"]')).not.toBeNull();

    // And the dialog is usable: a job can still be started without reopening.
    // The trigger is skipped because the dialog is already open here — clicking
    // it again would close it.
    await executePlan(
      planFor(
        "work.start",
        {
          machine: "Komatsu PC200",
          customer: "Shree Constructions",
          site: "Late Loading Site",
          startHourMeter: 1200,
        },
        ["start-work-trigger"],
      ),
      () => undefined,
      { waitMs: 400 },
    );
    expect(sent.body).toMatchObject({ customerId: "cus_1", siteName: "Late Loading Site" });
  });

  it("refuses to start when no operator is on the machine", async () => {
    // The dialog renders an explanation instead of the form. There is nothing
    // to fill, and the controller must say so rather than report a save.
    render(
      <StartWorkDialog
        excavatorId="ex_1"
        currentHourMeter={1200}
        currentOperatorName={null}
        defaultSiteName={null}
        customers={customers}
        sites={sites}
      />,
    );

    const outcome = await executePlan(
      planFor("work.start", {
        machine: "Komatsu PC200",
        customer: "Shree Constructions",
        site: "Hinjawadi",
        startHourMeter: 1200,
      }),
      () => undefined,
      { waitMs: 300 },
    );
    expect(outcome.status).toBe("failed");
    expect(sent.body).toBeNull();
  });
});

describe("recording leave through the real dialog", () => {
  it("sends the days and the type", async () => {
    render(<AddLeaveDialog operatorId="op_1" />);

    const outcome = await executePlan(
      planFor(
        "operator.leave.add",
        {
          operator: "Banda Patil",
          fromDate: "2026-10-22",
          toDate: "2026-10-22",
          leaveType: "PAID",
        },
        ["tab-sessions", "sessions-panel"],
      ),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome).toEqual({ status: "done" });
    expect(sent.url).toBe("/api/operators/op_1/leaves");
    expect(sent.body).toMatchObject({
      startDate: "2026-10-22",
      endDate: "2026-10-22",
      type: "PAID",
    });
  });

  it("leaves the form's own unpaid default alone when nothing was said", async () => {
    // Unpaid is the conservative reading: paid leave costs the owner money.
    render(<AddLeaveDialog operatorId="op_1" />);

    await executePlan(
      planFor(
        "operator.leave.add",
        { operator: "Banda Patil", fromDate: "2026-10-20", toDate: "2026-10-21" },
        ["tab-sessions", "sessions-panel"],
      ),
      () => undefined,
      { waitMs: 400 },
    );
    expect(sent.body).toMatchObject({ type: "UNPAID" });
  });
});

const { StopWorkDialog } = await import("@/app/(app)/excavators/detail/stop-work-dialog");
const { AddDailyLogDialog } = await import("@/app/(app)/excavators/detail/add-daily-log-dialog");
const { AssignOperatorDialog } = await import("@/app/(app)/excavators/detail/assign-operator-dialog");
const { AddTransactionDialog } = await import("@/app/(app)/operators/detail/add-transaction-dialog");
const { AddCustomerForm } = await import("@/app/(app)/customers/new/add-customer-form");

describe("finishing a job through the real dialog", () => {
  it("sends the final meter, and the job's own start date when no day was said", async () => {
    // The dialog defaults to the day the job began, not today. An optional
    // field the owner never mentioned must not overwrite that.
    render(
      <StopWorkDialog
        excavatorId="ex_1"
        workSessionId="ws_1"
        version={3}
        currentHourMeter={1200}
        startDate="2026-10-20"
      />,
    );

    const outcome = await executePlan(
      planFor("work.stop", { machine: "Komatsu PC200", endHourMeter: 1208 }),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome).toEqual({ status: "done" });
    expect(sent.body).toMatchObject({ endHourMeter: 1208, endDate: "2026-10-20" });
  });

  it("uses the day the owner did say", async () => {
    render(
      <StopWorkDialog
        excavatorId="ex_1"
        workSessionId="ws_1"
        currentHourMeter={1200}
        startDate="2026-10-20"
      />,
    );
    await executePlan(
      planFor("work.stop", {
        machine: "Komatsu PC200",
        endHourMeter: 1208,
        endDate: "2026-10-22",
      }),
      () => undefined,
      { waitMs: 400 },
    );
    expect(sent.body).toMatchObject({ endDate: "2026-10-22" });
  });
});

describe("adding a day's reading through the real dialog", () => {
  it("sends the meter and the diesel in litres", async () => {
    render(<AddDailyLogDialog excavatorId="ex_1" workSessionId="ws_1" currentHourMeter={1200} />);

    const outcome = await executePlan(
      planFor("reading.add", {
        machine: "Komatsu PC200",
        date: "2026-10-23",
        endHourMeter: 1208,
        dieselLiters: 40,
      }),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome).toEqual({ status: "done" });
    // FormData.get() returns strings; the route's zod schema coerces them. What
    // matters is that the right digits arrive, not their JavaScript type.
    expect(sent.body).toMatchObject({ date: "2026-10-23" });
    expect(Number(sent.body?.endHourMeter)).toBe(1208);
    // Litres, never rupees — the registry and the form have to agree on that.
    expect(Number(sent.body?.dieselLiters)).toBe(40);
  });

  it("leaves diesel out rather than zeroing it when none was mentioned", async () => {
    render(<AddDailyLogDialog excavatorId="ex_1" workSessionId="ws_1" currentHourMeter={1200} />);
    await executePlan(
      planFor("reading.add", { machine: "Komatsu PC200", date: "2026-10-23", endHourMeter: 1208 }),
      () => undefined,
      { waitMs: 400 },
    );
    // A machine that took no diesel is not a machine that took zero litres.
    expect(sent.body?.dieselLiters === undefined || sent.body?.dieselLiters === "").toBe(true);
  });
});

describe("pairing an operator through the real dialog", () => {
  it("sends the operator the owner named", async () => {
    render(
      <AssignOperatorDialog
        excavatorId="ex_1"
        operators={[
          { id: "op_1", name: "Banda Patil" },
          { id: "op_2", name: "Ramesh Jadhav" },
        ]}
        hasCurrentOperator={false}
      />,
    );

    const outcome = await executePlan(
      planFor("machine.allocate_operator", { machine: "Komatsu PC200", operator: "Ramesh" }),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome).toEqual({ status: "done" });
    expect(sent.body).toMatchObject({ operatorId: "op_2" });
  });

  it("stops and asks when two operators share a surname", async () => {
    render(
      <AssignOperatorDialog
        excavatorId="ex_1"
        operators={[
          { id: "op_1", name: "Banda Patil" },
          { id: "op_3", name: "Sagar Patil" },
        ]}
        hasCurrentOperator={false}
      />,
    );

    const outcome = await executePlan(
      planFor("machine.allocate_operator", { machine: "Komatsu PC200", operator: "Patil" }),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome.status).toBe("needs_choice");
    // Nothing was sent. Putting the wrong driver on a machine is a day's wages
    // against the wrong name.
    expect(sent.body).toBeNull();
  });
});

describe("money against a person, through the real dialog", () => {
  it("sends the amount, category and date exactly as approved", async () => {
    render(
      <AddTransactionDialog
        operatorId="op_1"
        categories={[
          { id: "cat_1", name: "Advance" },
          { id: "cat_2", name: "Bonus" },
        ]}
      />,
    );

    const outcome = await executePlan(
      planFor("operator.transaction.add", {
        operator: "Banda Patil",
        amount: 2000,
        category: "Advance",
        date: "2026-10-23",
      }),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome).toEqual({ status: "done" });
    expect(sent.url).toBe("/api/operators/op_1/transactions");
    // The figure is the whole point. 2000 must arrive as 2000.
    expect(Number(sent.body?.amount)).toBe(2000);
    expect(sent.body).toMatchObject({ categoryId: "cat_1", date: "2026-10-23" });
  });
});

describe("adding a customer through the real form", () => {
  it("sends the name and the number", async () => {
    render(<AddCustomerForm />);

    const outcome = await executePlan(
      // customer-detail is the page it navigates to afterwards, not part of
      // this form. The redirect is asserted below instead.
      planFor("customer.create", { name: "Ramesh Patil", mobile: "9876543210" }, ["customer-detail"]),
      () => undefined,
      { waitMs: 400 },
    );
    expect(outcome).toEqual({ status: "done" });
    expect(sent.body).toMatchObject({ name: "Ramesh Patil", mobile: "9876543210" });
    // And it lands on the new customer, which is what the workflow waits for.
    await settle();
    expect(routed.to).toContain("/customers/detail");
  });
});
