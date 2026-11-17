import { describe, expect, it } from "vitest";
import { workTotalHours } from "@/components/work-total-hours";
import { calcHoursFromClock, calcHoursFromMeter } from "@/lib/utils/hours";

/**
 * The total shown under the readings while a work entry is being filled in.
 *
 * The one rule that matters: it must be the SAME number the server will store,
 * so it delegates to calcHoursFromMeter / calcHoursFromClock rather than
 * carrying a second formula. The tests below pin that, and pin that a
 * half-filled form shows nothing instead of a wrong or alarming figure.
 */
describe("work entry running total", () => {
  describe("hour meter", () => {
    it("end minus start", () => {
      expect(workTotalHours({ mode: "meter", startHourMeter: 1200, endHourMeter: 1208.5 })).toBe(8.5);
    });

    it("agrees with the server's own helper", () => {
      expect(workTotalHours({ mode: "meter", startHourMeter: "1200.4", endHourMeter: "1209.1" })).toBe(
        calcHoursFromMeter(1200.4, 1209.1),
      );
    });

    it("accepts the strings an <input> actually gives", () => {
      expect(workTotalHours({ mode: "meter", startHourMeter: "100", endHourMeter: "104.25" })).toBe(4.25);
    });

    it("shows nothing until both readings are there", () => {
      expect(workTotalHours({ mode: "meter", startHourMeter: 1200, endHourMeter: "" })).toBeNull();
      expect(workTotalHours({ mode: "meter", startHourMeter: "", endHourMeter: 1208 })).toBeNull();
      expect(workTotalHours({ mode: "meter" })).toBeNull();
    });

    it("shows nothing when the end reading is not above the start", () => {
      // The server rejects this (endAfterStart); the form must not meanwhile
      // display "0 hrs" or a negative total as if it were a real answer.
      expect(workTotalHours({ mode: "meter", startHourMeter: 1208, endHourMeter: 1200 })).toBeNull();
      expect(workTotalHours({ mode: "meter", startHourMeter: 1200, endHourMeter: 1200 })).toBeNull();
    });

    it("ignores a non-numeric reading rather than showing NaN", () => {
      expect(workTotalHours({ mode: "meter", startHourMeter: "abc", endHourMeter: 1208 })).toBeNull();
    });
  });

  describe("start / stop time", () => {
    it("stop minus start minus break", () => {
      expect(workTotalHours({ mode: "time", startTime: "08:00", stopTime: "17:30", breakMinutes: 30 })).toBe(9);
    });

    it("agrees with the server's own helper", () => {
      expect(workTotalHours({ mode: "time", startTime: "08:15", stopTime: "16:45", breakMinutes: "45" })).toBe(
        calcHoursFromClock("08:15", "16:45", 45),
      );
    });

    it("a missing break counts as none", () => {
      expect(workTotalHours({ mode: "time", startTime: "09:00", stopTime: "12:00" })).toBe(3);
      expect(workTotalHours({ mode: "time", startTime: "09:00", stopTime: "12:00", breakMinutes: "" })).toBe(3);
    });

    it("handles a shift that runs past midnight", () => {
      expect(workTotalHours({ mode: "time", startTime: "22:00", stopTime: "02:00" })).toBe(4);
    });

    it("shows nothing until both times are there", () => {
      expect(workTotalHours({ mode: "time", startTime: "08:00", stopTime: "" })).toBeNull();
      expect(workTotalHours({ mode: "time" })).toBeNull();
    });

    it("shows nothing when the break swallows the whole shift", () => {
      expect(workTotalHours({ mode: "time", startTime: "09:00", stopTime: "10:00", breakMinutes: 60 })).toBeNull();
      expect(workTotalHours({ mode: "time", startTime: "09:00", stopTime: "10:00", breakMinutes: 120 })).toBeNull();
    });
  });

  it("reads only the fields belonging to the chosen mode", () => {
    // Both halves of the form are filled in but only one is the one in use —
    // the total must come from the active mode, not from whichever is set.
    const both = {
      startHourMeter: 1200,
      endHourMeter: 1210,
      startTime: "08:00",
      stopTime: "12:00",
      breakMinutes: 0,
    };
    expect(workTotalHours({ mode: "meter", ...both })).toBe(10);
    expect(workTotalHours({ mode: "time", ...both })).toBe(4);
  });
});
