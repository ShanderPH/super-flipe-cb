import { describe, expect, it } from "vitest";
import { isBack, nearest } from "./navigation";
describe("spatial navigation", () => {
  const center = { x: 100, y: 100, width: 80, height: 60 };
  const cards = [
    { ...center, x: 200 },
    { ...center, y: 200 },
    { ...center, x: 0 },
    { ...center, y: 0 },
  ];
  it("finds the nearest item in each direction without wrapping", () => {
    expect(nearest(center, cards, "right")).toBe(0);
    expect(nearest(center, cards, "down")).toBe(1);
    expect(nearest(center, cards, "left")).toBe(2);
    expect(nearest(center, cards, "up")).toBe(3);
    expect(nearest(center, [cards[0]], "left")).toBe(-1);
  });
  it("prefers alignment to a nearby diagonal candidate", () => {
    expect(
      nearest(center, [{ ...center, x: 170, y: 190 }, cards[0]], "right"),
    ).toBe(1);
  });
  it("recognizes webOS Back", () => {
    expect(isBack({ key: "Unidentified", keyCode: 461 } as KeyboardEvent)).toBe(
      true,
    );
    expect(isBack({ key: "a", keyCode: 65 } as KeyboardEvent)).toBe(false);
  });
});
