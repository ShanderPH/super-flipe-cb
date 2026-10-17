// RetroPad SNES inputs in physical-position order, independent of Xbox lettering.
export const SNES_BUTTONS = [0, 2, 8, 9, 12, 13, 14, 15, 1, 3, 4, 5];
export const SNES_LABELS = [
  "B · baixo",
  "Y · esquerda",
  "Select",
  "Start",
  "Cima",
  "Baixo",
  "Esquerda",
  "Direita",
  "A · direita",
  "X · cima",
  "L",
  "R",
];
export const PROFILE_KEY = "superflip-snes-controls-v1";
const labels = [
  "BUTTON_1",
  "BUTTON_2",
  "BUTTON_3",
  "BUTTON_4",
  "LEFT_TOP_SHOULDER",
  "RIGHT_TOP_SHOULDER",
  "LEFT_BOTTOM_SHOULDER",
  "RIGHT_BOTTOM_SHOULDER",
  "SELECT",
  "START",
  "LEFT_STICK",
  "RIGHT_STICK",
  "DPAD_UP",
  "DPAD_DOWN",
  "DPAD_LEFT",
  "DPAD_RIGHT",
];
export function readProfile(storage, id) {
  try {
    const profile = JSON.parse(storage.getItem(PROFILE_KEY) || "null");
    if (
      profile?.id === id &&
      Array.isArray(profile.buttons) &&
      profile.buttons.length === 12 &&
      new Set(profile.buttons).size === 12 &&
      profile.buttons.every((n) => Number.isInteger(n) && n >= 0 && n < 64)
    )
      return profile.buttons;
  } catch {
    /* Storage optional. */
  }
  return null;
}
export function controls(buttons = SNES_BUTTONS) {
  const keys = [
    "x",
    "s",
    "v",
    "enter",
    "up arrow",
    "down arrow",
    "left arrow",
    "right arrow",
    "z",
    "a",
    "q",
    "e",
  ];
  const player = Object.fromEntries(
    buttons.map((button, input) => [
      input,
      { value: keys[input], value2: labels[button] || `GAMEPAD_${button}` },
    ]),
  );
  // Empty slots must exist: upstream loops over all four players. No indexes 12–29.
  return { 0: player, 1: {}, 2: {}, 3: {} };
}
export function getPads() {
  try {
    return Array.from(navigator.getGamepads?.() ?? []).filter(
      (p) => p?.connected,
    );
  } catch {
    return [];
  }
}
export function neutral(pads) {
  return pads.every(
    (p) =>
      !p.buttons.some((b) => b.pressed || b.value > 0.5) &&
      !p.axes.some((a) => Math.abs(a) > 0.6),
  );
}
export function inputGate() {
  let armed = false;
  const keys = new Set();
  return {
    block() {
      armed = false;
    },
    key(event) {
      if (event.type === "keyup") keys.delete(event.code || event.key);
      else keys.add(event.code || event.key);
    },
    resetKeys() {
      keys.clear();
      armed = false;
    },
    update(pads) {
      if (!armed && keys.size === 0 && neutral(pads)) armed = true;
    },
    get armed() {
      return armed;
    },
  };
}
