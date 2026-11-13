import { askAssistant, expect, signIn, stubAgent, test, warmUp, withDb } from "./fixtures";

/**
 * The assistant in a real browser, on a phone-sized screen.
 *
 * Each of these covers something the vitest suite cannot see. Where a write is
 * involved the assertion is on the DATABASE, not the screen: "the card
 * appeared" is what the assistant itself checks, so a test that only checked
 * the same thing would prove nothing new.
 */

test.beforeEach(async ({ page, yard }) => {
  await signIn(page, yard);
  await warmUp(page, yard);
});

test("the panel is there for a signed-in owner, and says where the voice goes before asking", async ({
  page,
}) => {
  await page.goto("/dashboard");

  const open = page.getByRole("button", { name: "Assistant" });
  await expect(open).toBeVisible();
  await open.click();

  // Tapping the microphone must say where the owner's voice goes BEFORE any
  // permission box: a few seconds of audio carrying customers' names and
  // numbers leaves the country, and that is owed to them plainly.
  await page.getByRole("button", { name: "Speak" }).click();
  const panel = page.getByRole("region", { name: "Assistant" });
  await expect(panel.getByText(/outside India/i)).toBeVisible();
  await expect(panel.getByText(/not saved anywhere/i)).toBeVisible();
  // Refusing is a button of the same size as agreeing, not a close icon.
  await expect(page.getByRole("button", { name: /I understand, use the microphone/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /I'll type instead/i })).toBeVisible();
});

test("a question is answered from the figures actually rendered on the page", async ({ page }) => {
  // readControl() uses innerText, which respects CSS visibility. jsdom has no
  // layout and silently falls back to textContent, so what the assistant
  // quotes back to the owner can only be checked here.
  const { results } = await stubAgent(page, { workflowId: "business.dashboard.view" });

  await page.goto("/dashboard");
  await askAssistant(page, "is mahine kitna kaam hua?");

  await expect.poll(() => results.length, { timeout: 20_000 }).toBeGreaterThan(0);
  const reported = results.at(-1)!;
  expect(reported.verified).toBe(true);
  // Real text, from the real dashboard, with the real styling applied.
  expect(reported.screenText).toBeTruthy();
  expect(reported.screenText!.length).toBeGreaterThan(10);
  expect(reported.screenText).toMatch(/hours|revenue|received|pending/i);
});

test("the navigation spine works: list loads, the right machine is picked, the dialog opens", async ({
  page,
  yard,
}) => {
  // This is the sequence every capability starts with and that no unit test
  // runs: route change, SWR fetch, cards render, the right one is clicked, the
  // detail page settles, a dialog mounts in a portal.
  // A machine may have exactly one active job, and the yard is shared by every
  // spec file in this worker — so "can a job be started" has to make sure the
  // machine is idle rather than assume it. Without this the app correctly
  // refuses a second job and the test reads that as a failure.
  await withDb(async (c) => {
    await c.query(
      `UPDATE "WorkSession" SET "status" = 'COMPLETED', "endDate" = NOW(), "updatedAt" = NOW()
       WHERE "businessId" = $1 AND "excavatorId" = $2 AND "status" = 'ACTIVE'`,
      [yard.businessId, yard.machineId],
    );
  });

  const { results } = await stubAgent(page, {
    workflowId: "work.start",
    needsConfirm: true,
    fields: {
      machine: "Komatsu PC200",
      customer: yard.customerName,
      site: "Hinjawadi Phase 2",
      startHourMeter: 1200,
      startDate: "2026-10-23",
    },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "Komatsu ka kaam shuru karo Hinjawadi Phase 2 pe");

  // A write is approved before anything runs, and the owner is shown the
  // values. The site name also appears in their own message bubble, so this
  // looks at the approval card specifically.
  const panel = page.getByRole("region", { name: "Assistant" });
  await expect(panel.getByText("Hinjawadi Phase 2").last()).toBeVisible();
  await page.getByRole("button", { name: /yes, save it/i }).click();

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
  expect(results.at(-1)!.verified).toBe(true);

  // The real proof: a row in the database, with the values the owner approved.
  const session = await withDb(async (c) =>
    (
      await c.query(
        `SELECT ws."customerId", ws."startHourMeter", s."name" AS "siteName"
         FROM "WorkSession" ws LEFT JOIN "Site" s ON s."id" = ws."siteId"
         WHERE ws."businessId" = $1 AND ws."excavatorId" = $2
         ORDER BY ws."createdAt" DESC LIMIT 1`,
        [yard.businessId, yard.machineId],
      )
    ).rows[0] as { customerId: string; startHourMeter: string; siteName: string } | undefined,
  );
  expect(session, "no work session was written").toBeTruthy();
  expect(session!.customerId).toBe(yard.customerId);
  expect(session!.siteName).toBe("Hinjawadi Phase 2");
  expect(Number(session!.startHourMeter)).toBe(1200);
});

test("a day's reading reaches the database through the running job", async ({ page, yard }) => {
  // Depends on the job started above, which is how an owner's day actually
  // goes: start the machine, then report on it.
  const running = await withDb(async (c) =>
    (
      await c.query(`SELECT "id" FROM "WorkSession" WHERE "businessId" = $1 AND "status" = 'ACTIVE' LIMIT 1`, [
        yard.businessId,
      ])
    ).rows[0] as { id: string } | undefined,
  );
  test.skip(!running, "no active job to add a reading to");

  const { results } = await stubAgent(page, {
    workflowId: "reading.add",
    needsConfirm: true,
    fields: {
      machine: "Komatsu PC200",
      date: "2026-10-23",
      endHourMeter: 1208,
      dieselLiters: 40,
    },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "aaj Komatsu 1208 par rukhi, 40 litre diesel");
  await page.getByRole("button", { name: /yes, save it/i }).click();

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
  expect(results.at(-1)!.verified).toBe(true);

  const log = await withDb(async (c) =>
    (
      await c.query(
        `SELECT "endHourMeter", "dieselLiters" FROM "DailyWorkLog"
         WHERE "workSessionId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [running!.id],
      )
    ).rows[0] as { endHourMeter: string; dieselLiters: string } | undefined,
  );
  expect(log, "no daily log was written").toBeTruthy();
  expect(Number(log!.endHourMeter)).toBe(1208);
  // Litres, not rupees. Getting this backwards would be a diesel figure 50x
  // too big in every report that uses it.
  expect(Number(log!.dieselLiters)).toBe(40);
});

test("two operators with one surname stops the run, and writes nothing", async ({ page, yard }) => {
  const { results } = await stubAgent(page, {
    workflowId: "machine.allocate_operator",
    needsConfirm: true,
    fields: { machine: "Komatsu PC200", operator: "Patil" },
  });

  const countAssignments = async () =>
    withDb(async (c) =>
      Number(
        (
          await c.query(`SELECT COUNT(*)::int AS n FROM "OperatorAssignment" WHERE "businessId" = $1`, [
            yard.businessId,
          ])
        ).rows[0].n,
      ),
    );
  const before = await countAssignments();

  await page.goto("/dashboard");
  await askAssistant(page, "Komatsu par Patil ko lagao");
  await page.getByRole("button", { name: /yes, save it/i }).click();

  // Both operators are called Patil, so the owner is asked which — and asked
  // with BUTTONS, not a list read back for them to repeat. Being told to
  // re-say a name the app has just failed to hear is not a fix, and a tap also
  // teaches it what the mishearing meant.
  const panel = page.getByRole("region", { name: "Assistant" });
  await expect(panel.getByRole("button", { name: "Banda Patil" })).toBeVisible({ timeout: 40_000 });
  await expect(panel.getByRole("button", { name: "Sagar Patil" })).toBeVisible();

  // Nothing was reported as done, and nothing changed. Putting the wrong
  // driver on a machine is a day's wages against the wrong name.
  expect(results).toHaveLength(0);
  expect(await countAssignments()).toBe(before);
});

test("a control that never appears is reported as unconfirmed, not as saved", async ({ page }) => {
  // The honest-failure path, in a real browser with real timing. The plan is
  // real but the page it expects is not the page we are on, so the verify
  // control cannot appear.
  const { results } = await stubAgent(page, {
    workflowId: "machine.status.view",
    fields: { machine: "A Machine That Does Not Exist" },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "us machine ka status batao");

  // No match in the real list, so the owner is asked rather than told
  // something was done.
  const panel = page.getByRole("region", { name: "Assistant" });
  await expect(panel.getByText(/couldn't find|which one/i).last()).toBeVisible({ timeout: 40_000 });
  expect(results.every((r) => !r.verified)).toBe(true);
});
