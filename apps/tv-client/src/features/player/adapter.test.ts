import { describe, expect, it, vi } from "vitest";
import { validMessage } from "./adapter";
describe("iframe trust boundary", () => {
  it("requires matching origin, source, game and message shape", () => {
    vi.stubGlobal("location", { origin: "http://localhost:8787" });
    const frame = {} as Window;
    const event = {
      origin: location.origin,
      source: frame,
      data: { type: "started", requestId: "1", gameId: "test", payload: {} },
    } as MessageEvent;
    expect(validMessage(event, frame, "test")).toBe(true);
    expect(
      validMessage(
        { ...event, origin: "https://evil.test" } as MessageEvent,
        frame,
        "test",
      ),
    ).toBe(false);
    expect(validMessage(event, {} as Window, "test")).toBe(false);
    expect(validMessage(event, null, "test")).toBe(false);
    expect(validMessage(event, frame, "other")).toBe(false);
    expect(
      validMessage(
        { ...event, data: { ...event.data, type: "unknown" } } as MessageEvent,
        frame,
        "test",
      ),
    ).toBe(false);
    vi.unstubAllGlobals();
  });
});
