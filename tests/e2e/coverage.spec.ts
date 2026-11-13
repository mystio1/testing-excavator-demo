import { askAssistant, expect, signIn, stubAgent, test, warmUp, watchResults, withDb } from "./fixtures";

/**
 * Every capability, driven in a real browser.
 *
 * `assistant.spec.ts` proves the mechanisms — the navigation spine, modal
 * inertness, a stale control, an ambiguous name. This proves the COVERAGE:
 * that each registered capability actually lands on the page it claims and
 * that page actually shows what it claims, which is a promise the registry
 * makes and only a browser can check.
 *
 * The reads are driven through the `run` action rather than a stubbed model.
 * That is not a shortcut: it is the same path the tappable shortcuts use, so
 * it tests the thing an owner taps AND the registry's own allowlist, with no
 * model in the loop to make it flaky.
 */

test.beforeEach(async ({ page, yard }) => {
  await signIn(page, yard);
  await warmUp(page, yard);
});

/**
 * The reads a tap can run. Each must land on its page, show its verify
 * control, and send back text worth reading — an empty screen would mean the
 * assistant answers "I opened it, but found nothing to read".
 */
const TAPPABLE: { id: string; label: RegExp; expectText: RegExp }[] = [
  { id: "business.dashboard.view", label: /how is business/i, expectText: /hours|revenue|received|pending/i },
  { id: "machine.list", label: /my machines/i, expectText: /Komatsu|PC200/i },
  { id: "approvals.view", label: /needs my approval/i, expectText: /caught up|approval|reading|job/i },
  { id: "bill.list", label: /money still to come/i, expectText: /bill|unpaid|no bills|total/i },
  { id: "operator.list", label: /my operators/i, expectText: /Patil/i },
  { id: "customer.list", label: /my customers/i, expectText: /Shree/i },
  { id: "site.list", label: /my sites/i, expectText: /site|no sites/i },
  { id: "assistant.history.view", label: /what did you do/i, expectText: /nothing yet|saved|approved/i },
];

