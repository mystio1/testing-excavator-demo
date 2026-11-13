import { askAssistant, expect, signIn, stubAgent, test, warmUp } from "./fixtures";

/**
 * The assistant without a mouse, and without sight.
 *
 * This overlaps the primary user more than it looks: the owner this is built
 * for may not read the screen at all, so "can a screen reader follow it" and
 * "does a non-reader know what they are approving" are close to the same
 * question. The worst thing found here was not an ARIA attribute — it was that
 * the approval card drew the figures on screen and never said them, so an
 * owner who cannot read was asked to approve something nobody told them.
 */

test.beforeEach(async ({ page, yard }) => {
  await signIn(page, yard);
  await warmUp(page, yard);
});

test("opening the panel moves focus into it, and Escape closes it back", async ({ page }) => {
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Assistant" }).click();
  const panel = page.getByRole("region", { name: "Assistant" });
  await expect(panel).toBeVisible();

  // Focus is inside the panel, not left behind on the page.
  await expect
    .poll(async () => panel.evaluate((node) => node.contains(document.activeElement)), { timeout: 5000 })
    .toBe(true);

  // Escape is the key everybody tries.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // And focus came back to where it started, rather than being dropped.
  await expect
    .poll(async () =>
      page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    )
    .toBe("Assistant");
});

test("every control can be reached and used from the keyboard alone", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Assistant" }).click();

  // Typing and sending, with no pointer at all.
  const { results } = await stubAgent(page, { say: "Theek hai." });
  await page.getByPlaceholder("Ask or tell me something").focus();
  await page.keyboard.type("kitne customers hai?");
  await page.keyboard.press("Enter");

  const panel = page.getByRole("region", { name: "Assistant" });
  await expect(panel.getByText("Theek hai.")).toBeVisible({ timeout: 20_000 });
  expect(results.length).toBe(0); // a reply needs no plan and no result
});

test("replies, errors and working state are announced, not just drawn", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Assistant" }).click();
  await stubAgent(page, { say: "Aapke do customer hai." });

  const panel = page.getByRole("region", { name: "Assistant" });
  // The transcript is a live region, so a screen reader follows the
  // conversation instead of silently missing it.
  await expect(panel.locator('[aria-live="polite"]')).toHaveCount(1);
  // And a status region, so waiting is distinguishable from broken.
  await expect(panel.getByRole("status")).toHaveCount(1);

  // Typed directly rather than through askAssistant(), which opens the panel
  // itself — and the launcher is hidden once it is open, so clicking it waits
  // forever.
  await page.getByPlaceholder("Ask or tell me something").fill("kitne customers hai?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("Aapke do customer hai.")).toBeVisible({ timeout: 20_000 });
});

test("the values being approved are spoken, not only shown", async ({ page, yard }) => {
  // The one that matters most. The approval card used to say "Shall I save
  // this?" with the figures drawn beside it — so an owner who cannot read the
  // screen was asked to approve something nobody had told them, and the whole
  // safety model rests on the approval being against exact values.
  const spoken: string[] = [];
  await page.addInitScript(() => {
    // Capture what the app asks the device to say.
    const said: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = said;
    class FakeUtterance {
      text: string;
      lang = "";
      rate = 1;
      voice: unknown = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, writable: true });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (u: { text: string }) => said.push(u.text),
        cancel: () => undefined,
        getVoices: () => [],
      },
      writable: true,
    });
  });

  await stubAgent(page, {
    workflowId: "operator.transaction.add",
    needsConfirm: true,
    fields: { operator: "Banda Patil", amount: 2000, category: yard.categoryName, date: "2026-10-23" },
  });

  await page.goto("/dashboard");
  await askAssistant(page, "Patil ko 2000 advance diya");
  await expect(page.getByRole("button", { name: /yes, save it/i })).toBeVisible({ timeout: 20_000 });

  spoken.push(...(await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)));
  const everything = spoken.join(" | ");

  // The figure itself was said out loud, not merely rendered.
  expect(everything, `spoken: ${everything}`).toContain("2000");
  expect(everything).toContain("Patil");
  // And read as words, not as the separator character.
  expect(everything).not.toContain("·");
});
