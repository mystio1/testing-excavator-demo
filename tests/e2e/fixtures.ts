import { randomUUID } from "node:crypto";
import { test as base, type Page } from "@playwright/test";
import { Client } from "pg";
import bcrypt from "bcryptjs";
import { planWorkflow } from "@/lib/agent/plan";

/**
 * A throwaway business with enough in it to drive, and a real signed-in owner.
 *
 * Raw SQL rather than Prisma, for a dull reason and a good one. The dull one:
 * Playwright's loader cannot import the generated Prisma client, which is
 * ESM-only TypeScript. The good one: these assertions are about what is
 * actually in the table, so having no ORM between the test and the row is
 * closer to the claim being made.
 *
 * Deliberately NOT the vitest `createTenant` helper either: that stores
 * `passwordHash: "x"`, which no login will accept. These tests go in through
 * the real login page, because "the assistant works" includes "the panel is
 * there once the owner is signed in".
 */

export type Yard = {
  businessId: string;
  userId: string;
  email: string;
  password: string;
  machineId: string;
  machineName: string;
  operatorId: string;
  operatorName: string;
  /** Shares a surname with the assigned operator, so "Patil" is ambiguous. */
  otherOperatorId: string;
  customerId: string;
  customerName: string;
  /** Money against an operator needs a category to file it under. */
  categoryId: string;
  categoryName: string;
};

async function connect() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** One connection, opened and closed per call: the Supabase session pooler is
 * capped at 15 and the dev server is already holding a pool of its own. */
export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createYard(): Promise<Yard> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  const email = `e2e-${suffix.toLowerCase()}@example.test`;
  const password = "Correct-Horse-Battery-9!";
  const id = () => randomUUID();

  const businessId = id();
  const userId = id();
  const machineId = id();
  const operatorId = id();
  const otherOperatorId = id();
  const customerId = id();
  const assignmentId = id();
  const categoryId = id();

  const passwordHash = await bcrypt.hash(password, 10);

  await withDb(async (c) => {
    await c.query(
      // updatedAt is Prisma's @updatedAt: set by the client, not by a database
      // default, so raw SQL has to supply it. Business and Excavator both have it.
      `INSERT INTO "Business" ("id","name","ownerName","phone","code","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())`,
      [businessId, `TST e2e ${suffix}`, "E2E Owner", "9000000001", `TST${suffix}`],
    );
    await c.query(
      `INSERT INTO "User" ("id","businessId","name","email","passwordHash","role") VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, businessId, "E2E Owner", email, passwordHash, "OWNER"],
    );
    // Two operators with one surname, on purpose: "Patil" has to become a
    // question rather than a coin toss, and that is worth proving in a browser.
    // They go in before the machine, which points at one of them.
    await c.query(
      `INSERT INTO "Operator" ("id","businessId","name","mobile") VALUES ($1,$2,$3,$4), ($5,$2,$6,$7)`,
      [operatorId, businessId, "Banda Patil", "9111111101", otherOperatorId, "Sagar Patil", "9111111102"],
    );
    await c.query(
      `INSERT INTO "Excavator" ("id","businessId","name","machineNumber","brand","currentHourMeter","startingHourMeter","currentOperatorId","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [machineId, businessId, "Komatsu PC200", "PC200-2", "Komatsu", 1200, 1000, operatorId],
    );
    await c.query(
      `INSERT INTO "Customer" ("id","businessId","name","mobile") VALUES ($1,$2,$3,$4)`,
      [customerId, businessId, "Shree Constructions", "9222222201"],
    );
    // Recording money needs somewhere to file it. A real yard has these from
    // the moment it starts paying anybody.
    await c.query(
      `INSERT INTO "TransactionCategory" ("id","businessId","name","isDefault") VALUES ($1,$2,$3,true)`,
      [categoryId, businessId, "Advance"],
    );
    // A machine with no operator refuses to start a job, so the yard begins in
    // a state a real one would be in rather than one no owner ever has.
    await c.query(
      `INSERT INTO "OperatorAssignment" ("id","businessId","excavatorId","operatorId","startDate","status")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [assignmentId, businessId, machineId, operatorId, new Date("2026-10-01"), "ACTIVE"],
    );
  });

  return {
    businessId,
    userId,
    email,
    password,
    machineId,
    machineName: "Komatsu PC200",
    operatorId,
    operatorName: "Banda Patil",
    otherOperatorId,
    customerId,
    customerName: "Shree Constructions",
    categoryId,
    categoryName: "Advance",
  };
}

/**
 * A business with nothing in it: no machines, no people, no sites.
 *
 * This is the state every customer starts in, and it is where a read workflow
 * breaks in a way nobody notices — a verify control rendered inside
 * `list.length === 0 ? <Empty/> : <List/>` simply is not there, so the
 * assistant answers "I couldn't confirm" for a page that is perfectly correct
 * and merely empty. "You have no sites yet" is a real answer to "show me my
 * sites". site.list had exactly that bug until a browser run on a yard with no
 * sites found it.
 */
export async function createEmptyYard(): Promise<{ businessId: string; email: string; password: string }> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  const email = `e2e-empty-${suffix.toLowerCase()}@example.test`;
  const password = "Correct-Horse-Battery-9!";
  const businessId = randomUUID();

  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "Business" ("id","name","ownerName","phone","code","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW())`,
      [businessId, `TST empty ${suffix}`, "E2E Owner", "9000000002", `TST${suffix}`],
    );
    await c.query(
      `INSERT INTO "User" ("id","businessId","name","email","passwordHash","role") VALUES ($1,$2,$3,$4,$5,'OWNER')`,
      [randomUUID(), businessId, "E2E Owner", email, await bcrypt.hash(password, 10)],
    );
  });

  return { businessId, email, password };
}

