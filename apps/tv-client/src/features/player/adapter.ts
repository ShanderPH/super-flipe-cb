export type PlayerEvent = {
  type: string;
  requestId: string;
  gameId: string;
  payload: Record<string, unknown>;
};
const events = new Set([
  "ready",
  "started",
  "paused",
  "resumed",
  "saved",
  "restored",
  "error",
  "menu",
  "exported",
  "configured",
  "progress",
]);
export function validMessage(
  event: MessageEvent,
  source: Window | null,
  gameId: string,
): event is MessageEvent<PlayerEvent> {
  const data: unknown = event.data;
  if (
    event.origin !== location.origin ||
    !source ||
    event.source !== source ||
    !data ||
    typeof data !== "object"
  )
    return false;
  const d = data as Partial<PlayerEvent>;
  return (
    typeof d.type === "string" &&
    events.has(d.type) &&
    d.gameId === gameId &&
    typeof d.requestId === "string" &&
    !!d.payload &&
    typeof d.payload === "object"
  );
}
export function command(
  frame: HTMLIFrameElement | null,
  gameId: string,
  type: string,
  payload = {},
) {
  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  frame?.contentWindow?.postMessage(
    { type, requestId, gameId, payload },
    location.origin,
  );
  return requestId;
}
