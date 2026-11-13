import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The names put in front of the microphone. Two things matter here: that they
 * are this business's names and nobody else's, and that machines keep their
 * place in a budget too small to hold everything.
 */

const findMany = vi.hoisted(() => ({
  excavator: vi.fn(),
  operator: vi.fn(),
  site: vi.fn(),
  customer: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    excavator: { findMany: findMany.excavator },
    operator: { findMany: findMany.operator },
    site: { findMany: findMany.site },
    customer: { findMany: findMany.customer },
  },
}));

const { speechPrompt, __testing } = await import("@/lib/agent/vocabulary");

beforeEach(() => {
  for (const fn of Object.values(findMany)) fn.mockReset();
  __testing.cache.clear();
  findMany.excavator.mockResolvedValue([
    { name: "Komatsu PC200", machineNumber: "PC200-2", brand: "Komatsu", model: "PC200" },
  ]);
  findMany.operator.mockResolvedValue([{ name: "Banda Patil" }]);
  findMany.site.mockResolvedValue([{ name: "Wakad Plot 14" }]);
  findMany.customer.mockResolvedValue([{ name: "Shree Constructions" }]);
});

describe("the spoken vocabulary", () => {
  it("names the owner's own machines, people, sites and customers", async () => {
    const prompt = await speechPrompt("b1", "en");
    expect(prompt).toContain("Komatsu PC200");
    expect(prompt).toContain("PC200-2");
    expect(prompt).toContain("Banda Patil");
    expect(prompt).toContain("Wakad Plot 14");
    expect(prompt).toContain("Shree Constructions");
    expect(prompt).toContain("hour meter");
  });

  it("asks only for this business's records", async () => {
    await speechPrompt("b1", "en");
    for (const fn of Object.values(findMany)) {
      expect(fn.mock.calls[0]![0].where.businessId).toBe("b1");
    }
  });

  it("leaves archived machines and finished sites out", async () => {
    await speechPrompt("b1", "en");
    expect(findMany.excavator.mock.calls[0]![0].where.isArchived).toBe(false);
    expect(findMany.site.mock.calls[0]![0].where.status).toBe("ACTIVE");
  });

  it("keeps the names in the script they are stored in, whatever the panel is set to", async () => {
    // A Hindi transcript that writes "जेसीबी" matches no record called "JCB",
    // so the Latin spelling has to be what Whisper is primed with.
    const prompt = await speechPrompt("b1", "hi");
    expect(prompt).toContain("Komatsu PC200");
    expect(prompt).toContain("आवर मीटर"); // the trade words do follow the language
  });

  it("does not query again for every sentence", async () => {
    await speechPrompt("b1", "en");
    await speechPrompt("b1", "hi");
    expect(findMany.operator).toHaveBeenCalledTimes(1);
  });

  it("keeps one business's names away from another's microphone", async () => {
    await speechPrompt("b1", "en");
    findMany.operator.mockResolvedValue([{ name: "Someone Elses Driver" }]);
    const other = await speechPrompt("b2", "en");
    expect(other).toContain("Someone Elses Driver");
    expect(other).not.toContain("Banda Patil");
  });

  it("still lets someone speak when the database is down", async () => {
    __testing.cache.clear();
    findMany.operator.mockRejectedValue(new Error("connection refused"));
    const prompt = await speechPrompt("b1", "en");
    // Degraded, not silent: the trade words alone still beat no prompt at all.
    expect(prompt).toContain("hour meter");
  });
});

describe("the prompt budget", () => {
  it("stops at the budget rather than sending a wall of names", () => {
    const many = Array.from({ length: 300 }, (_, i) => `Operator Number ${i}`);
    const packed = __testing.pack(many);
    expect(packed.length).toBeLessThanOrEqual(__testing.MAX_NAME_CHARS);
  });

  it("spends the budget on machines before customers", async () => {
    findMany.excavator.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        name: `Excavator Machine ${i}`,
        machineNumber: null,
        brand: null,
        model: null,
      })),
    );
    findMany.customer.mockResolvedValue([{ name: "Zzz Last Customer" }]);
    const prompt = await speechPrompt("b1", "en");
    expect(prompt).toContain("Excavator Machine 0");
    expect(prompt).not.toContain("Zzz Last Customer");
  });

  it("drops fragments too short to teach it anything, and repeats", () => {
    expect(__testing.pack(["JCB", "jcb", "A", "2", null, "  ", "Patil"])).toBe("JCB, Patil");
  });
});
