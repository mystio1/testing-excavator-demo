import { describe, expect, it } from "vitest";
import { simpleDieselAverage } from "@/lib/services/siteAnalysis";

/**
 * The owner's spec: Site Analysis must show a diesel average worked out from
 * the two numbers that are always recorded — hours worked and diesel taken —
 * so a machine is never left showing nothing just because the litres left in
 * the tank were not entered on the daily entry.
 *
 * Both directions are shown, because the owner asked for the sum as
 * "total hours / taken diesel" while the rate is normally quoted the other way
 * up:
 *   litresPerHour = diesel / hours
 *   hoursPerLitre = hours / diesel
 */
describe("simple diesel average", () => {
  it("100 hrs on 500 L is 5 L/hr, and 0.2 hrs per litre", () => {
    expect(simpleDieselAverage(100, 500)).toEqual({ litresPerHour: 5, hoursPerLitre: 0.2 });
  });

  it("works with no closing tank reading involved at all — that is the point", () => {
    // 10 hrs, 60 L taken: 6 L/hr. dieselEntryAverage would return null here
    // because there is no closing balance to measure against.
    expect(simpleDieselAverage(10, 60).litresPerHour).toBe(6);
  });

  it("rounds to 2 dp rather than printing a recurring decimal", () => {
    // 7 / 3 = 2.333...
    expect(simpleDieselAverage(3, 7).litresPerHour).toBe(2.33);
    expect(simpleDieselAverage(7, 3).litresPerHour).toBe(0.43);
  });

  it("no hours means no average, not a division by zero", () => {
    expect(simpleDieselAverage(0, 500)).toEqual({ litresPerHour: null, hoursPerLitre: null });
  });

  it("no diesel means no average, not 0 L/hr", () => {
    // A machine that ran 40 hours on diesel nobody recorded has an unknown
    // rate, not a rate of zero.
    expect(simpleDieselAverage(40, 0)).toEqual({ litresPerHour: null, hoursPerLitre: null });
  });

  it("the two figures are reciprocals of the same sum", () => {
    const { litresPerHour, hoursPerLitre } = simpleDieselAverage(80, 400);
    expect(litresPerHour).toBe(5);
    expect(hoursPerLitre).toBe(0.2);
    expect(litresPerHour! * hoursPerLitre!).toBeCloseTo(1, 10);
  });
});
