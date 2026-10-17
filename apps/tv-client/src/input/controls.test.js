import { describe, it, expect } from "vitest";
import {
  controls,
  inputGate,
  readProfile,
} from "../../public/player/controls.js";
describe("gameplay profile and neutral barrier", () => {
  it("maps physical positions and excludes every unsupported hotkey", () => {
    const profile = controls();
    expect(profile[0][0].value2).toBe("BUTTON_1");
    expect(profile[0][8].value2).toBe("BUTTON_2");
    expect(Object.keys(profile[0])).toHaveLength(12);
    expect(profile[0][24]).toBeUndefined();
    expect(profile[1]).toEqual({});
  });
  it("requires all held keys, buttons and axes to return to neutral", () => {
    const gate = inputGate();
    gate.update([]);
    expect(gate.armed).toBe(true);
    gate.block();
    gate.update([{ buttons: [{ pressed: true }], axes: [0] }]);
    expect(gate.armed).toBe(false);
    gate.key({ type: "keydown", code: "Enter" });
    gate.update([]);
    expect(gate.armed).toBe(false);
    gate.key({ type: "keyup", code: "Enter" });
    gate.update([{ buttons: [], axes: [0.8] }]);
    expect(gate.armed).toBe(false);
    gate.update([]);
    expect(gate.armed).toBe(true);
  });
  it("rejects corrupt, duplicate or different-device calibration", () => {
    const storage = {
      getItem: () => JSON.stringify({ id: "pad", buttons: Array(12).fill(0) }),
    };
    expect(readProfile(storage, "pad")).toBeNull();
  });
});