export async function removeYard(businessId: string) {
  await withDb(async (c) => {
    // AuditLog is append-only by trigger; the same escape hatch the vitest
    // helper uses applies, scoped to this transaction only.
    await c.query("BEGIN");
    await c.query(`SELECT set_config('app.allow_audit_purge', 'on', true)`);
    await c.query(
      `DELETE FROM "DailyWorkLog" WHERE "workSessionId" IN (SELECT "id" FROM "WorkSession" WHERE "businessId" = $1)`,
      [businessId],
    );
    for (const table of [
      "WorkSession",
      "OperatorAssignment",
      "OperatorTransaction",
      "OperatorLeave",
      "OperatorWorkingPeriod",
      "OperatorWorkRequest",
      "TransactionCategory",
      "AuditLog",
    ]) {
      await c.query(`DELETE FROM "${table}" WHERE "businessId" = $1`, [businessId]);
    }
    // Excavator points at an operator, and a site at a customer, so the order
    // of these matters.
    await c.query(`UPDATE "Excavator" SET "currentOperatorId" = NULL, "currentSiteId" = NULL WHERE "businessId" = $1`, [businessId]);
    for (const table of ["Excavator", "Operator", "Site", "Customer", "User"]) {
      await c.query(`DELETE FROM "${table}" WHERE "businessId" = $1`, [businessId]);
    }
    await c.query(`DELETE FROM "Business" WHERE "id" = $1`, [businessId]);
    await c.query("COMMIT");
  });
}

