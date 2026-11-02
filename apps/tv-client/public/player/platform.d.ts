export function screenProtection(): {
  setPlaying(value: boolean): void;
  report(): object;
  stop(): void;
};
export function deviceInfo(): Promise<object>;
