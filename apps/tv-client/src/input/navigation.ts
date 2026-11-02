import { readProfile } from "../../public/player/controls.js";
export type Direction = "left" | "right" | "up" | "down";
export function connectedGamepads(): Gamepad[] {
  try {
    return [...(navigator.getGamepads?.() ?? [])].filter(
      (pad): pad is Gamepad => !!pad?.connected,
    );
  } catch {
    return [];
  }
}
export type Rect = { x: number; y: number; width: number; height: number };
export function nearest(
  rect: Rect,
  others: Rect[],
  direction: Direction,
): number {
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const cx = rect.x + rect.width / 2,
    cy = rect.y + rect.height / 2;
  let best = -1,
    score = Infinity;
  others.forEach((other, index) => {
    const dx = other.x + other.width / 2 - cx,
      dy = other.y + other.height / 2 - cy;
    const primary = (horizontal ? dx : dy) * sign;
    const cross = Math.abs(horizontal ? dy : dx);
    if (primary > 1 && primary + cross * 3 < score) {
      score = primary + cross * 3;
      best = index;
    }
  });
  return best;
}
export function navigate(direction: Direction) {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  const items = [
    ...scope.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input, a[href], select",
    ),
  ].filter((el) => el.getClientRects().length > 0);
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    items[0]?.focus();
    return;
  }
  const next = nearest(
    current.getBoundingClientRect(),
    items.map((el) => el.getBoundingClientRect()),
    direction,
  );
  if (next !== -1) {
    items[next].focus();
    items[next].scrollIntoView({ block: "nearest" });
  }
}
export function isBack(event: KeyboardEvent) {
  return (
    event.key === "Escape" ||
    event.key === "BrowserBack" ||
    event.keyCode === 461
  );
}
export function startInput(
  onBack: () => void,
  isPlaying: () => boolean,
): () => void {
  const keydown = (e: KeyboardEvent) => {
    if (e.repeat && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      return;
    }
    if (isBack(e)) {
      e.preventDefault();
      if (!e.repeat) onBack();
      return;
    }
    if (e.key === "Tab") {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        const buttons = [
          ...dialog.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled), input:not([hidden]), select",
          ),
        ];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        e.preventDefault();
        buttons[
          (index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
        ]?.focus();
      }
    }
    if (
      isPlaying() ||
      e.target instanceof HTMLSelectElement ||
      (e.target instanceof HTMLInputElement &&
        ["ArrowLeft", "ArrowRight"].includes(e.key))
    )
      return;
    const directions: Record<string, Direction> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };
    if (directions[e.key]) {
      e.preventDefault();
      navigate(directions[e.key]);
    }
  };
  document.addEventListener("keydown", keydown);
  let frame = 0,
    last = "",
    nextRepeat = 0;
  let lastPlaying = isPlaying(),
    armed = false,
    lastDevice = "",
    wasCalibrating = false;
  let calibrated: number[] | null = null;
  const poll = (time: number) => {
    const playing = isPlaying();
    // Gameplay belongs to the iframe. Avoid a second gamepad read and DOM scan.
    if (playing) {
      lastPlaying = true;
      armed = false;
      frame = requestAnimationFrame(poll);
      return;
    }
    const pad = connectedGamepads()[0];
    const device = pad ? `${pad.id}:${pad.index}` : "";
    const calibrating = !!document.querySelector(
      '[data-input-calibration="true"]',
    );
    if (device !== lastDevice || wasCalibrating) {
      try {
        calibrated = pad ? readProfile(localStorage, pad.id) : null;
      } catch {
        calibrated = null;
      }
    }
    if (
      playing !== lastPlaying ||
      device !== lastDevice ||
      wasCalibrating ||
      calibrating
    ) {
      armed = false;
      last = "";
    }
    lastPlaying = playing;
    lastDevice = device;
    wasCalibrating = calibrating;
    const neutral =
      !pad ||
      (!pad.buttons.some((b) => b.pressed || b.value > 0.5) &&
        !pad.axes.some((a) => Math.abs(a) > 0.6));
    if (neutral) armed = true;
    // The iframe owns gameplay, including Select+Start. UI never consumes it.
    if (
      playing ||
      calibrating ||
      !armed ||
      (pad && pad.mapping !== "standard" && !calibrated)
    ) {
      frame = requestAnimationFrame(poll);
      return;
    }
    const pressed = (i: number) => !!pad?.buttons[i]?.pressed;
    const action = pressed(calibrated?.[8] ?? 1)
      ? "back"
      : pressed(calibrated?.[0] ?? 0)
        ? "ok"
        : pressed(calibrated?.[4] ?? 12) || (pad?.axes[1] ?? 0) < -0.6
          ? "up"
          : pressed(calibrated?.[5] ?? 13) || (pad?.axes[1] ?? 0) > 0.6
            ? "down"
            : pressed(calibrated?.[6] ?? 14) || (pad?.axes[0] ?? 0) < -0.6
              ? "left"
              : pressed(calibrated?.[7] ?? 15) || (pad?.axes[0] ?? 0) > 0.6
                ? "right"
                : "";
    if (
      action &&
      (action !== last ||
        (time > nextRepeat && !["ok", "back"].includes(action)))
    ) {
      if (action === "back") {
        armed = false;
        onBack();
      } else if (action === "ok") {
        armed = false;
        const active = document.activeElement as HTMLElement | null;
        const scope = document.querySelector('[role="dialog"]');
        if (
          (!scope || scope.contains(active)) &&
          active?.matches("button:not(:disabled), a[href]")
        )
          active.click();
      } else navigate(action as Direction);
      nextRepeat = time + (action === last ? 160 : 420);
    }
    last = action;
    frame = requestAnimationFrame(poll);
  };
  frame = requestAnimationFrame(poll);
  return () => {
    document.removeEventListener("keydown", keydown);
    cancelAnimationFrame(frame);
  };
}