/** Through the real login page, so a broken login fails these too. */
export async function signIn(page: Page, yard: Yard) {
  await page.goto("/login");
  await page.getByLabel("Email or phone number").fill(yard.email);
  await page.getByLabel("Password", { exact: true }).fill(yard.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/**
 * Stand in for the model, and only for the model.
 *
 * The reply is built with the REAL planWorkflow() from the REAL registry, so a
 * test cannot pass against a plan the app would never produce — which matters,
 * because the bug this kind of test caught last time was in the step ORDER, not
 * in any single step. Everything downstream (the panel, the controller, the
 * pages, the forms, the routes, the database) is the real thing.
 */
export async function stubAgent(
  page: Page,
  reply: {
    workflowId?: string;
    fields?: Record<string, string | number>;
    say?: string;
    /** Set for a write: the panel shows an approval card first. */
    needsConfirm?: boolean;
  },
) {
  const taskId = randomUUID();
  const plan = reply.workflowId ? planWorkflow(reply.workflowId, reply.fields ?? {}) : null;
  if (plan && !plan.ok) throw new Error(`cannot plan ${reply.workflowId}: ${plan.reason} ${plan.detail}`);

  const planPayload = plan?.ok ? { operations: plan.operations, verify: plan.verify } : undefined;
  let confirmed = false;
  const results: { verified: boolean; screenText?: string; error?: string }[] = [];

  await page.route("**/api/agent", async (route) => {
    const body = route.request().postDataJSON() as {
      action: string;
      verified?: boolean;
      screenText?: string;
      error?: string;
    };

    if (body.action === "message") {
      if (reply.needsConfirm && !confirmed) {
        return route.fulfill({
          json: {
            taskId,
            state: "READY_FOR_CONFIRMATION",
            say: "Shall I save this?",
            confirm: { summary: Object.values(reply.fields ?? {}).join(" · ") },
          },
        });
      }
      return route.fulfill({
        json: { taskId, state: "EXECUTING", say: reply.say ?? "One moment...", plan: planPayload },
      });
    }

    // A tapped shortcut needs no model, so there is nothing here to stand in
    // for: it goes to the real route. Answering it from the stub would make
    // every read look broken, which it once did.
    if (body.action === "run" || body.action === "undo") {
      return route.fallback();
    }

    if (body.action === "confirm") {
      confirmed = true;
      return route.fulfill({
        json: { taskId, state: "EXECUTING", say: "One moment...", plan: planPayload },
      });
    }

    // The browser reporting back. This is what the assertions read.
    results.push({ verified: !!body.verified, screenText: body.screenText, error: body.error });
    return route.fulfill({
      json: {
        taskId,
        state: body.verified ? "SUCCEEDED" : "NEEDS_RECOVERY",
        say: body.verified ? "Done. It's saved." : "I couldn't confirm whether that saved.",
      },
    });
  });

  return { taskId, results };
}

/**
 * Walk the pages the plan will visit, once, before measuring anything.
 *
 * `next dev` compiles each route and each API handler on its first request,
 * which can take longer than the controller's 8-second wait for a control.
 * That is a property of the dev server, not of the assistant: the first run
 * failed with "Could not choose in customerId" purely because
 * /api/customers/options was still being compiled when the dialog rendered.
 * Warming it up keeps these tests about the app's behaviour rather than its
 * build time. (Against a production build, E2E_BASE_URL, this is a no-op.)
 */
export async function warmUp(page: Page, yard: Yard) {
  await page.goto("/excavators");
  await page.getByText(yard.machineName).first().waitFor({ timeout: 30_000 });
  await page.goto(`/excavators/detail?id=${yard.machineId}`);
  // The start-work dialog's customer list comes from /api/customers/options;
  // opening it once forces that handler to compile. It is only there when the
  // machine is idle — once a job is running the page shows the active-work card
  // instead, and there is nothing to warm.
  const trigger = page.locator('[data-agent-id="start-work-trigger"]');
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    await page.locator('[data-agent-id="customerId"]').waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
  } else {
    // A running job: warm the reading dialog instead, which is what a plan
    // will reach for next.
    const reading = page.locator('[data-agent-id="add-reading-trigger"]');
    if (await reading.isVisible().catch(() => false)) {
      await reading.click();
      await page.keyboard.press("Escape");
    }
  }
  await page.goto("/dashboard");
}

/**
 * Watch what the browser reports back, without intercepting anything.
 *
 * For a tapped shortcut there is nothing to stub — no model is involved — so
 * the whole path is the real one: the real route, the real registry, the real
 * pages, the real database. This only listens, which also means it cannot
 * accidentally answer a request the app was supposed to handle itself. (That
 * mistake is exactly why this exists: stubbing every POST to /api/agent meant
 * the `run` action was answered as if it were a result, and every read looked
 * broken.)
 */
export function watchResults(page: Page) {
  const results: { verified: boolean; screenText?: string; error?: string }[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.url().includes("/api/agent")) return;
    let body: { action?: string; verified?: boolean; screenText?: string; error?: string };
    try {
      body = request.postDataJSON() as typeof body;
    } catch {
      return;
    }
    if (body?.action !== "result") return;
    results.push({ verified: !!body.verified, screenText: body.screenText, error: body.error });
  });
  return results;
}

/** Open the panel and say something. */
export async function askAssistant(page: Page, text: string) {
  await page.getByRole("button", { name: "Assistant" }).click();
  await page.getByPlaceholder("Ask or tell me something").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

export const test = base.extend<{ yard: Yard }, { sharedYard: Yard }>({
  sharedYard: [
    async ({}, use) => {
      const yard = await createYard();
      await use(yard);
      await removeYard(yard.businessId);
    },
    { scope: "worker" },
  ],
  yard: async ({ sharedYard }, use) => {
    await use(sharedYard);
  },
});

export { expect } from "@playwright/test";
