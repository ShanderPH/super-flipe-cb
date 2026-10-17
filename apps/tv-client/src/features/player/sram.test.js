import { describe, it, expect } from "vitest";
import { SaveSync, validateSram } from "../../../public/player/sram.js";
const response = (status, etag = '"1"') => ({
  ok: status === 200,
  status,
  headers: new Map([["etag", etag]]),
});
describe("bounded SRAM synchronization", () => {
  it("copies a snapshot, permits one writer and skips unchanged SRAM", async () => {
    let complete,
      calls = 0,
      uploaded;
    const sync = new SaveSync(
      (bytes) => {
        calls++;
        uploaded = bytes;
        return new Promise((r) => {
          complete = r;
        });
      },
      () => {},
    );
    const bytes = new Uint8Array([1, 2]);
    const pending = sync.save(bytes);
    bytes[0] = 9;
    expect(uploaded[0]).toBe(1);
    await expect(sync.save(bytes, true)).rejects.toThrow("andamento");
    complete(response(200));
    await pending;
    await sync.save(new Uint8Array([1, 2]));
    expect(calls).toBe(1);
    expect(sync.etag).toBe('"1"');
  });
  it("freezes on conflict and never silently takes the new ETag", async () => {
    const states = [];
    const sync = new SaveSync(
      async () => response(409),
      (state) => states.push(state),
    );
    await expect(sync.save(new Uint8Array([1]))).rejects.toThrow("Conflito");
    await sync.save(new Uint8Array([2]));
    expect(states).toEqual(["pending", "conflict"]);
    expect(sync.etag).toBe('"0"');
  });
  it("stops automatic retries after three errors; manual recovery is possible", async () => {
    let calls = 0;
    const sync = new SaveSync(
      async () => {
        calls++;
        return response(calls <= 3 ? 500 : 200);
      },
      () => {},
    );
    for (let i = 0; i < 3; i++)
      await expect(sync.save(new Uint8Array([1]))).rejects.toThrow();
    await sync.save(new Uint8Array([2]));
    expect(calls).toBe(3);
    await sync.save(new Uint8Array([2]), true);
    expect(sync.failures).toBe(0);
  });
  it("validates SRAM against this core/game size, not a universal SNES size", () => {
    expect(() => validateSram(new Uint8Array(8), 8)).not.toThrow();
    expect(() => validateSram(new Uint8Array(9), 8)).toThrow();
    expect(() => validateSram(new Uint8Array(8), 0)).toThrow();
  });
});
