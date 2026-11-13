import { askAssistant, expect, signIn, stubAgent, test, warmUp } from "./fixtures";

/**
 * A name said in Marathi, against a record typed in English.
 *
 * The owner speaks Marathi; their records say "Komatsu PC200" and "Banda
 * Patil" because that is how they were typed in. Marathi speech comes back in
 * Devanagari, so the name the model hands the browser is "कोमात्सु" and the
 * option on screen says "Komatsu PC200". Byte for byte they have nothing in
 * common, and the owner is told "I couldn't find that" about a machine sitting
 * in their own yard.
 *
 * `matching.ts` folds both sides through `script.ts` to fix it, and unit tests
 * cover the fold itself. This covers the part they cannot: the matching runs in
 * the BROWSER, against the real options the real page rendered, reached through
 * the real plan from the real registry. Only the model is stubbed, and only so
 * the Devanagari arrives reliably rather than when Whisper feels like it.
 *
 * It is also the guard for later: every Indic speech model worth moving to
 * outputs Devanagari, so this is the test that says the rest of the app is
 * ready for one.
 */

test.beforeEach(async ({ page, yard }) => {
  await signIn(page, yard);
  await warmUp(page, yard);
});

test("a machine named in Devanagari reaches the record typed in Latin", async ({ page }) => {
  // "कोमात्सु" is Komatsu, written as Marathi speech really comes back.
  const { results } = await stubAgent(page, {
    workflowId: "machine.status.view",
    fields: { machine: "कोमात्सु" },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "कोमात्सुची माहिती");

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
  const reported = results.at(-1)!;

  expect(reported.verified, "the Devanagari name never reached the machine").toBe(true);
  // It landed on the right machine, not merely on some machine.
  expect(reported.screenText ?? "").toMatch(/PC200/i);
});

test("an operator named in full in Devanagari reaches the right person", async ({ page }) => {
  // "बंदा पाटील" is Banda Patil, in full, which is unambiguous.
  const { results } = await stubAgent(page, {
    workflowId: "operator.salary.view",
    fields: { operator: "बंदा पाटील" },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "बंदा पाटील यांचा पगार");

  await expect.poll(() => results.length, { timeout: 40_000 }).toBeGreaterThan(0);
  const reported = results.at(-1)!;

  expect(reported.verified, "the Devanagari name never reached the operator").toBe(true);
  // The salary card is what gets read back, so it holds figures rather than a
  // name. That the right PERSON was reached is the page it landed on.
  await expect(page.getByRole("heading", { name: "Banda Patil" })).toBeVisible();
  expect(reported.screenText ?? "").toMatch(/salary|₹/i);
});

test("a Devanagari surname shared by two people is still a question, not a guess", async ({ page }) => {
  // This yard has a Banda Patil and a Sagar Patil, so "पाटील" means either.
  //
  // It is the better of the two tests. Matching BOTH of them is what proves
  // the fold worked — a surname that reached neither would look identical to
  // a surname that reached one. And the rule the whole matcher exists for has
  // to survive the new alphabet: two people is a question, never a choice,
  // whichever script the name arrived in.
  await stubAgent(page, {
    workflowId: "operator.salary.view",
    fields: { operator: "पाटील" },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "पाटील यांचा पगार");

  // Scoped to the panel: the operators list behind it carries these names too
  // (on its delete buttons), and an unscoped locator would match both.
  const panel = page.getByRole("region", { name: "Assistant" });
  // .first(): the panel both SAYS the question as a turn and draws it on the
  // card, which is deliberate — it is spoken aloud for someone who cannot read
  // the screen, and drawn for anyone who can.
  await expect(panel.getByText("Which one?").first()).toBeVisible({ timeout: 40_000 });
  await expect(panel.getByRole("button", { name: "Banda Patil", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sagar Patil", exact: true })).toBeVisible();
});
