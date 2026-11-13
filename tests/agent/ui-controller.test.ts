// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executePlan, readControl, readSettledControl, verifyResult } from "@/lib/agent/ui-controller";
import type { UiOperation } from "@/lib/agent/plan";

/**
 * The browser half, against a real DOM.
 *
 * This is the component that had no test at all, and it is the one that
 * actually touches the owner's forms. The markup here mirrors the annotated
 * controls in the app — that the ids exist in the source is enforced
 * separately by manifest.test.ts, so what is left to prove is the behaviour:
 * that a value reaches React rather than only the screen, that two possible
 * records stop the run instead of being guessed at, and that a plan which
 * cannot be finished stops where it is rather than carrying on.
 *
 * This is not a substitute for driving the real app in a browser. jsdom has no
 * layout, no real event loop pressure and no React here, so the React-value
 * path is asserted through the events the app's own onChange would receive.
 */

const nav = () => undefined;

/** Markup shaped like the real start-work dialog. */
function startWorkForm() {
  document.body.innerHTML = `
    <div data-agent-id="machine-detail">
      <button data-agent-id="start-work-trigger">Start Work</button>
      <form>
        <select data-agent-id="customerId">
          <option value="">Choose</option>
          <option value="cus_1">Shree Constructions</option>
          <option value="cus_2">Patil Developers</option>
          <option value="cus_3">Patil Builders</option>
        </select>
        <input data-agent-id="siteName" />
        <input data-agent-id="startHourMeter" type="number" />
        <button data-agent-id="start-work-submit" type="button">Save</button>
      </form>
    </div>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("filling a form", () => {
  it("sets a value the way the app's own onChange will see it", () => {
    // Assigning .value alone leaves React's tracker thinking nothing changed,
    // so the field looks filled and the form submits empty. The events are the
    // proof that the app was told.
    startWorkForm();
    const el = document.querySelector<HTMLInputElement>('[data-agent-id="siteName"]')!;
    const seen: string[] = [];
    el.addEventListener("input", () => seen.push(`input:${el.value}`));
    el.addEventListener("change", () => seen.push(`change:${el.value}`));

    return executePlan([{ action: "fill", control: "siteName", value: "Wakad" }], nav).then(
      (outcome) => {
        expect(outcome).toEqual({ status: "done" });
        expect(el.value).toBe("Wakad");
        expect(seen).toEqual(["input:Wakad", "change:Wakad"]);
      },
    );
  });

  it("will not type into something that is not a field", async () => {
    document.body.innerHTML = `<div data-agent-id="siteName">not an input</div>`;
    const outcome = await executePlan(
      [{ action: "fill", control: "siteName", value: "Wakad" }],
      nav,
    );
    expect(outcome).toMatchObject({ status: "failed" });
  });

  it("touches only controls the plan named, never a lookalike", async () => {
    // An input with the same `name` but no annotation is not the agent's to
    // fill: the annotation IS the contract.
    document.body.innerHTML = `
      <input name="siteName" id="unannotated" />
      <input data-agent-id="siteName" id="annotated" />`;
    await executePlan([{ action: "fill", control: "siteName", value: "Wakad" }], nav);
    expect(document.querySelector<HTMLInputElement>("#unannotated")!.value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#annotated")!.value).toBe("Wakad");
  });
});

describe("choosing in a dropdown", () => {
  it("takes an id straight through when the value is already resolved", async () => {
    startWorkForm();
    const outcome = await executePlan(
      [{ action: "select", control: "customerId", value: "cus_1" }],
      nav,
    );
    expect(outcome).toEqual({ status: "done" });
    expect(document.querySelector<HTMLSelectElement>('[data-agent-id="customerId"]')!.value).toBe("cus_1");
  });

  it("matches a spoken name against what the dropdown actually offers", async () => {
    startWorkForm();
    const outcome = await executePlan(
      [{ action: "select", control: "customerId", value: "Shree Constructions" }],
      nav,
    );
    expect(outcome).toEqual({ status: "done" });
    expect(document.querySelector<HTMLSelectElement>('[data-agent-id="customerId"]')!.value).toBe("cus_1");
  });

  it("asks when two customers could be meant", async () => {
    startWorkForm();
    const outcome = await executePlan(
      [{ action: "select", control: "customerId", value: "Patil" }],
      nav,
    );
    expect(outcome).toMatchObject({ status: "needs_choice", query: "Patil" });
    if (outcome.status !== "needs_choice") throw new Error("unreachable");
    expect(outcome.choices).toEqual(["Patil Developers", "Patil Builders"]);
    // Nothing was chosen. Picking the first would put a job on the wrong
    // customer's bill.
    expect(document.querySelector<HTMLSelectElement>('[data-agent-id="customerId"]')!.value).toBe("");
  });

  it("asks when nothing matches, which is what catches an invented name", async () => {
    startWorkForm();
    const outcome = await executePlan(
      [{ action: "select", control: "customerId", value: "Wakad" }],
      nav,
    );
    // "Wakad" is a site the model copied into the customer field. It matches no
    // real customer, so it becomes a question rather than a record.
    expect(outcome).toMatchObject({ status: "needs_choice" });
    if (outcome.status !== "needs_choice") throw new Error("unreachable");
    expect(outcome.choices).toContain("Shree Constructions");
  });

  it("tells paid leave from unpaid, where one label contains the other", async () => {
    // "Unpaid Leave" contains "paid". Getting this wrong costs the owner a
    // day's wages in the wrong direction, so it is worth pinning.
    document.body.innerHTML = `
      <select data-agent-id="leaveType">
        <option value="UNPAID">Unpaid Leave</option>
        <option value="PAID">Paid Leave</option>
      </select>`;
    const el = document.querySelector<HTMLSelectElement>('[data-agent-id="leaveType"]')!;

    expect(await executePlan([{ action: "select", control: "leaveType", value: "PAID" }], nav)).toEqual({
      status: "done",
    });
    expect(el.value).toBe("PAID");

    // And spoken, in lower case, where only the label can match.
    el.value = "UNPAID";
    const spoken = await executePlan(
      [{ action: "select", control: "leaveType", value: "paid" }],
      nav,
    );
    // Either it picks Paid Leave, or it asks — both are safe. What it must
    // never do is silently leave the owner's "paid" recorded as unpaid.
    if (spoken.status === "done") expect(el.value).toBe("PAID");
    else expect(spoken.status).toBe("needs_choice");
  });

  it("will not choose in something that is not a dropdown", async () => {
    document.body.innerHTML = `<input data-agent-id="customerId" />`;
    const outcome = await executePlan(
      [{ action: "select", control: "customerId", value: "cus_1" }],
      nav,
    );
    expect(outcome).toMatchObject({ status: "failed" });
  });
});

describe("picking one record from a list", () => {
  const machines = (labels: string[]) => {
    document.body.innerHTML = `<div>${labels
      .map((l, i) => `<div data-agent-id="machine-card" data-agent-label="${l}" id="m${i}"></div>`)
      .join("")}</div>`;
  };

  it("clicks the one machine meant", async () => {
    machines(["Komatsu PC200 PC200-2", "Test JCB TST-1", "Tata Hitachi EX200"]);
    const clicked: string[] = [];
    for (const el of document.querySelectorAll("[data-agent-id]")) {
      el.addEventListener("click", () => clicked.push(el.id));
    }
    const outcome = await executePlan(
      [{ action: "pickFromList", control: "machine-card", query: "JCB" }],
      nav,
    );
    expect(outcome).toEqual({ status: "done" });
    expect(clicked).toEqual(["m1"]);
  });

  it("ignores spoken filler around the name", async () => {
    machines(["Komatsu PC200 PC200-2", "Test JCB TST-1"]);
    const outcome = await executePlan(
      [{ action: "pickFromList", control: "machine-card", query: "machine number PC200-2" }],
      nav,
    );
    expect(outcome).toEqual({ status: "done" });
  });

  it("asks rather than taking the first of two that fit", async () => {
    machines(["Banda Patil", "Sagar Patil"]);
    const clicked: string[] = [];
    for (const el of document.querySelectorAll("[data-agent-id]")) {
      el.addEventListener("click", () => clicked.push(el.id));
    }
    const outcome = await executePlan(
      [{ action: "pickFromList", control: "machine-card", query: "Patil" }],
      nav,
    );
    expect(outcome).toMatchObject({ status: "needs_choice" });
    expect(clicked).toEqual([]);
  });

  it("fails rather than hanging when the list never loads", async () => {
    document.body.innerHTML = "";
    const outcome = await executePlan(
      [{ action: "pickFromList", control: "machine-card", query: "JCB" }],
      nav,
      // The real wait is 8s, for a dialog mounting on a yard's connection.
      // The behaviour under test is what happens when it runs out.
      { waitMs: 150 },
    );
    expect(outcome).toMatchObject({ status: "failed" });
  });
});

describe("clicking and submitting", () => {
  it("refuses a button the app has disabled", async () => {
    // The service dialog disables Save until a part is ticked. Clicking it
    // anyway would report a save that never happened.
    document.body.innerHTML = `<button data-agent-id="start-work-submit" disabled>Save</button>`;
    const outcome = await executePlan(
      [{ action: "submit", control: "start-work-submit" }],
      nav,
    );
    expect(outcome).toMatchObject({ status: "failed", reason: "That button is not available yet." });
  });

  it("stops at the first operation it cannot do, and runs no more", async () => {
    startWorkForm();
    const submit = document.querySelector<HTMLButtonElement>('[data-agent-id="start-work-submit"]')!;
    const clicks: number[] = [];
    submit.addEventListener("click", () => clicks.push(1));

    const outcome = await executePlan(
      [
        { action: "fill", control: "siteName", value: "Wakad" },
        // Not on the page: a half-filled form left alone is recoverable.
        { action: "fill", control: "nope-not-here", value: "x" },
        { action: "submit", control: "start-work-submit" },
      ],
      nav,
      { waitMs: 150 },
    );
    expect(outcome).toMatchObject({ status: "failed" });
    expect(clicks).toEqual([]);
  });

  it("navigates through the router it was given, not the browser", async () => {
    const navigate = vi.fn();
    await executePlan([{ action: "navigate", route: "/excavators" }], navigate);
    expect(navigate).toHaveBeenCalledWith("/excavators");
  });

  it("re-checks the plan on arrival instead of trusting it came from us", async () => {
    // The plan crossed the network. An operation outside the closed set is
    // refused here even if something upstream let it through.
    const smuggled = { action: "runScript", control: "x" } as unknown as UiOperation;
    const outcome = await executePlan([smuggled], nav);
    expect(outcome).toMatchObject({ status: "failed", reason: "That action is not allowed." });
  });
});

describe("getting out of the way before asking a question", () => {
  /** A modal dialog, as the app's own ones are: it makes the rest of the page
   * inert, and the assistant's panel is part of the rest of the page. */
  const openDialog = (inner: string) => {
    document.body.innerHTML = `<div role="dialog" aria-label="Change Operator">${inner}</div>`;
    const seen: string[] = [];
    document.addEventListener("keydown", (e) => seen.push(e.key));
    return seen;
  };

  it("closes the dialog it opened when it has to ask which record was meant", async () => {
    // Without this the question is rendered behind the overlay: the owner sees
    // a half-filled form, no explanation, and no way to answer.
    const keys = openDialog(`
      <select data-agent-id="assign-operator-select">
        <option value="">Select operator</option>
        <option value="op_1">Banda Patil</option>
        <option value="op_2">Sagar Patil</option>
      </select>`);

    const outcome = await executePlan(
      [{ action: "select", control: "assign-operator-select", value: "Patil" }],
      nav,
    );
    expect(outcome.status).toBe("needs_choice");
    expect(keys).toContain("Escape");
  });

  it("closes it when a step fails outright", async () => {
    const keys = openDialog(`<button data-agent-id="assign-operator-submit" disabled>Save</button>`);
    const outcome = await executePlan(
      [{ action: "submit", control: "assign-operator-submit" }],
      nav,
    );
    expect(outcome.status).toBe("failed");
    expect(keys).toContain("Escape");
  });

  it("leaves the page alone when no dialog is open", async () => {
    document.body.innerHTML = `<div id="plain"></div>`;
    const seen: string[] = [];
    document.addEventListener("keydown", (e) => seen.push(e.key));
    await executePlan([{ action: "fill", control: "nope", value: "x" }], nav, { waitMs: 100 });
    expect(seen).toEqual([]);
  });
});

/** The control's state as the controller computes it, read off the live DOM so
 * a test can never drift from the real signature. */
const stateNow = (control: string) => {
  const el = document.querySelector(`[data-agent-id="${control}"]`)!;
  return {
    existed: true,
    signature: `${el.children.length}:${(el.textContent ?? "").replace(/\s+/g, " ").trim().length}`,
  };
};

describe("reporting what the screen shows", () => {
  it("confirms a control that is present", async () => {
    document.body.innerHTML = `<div data-agent-id="active-work-card">Working</div>`;
    expect(await verifyResult("active-work-card")).toBe(true);
  });

  it("will not call an unchanged list proof that anything saved", async () => {
    // The bug: an operator who already had transactions already had the list
    // on screen, so "the control appeared" was true whether or not the save
    // worked — and the owner was told "Done. It's saved."
    document.body.innerHTML = `
      <div data-agent-id="transactions-list">
        <div>Advance 2000</div>
      </div>`;
    const before = stateNow("transactions-list");
    // Nothing was added.
    expect(await verifyResult("transactions-list", before, 200)).toBe(false);
  });

  it("confirms it once a row actually appears in a list that was already there", async () => {
    document.body.innerHTML = `
      <div data-agent-id="transactions-list">
        <div>Advance 2000</div>
      </div>`;
    const before = stateNow("transactions-list");
    // The save lands and the list re-renders with the new row.
    const row = document.createElement("div");
    row.textContent = "Bonus 500";
    document.querySelector('[data-agent-id="transactions-list"]')!.appendChild(row);
    expect(await verifyResult("transactions-list", before, 1000)).toBe(true);
  });

  it("treats appearing from nothing as proof, which is the empty-list case", async () => {
    document.body.innerHTML = "";
    const before = { existed: false, signature: "" };
    document.body.innerHTML = `<div data-agent-id="leaves-list"><div>22 Oct</div></div>`;
    expect(await verifyResult("leaves-list", before, 1000)).toBe(true);
  });

  it("records the control's state just before the submit, not at the start", async () => {
    // The plan navigates and opens a dialog first, so the control's state at
    // the start of the plan says nothing about the page the save lands on.
    document.body.innerHTML = `
      <div data-agent-id="transactions-list"><div>Advance 2000</div></div>
      <button data-agent-id="add-transaction-submit">Save</button>`;
    const outcome = await executePlan(
      [{ action: "submit", control: "add-transaction-submit" }],
      nav,
      { verify: "transactions-list" },
    );
    expect(outcome.status).toBe("done");
    if (outcome.status !== "done") throw new Error("unreachable");
    expect(outcome.before).toEqual(stateNow("transactions-list"));
  });

  it("does not confirm one that never appears", async () => {
    document.body.innerHTML = "";
    expect(await verifyResult("active-work-card", 200)).toBe(false);
  });

  it("reads a control's text, collapsed and bounded", () => {
    document.body.innerHTML = `
      <div data-agent-id="dashboard-cards">
        <p>Hours This Month</p>   <p>126.3 hrs</p>
      </div>`;
    expect(readControl("dashboard-cards")).toBe("Hours This Month 126.3 hrs");
    expect(readControl("dashboard-cards", 5)).toBe("Hours");
  });

  it("returns nothing for a control that is not there", () => {
    document.body.innerHTML = "";
    expect(readControl("dashboard-cards")).toBeNull();
  });

  it("waits out a loading placeholder rather than quoting it", async () => {
    // Measured in a browser: asked when a machine's service was due, the
    // assistant read back "Loading…" — the control exists because it IS the
    // container, and the container renders before its data arrives. For a
    // read, the text is the answer.
    document.body.innerHTML = `<div data-agent-id="service-tab">Loading…</div>`;
    const el = document.querySelector('[data-agent-id="service-tab"]')!;
    setTimeout(() => {
      el.textContent = "Service due in 150 hrs";
    }, 200);

    const text = await readSettledControl("service-tab", {
      timeoutMs: 3000,
      intervalMs: 50,
      stableForMs: 150,
    });
    expect(text).toBe("Service due in 150 hrs");
  });

  it("waits for a list to stop growing, not just to have a first row", async () => {
    // One row quoted out of five is a wrong answer, not a partial one:
    // "you have one machine" when they have five.
    document.body.innerHTML = `<div data-agent-id="machine-list"><p>JCB</p></div>`;
    const el = document.querySelector('[data-agent-id="machine-list"]')!;
    setTimeout(() => {
      el.innerHTML = "<p>JCB</p><p>Komatsu PC200</p><p>Tata Hitachi</p>";
    }, 150);

    const text = await readSettledControl("machine-list", {
      timeoutMs: 3000,
      intervalMs: 50,
      stableForMs: 250,
    });
    expect(text).toContain("Komatsu PC200");
    expect(text).toContain("Tata Hitachi");
  });

  it("gives back whatever is there when a slow page runs out of time", async () => {
    // A late answer from a slow page beats none, and the summariser is told to
    // say when it cannot find something.
    document.body.innerHTML = `<div data-agent-id="service-tab">Loading…</div>`;
    const text = await readSettledControl("service-tab", { timeoutMs: 250, intervalMs: 50 });
    expect(text).toBe("Loading…");
  });

  it("returns nothing when the control is absent, without waiting", async () => {
    document.body.innerHTML = "";
    expect(await readSettledControl("service-tab", { timeoutMs: 2000 })).toBeNull();
  });
});