for (const capability of TAPPABLE) {
  test(`${capability.id}: opens its page and reads back something`, async ({ page }) => {
    // Nothing stubbed: a tapped shortcut involves no model, so this is the
    // real route, the real registry and the real database end to end.
    const results = watchResults(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Assistant" }).click();

    // Tapped, exactly as an owner would — no model involved.
    await page.getByRole("button", { name: capability.label }).click();

    await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
    const reported = results.at(-1)!;
    expect(reported.verified, `${capability.id} never showed its verify control`).toBe(true);
    expect(reported.screenText, `${capability.id} reported no screen text`).toBeTruthy();
    expect(reported.screenText!).toMatch(capability.expectText);
  });
}

/** The reads that name a record. These need a plan, so the model is stubbed —
 * but the plan itself comes from the real registry. */
const ENTITY_READS: { id: string; fields: Record<string, string>; expectText: RegExp }[] = [
  { id: "machine.status.view", fields: { machine: "Komatsu PC200" }, expectText: /PC200|hrs|idle|working/i },
  { id: "machine.service.view", fields: { machine: "Komatsu PC200" }, expectText: /service|due|no service/i },
  { id: "operator.salary.view", fields: { operator: "Banda Patil" }, expectText: /salary|paid|earned|session/i },
];

for (const capability of ENTITY_READS) {
  test(`${capability.id}: finds the record and reads its page`, async ({ page }) => {
    const { results } = await stubAgent(page, { workflowId: capability.id, fields: capability.fields });
    await page.goto("/dashboard");
    await askAssistant(page, "tell me about it");

    await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
    const reported = results.at(-1)!;
    expect(reported.verified, `${capability.id} never showed its verify control`).toBe(true);
    expect(reported.screenText!).toMatch(capability.expectText);
  });
}

test("site.analysis.view: opens one site once there is one to open", async ({ page, yard }) => {
  // A site exists only once work has been done on one, so this seeds it the
  // way the app would.
  // A name unique to this run. Two sites called the same thing is genuinely
  // ambiguous and the assistant is right to refuse it — an earlier version of
  // this test seeded a duplicate and then asserted success, which made the
  // product look broken for doing exactly what it should.
  const siteId = `site-${Date.now()}`;
  const siteName = `Wakad Plot ${Date.now()}`;
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "Site" ("id","businessId","name","type","status","customerId") VALUES ($1,$2,$3,'CUSTOMER_SITE','ACTIVE',$4)`,
      [siteId, yard.businessId, siteName, yard.customerId],
    );
  });

  const { results } = await stubAgent(page, {
    workflowId: "site.analysis.view",
    fields: { site: siteName },
  });
  await page.goto("/dashboard");
  await askAssistant(page, "Wakad pe kitna kaam hua?");

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
  expect(results.at(-1)!.verified).toBe(true);
  expect(results.at(-1)!.screenText!).toMatch(/machines|hours|revenue|pending/i);
});

test("customer.create: writes a customer, and the page it lands on proves it", async ({ page, yard }) => {
  const name = `E2E Customer ${Date.now()}`;
  const { results } = await stubAgent(page, {
    workflowId: "customer.create",
    needsConfirm: true,
    fields: { name, mobile: "9333333301" },
  });

  await page.goto("/dashboard");
  await askAssistant(page, `naya customer ${name}`);
  await page.getByRole("button", { name: /yes, save it/i }).click();

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
  expect(results.at(-1)!.verified).toBe(true);

  const row = await withDb(async (c) =>
    (
      await c.query(`SELECT "mobile" FROM "Customer" WHERE "businessId" = $1 AND "name" = $2`, [
        yard.businessId,
        name,
      ])
    ).rows[0] as { mobile: string } | undefined,
  );
  expect(row, "no customer was written").toBeTruthy();
  expect(row!.mobile).toBe("9333333301");
});

test("operator.transaction.add: money reaches the database exactly as approved", async ({ page, yard }) => {
  // The one where a wrong figure is a wrong figure against a person's name.
  const { results } = await stubAgent(page, {
    workflowId: "operator.transaction.add",
    needsConfirm: true,
    fields: {
      operator: "Banda Patil",
      amount: 2000,
      category: yard.categoryName,
      date: new Date().toISOString().slice(0, 10),
    },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "Patil ko 2000 advance diya");
  // The figure is on the approval card before anything is written.
  const panel = page.getByRole("region", { name: "Assistant" });
  await expect(panel.getByText(/2000/).last()).toBeVisible();
  await page.getByRole("button", { name: /yes, save it/i }).click();

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
  expect(results.at(-1)!.verified).toBe(true);

  const row = await withDb(async (c) =>
    (
      await c.query(
        `SELECT "amount"::text AS amount FROM "OperatorTransaction"
         WHERE "businessId" = $1 AND "operatorId" = $2 ORDER BY "createdAt" DESC LIMIT 1`,
        [yard.businessId, yard.operatorId],
      )
    ).rows[0] as { amount: string } | undefined,
  );
  expect(row, "no transaction was written").toBeTruthy();
  expect(Number(row!.amount)).toBe(2000);
});

test("work.stop: finishes the job that work.start began", async ({ page, yard }) => {
  // Seeded rather than chained off another test: a test that only passes when
  // its neighbour ran first is a test that fails for the wrong reason.
  const sessionId = `ws-${Date.now()}`;
  const siteId = `site-stop-${Date.now()}`;
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "Site" ("id","businessId","name","type","status","customerId") VALUES ($1,$2,$3,'CUSTOMER_SITE','ACTIVE',$4)`,
      [siteId, yard.businessId, "Stop Test Site", yard.customerId],
    );
    // The app allows a machine exactly ONE active job, and enforces it with a
    // row lock. Seeding straight into the table bypasses that guard — and the
    // yard is shared with the work.start test, which may have left one. Two
    // active jobs on one machine is a state the app cannot produce, and the
    // stop dialog then stopped the other one while this assertion watched the
    // wrong row.
    await c.query(
      `UPDATE "WorkSession" SET "status" = 'COMPLETED', "endDate" = NOW(), "updatedAt" = NOW()
       WHERE "businessId" = $1 AND "excavatorId" = $2 AND "status" = 'ACTIVE'`,
      [yard.businessId, yard.machineId],
    );
    await c.query(
      `INSERT INTO "WorkSession"
         ("id","businessId","excavatorId","customerId","siteId","operatorId","startDate","startHourMeter","totalHours","status","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'ACTIVE',NOW())`,
      [sessionId, yard.businessId, yard.machineId, yard.customerId, siteId, yard.operatorId, new Date("2026-10-20"), 1200],
    );
  });

  const { results } = await stubAgent(page, {
    workflowId: "work.stop",
    needsConfirm: true,
    fields: { machine: "Komatsu PC200", endHourMeter: 1208 },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "Komatsu ka kaam band karo, meter 1208");
  await page.getByRole("button", { name: /yes, save it/i }).click();

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);

  const row = await withDb(async (c) =>
    (
      await c.query(`SELECT "status", "endHourMeter" FROM "WorkSession" WHERE "id" = $1`, [sessionId])
    ).rows[0] as { status: string; endHourMeter: string | null } | undefined,
  );
  expect(row!.status).toBe("COMPLETED");
  expect(Number(row!.endHourMeter)).toBe(1208);
});

