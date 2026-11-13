// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useListen } from "@/components/agent/use-speech";

/**
 * Interrupting the assistant.
 *
 * It speaks every answer aloud, and some answers are long. Tapping the
 * microphone to cut it off is the ordinary way somebody says "yes, yes, next
 * thing" — and until this existed, that tap started a recording while the
 * device was still talking INTO it. The clip then contained the assistant's
 * own voice, which Whisper transcribed: at best noise, at worst its own words
 * coming back as though the owner had said them.
 *
 * What is tested is the ORDER: the speech is silenced before the microphone is
 * ever opened, not after.
 */

const events: string[] = [];

/** A button, because that is how the owner starts a recording — and because
 * reaching the hook any other way would mean mutating something during
 * render. */
function Harness() {
  const { start } = useListen(() => undefined);
  return (
    <button type="button" onClick={() => void start("en")}>
      speak
    </button>
  );
}

afterEach(cleanup);

beforeEach(() => {
  events.length = 0;

  Object.defineProperty(window, "speechSynthesis", {
    value: {
      speak: () => events.push("speak"),
      cancel: () => events.push("cancel"),
      getVoices: () => [],
    },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: async () => {
        events.push("getUserMedia");
        return { getTracks: () => [{ stop: () => events.push("trackStop") }] };
      },
    },
    writable: true,
    configurable: true,
  });

  class FakeRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: unknown = null;
    onstop: unknown = null;
    static isTypeSupported = () => true;
    start() {
      this.state = "recording";
      events.push("record");
    }
    stop() {
      this.state = "inactive";
    }
  }
  Object.defineProperty(window, "MediaRecorder", { value: FakeRecorder, writable: true, configurable: true });
});

describe("tapping the microphone while the assistant is still talking", () => {
  it("silences the device before the microphone is opened", async () => {
    render(<Harness />);
    screen.getByRole("button", { name: "speak" }).click();
    // Let the hook's async start() reach getUserMedia.
    await new Promise((r) => setTimeout(r, 50));

    // The order is the whole point.
    expect(events).toContain("cancel");
    expect(events).toContain("getUserMedia");
    expect(events.indexOf("cancel")).toBeLessThan(events.indexOf("getUserMedia"));
  });

  it("does not fail on a device with no speech synthesis at all", async () => {
    // Some WebViews have none. Silencing nothing must not stop a recording.
    Object.defineProperty(window, "speechSynthesis", { value: undefined, writable: true, configurable: true });
    render(<Harness />);
    screen.getByRole("button", { name: "speak" }).click();
    await new Promise((r) => setTimeout(r, 50));

    // Silencing nothing must not stop a recording.
    expect(events).toContain("getUserMedia");
  });
});