/**
 * Every read's verify control, on a business with nothing in it.
 *
 * This is the state every customer starts in, and it is where a read workflow
 * breaks silently: a control rendered inside `length === 0 ? <Empty/> :
 * <List/>` is simply absent, so the assistant reports "I couldn't confirm" for
 * a page that is correct and merely empty. `site.list` had exactly that bug.
 *
 * Checked by visiting the pages directly rather than through the assistant —
 * what is being tested is the promise the registry makes about the markup, and
 * nothing else needs to be in the way of that.
 */
test.describe("an empty business", () => {
  test("still shows every read's verify control", async ({ browser }) => {
    // Its OWN browser context, not the shared page: the file's beforeEach has
    // already signed in as the seeded yard, and /login simply redirects an
    // owner who is already signed in — so the form never appeared and this sat
    // waiting for it until the timeout, looking at the wrong business the
    // whole time.
    test.setTimeout(240_000);
    const { createEmptyYard, removeYard } = await import("./fixtures");
    const empty = await createEmptyYard();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto("/login");
      await page.getByLabel("Email or phone number").fill(empty.email);
      await page.getByLabel("Password", { exact: true }).fill(empty.password);
      await page.getByRole("button", { name: /log in/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });

      const { allWorkflows } = await import("@/lib/agent/resolver");
      const reads = allWorkflows().filter(
        (w) => w.status === "ready" && w.effect === "READ" && w.fields.length === 0,
      );
      expect(reads.length, "no no-field reads found — has the registry changed shape?").toBeGreaterThan(0);

      for (const workflow of reads) {
        await page.goto(workflow.route);
        await expect(
          page.locator(`[data-agent-id="${workflow.verify.control}"]`),
          `${workflow.id}: ${workflow.verify.control} is missing on a business with no data`,
        ).toBeVisible({ timeout: 30_000 });
      }
    } finally {
      await context.close();
      await removeYard(empty.businessId);
    }
  });
});

/**
 * Every control the assistant CLICKS must be something that responds to a
 * click.
 *
 * `pickFromList` clicks the element it was handed. Annotate the `<Card>`
 * wrapper instead of the link inside it and the click lands on a div with no
 * handler: nothing happens, nothing errors, and the run reports "I couldn't
 * confirm" for a page that was fine. `site-card` had exactly that bug — the
 * card rendered, the name was right there on screen, and the click did
 * nothing. machine-card was on its `<Link>` all along, which is why it worked
 * and hid the pattern.
 */
test.describe("the controls the assistant clicks", () => {
  test("are links or buttons, not inert wrappers", async ({ page, yard }) => {
    const { allWorkflows } = await import("@/lib/agent/resolver");

    // One site, so the site cards have something to render.
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO "Site" ("id","businessId","name","type","status","customerId")
         VALUES ($1,$2,$3,'CUSTOMER_SITE','ACTIVE',$4) ON CONFLICT DO NOTHING`,
        [`site-click-${Date.now()}`, yard.businessId, "Click Test Site", yard.customerId],
      );
    });

    const picks = new Map<string, string>();
    for (const workflow of allWorkflows()) {
      if (workflow.status !== "ready") continue;
      for (const step of workflow.steps) {
        if (step.action === "pickFromList") picks.set(step.control, workflow.route);
      }
    }
    expect(picks.size, "no pickFromList controls found — has the registry changed shape?").toBeGreaterThan(0);

    for (const [control, route] of picks) {
      // The first step of these workflows is always a navigate to the list the
      // records are on, which is the route the registry declares.
      await page.goto(route.startsWith("/excavators/detail") ? "/excavators" : route.replace("/detail", ""));
      const element = page.locator(`[data-agent-id="${control}"]`).first();
      await element.waitFor({ timeout: 30_000 });

      const tag = await element.evaluate((node) => node.tagName.toLowerCase());
      const clickable = await element.evaluate(
        (node) =>
          node.tagName === "A" ||
          node.tagName === "BUTTON" ||
          node.getAttribute("role") === "button" ||
          node.getAttribute("role") === "link" ||
          !!node.closest("a,button"),
      );
      expect(clickable, `${control} is a <${tag}> with nothing to click — annotate the link or button`).toBe(true);
    }
  });
});
