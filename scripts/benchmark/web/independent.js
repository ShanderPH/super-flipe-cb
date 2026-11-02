import { load } from "/independent/snes9x/snes9x.sdk.js";
import { distribution, unavailable } from "/player/runtime-probe.js";
const params = new URLSearchParams(location.search);
const enabled = params.get("diagnostics") === "1";
let frames = 0,
  costs = [],
  lastFps = null,
  module,
  engine;
document.getElementById("start").onclick = async () => {
  const status = document.getElementById("status");
  try {
    if (!window.isSecureContext || typeof AudioWorkletNode === "undefined")
      throw new Error(
        "Esta alternativa exige AudioWorklet e contexto seguro; HTTP LAN não garante suporte.",
      );
    const config = await (await fetch("/lab/config")).json();
    const rom = await (
      await fetch(`/api/games/${config.gameId}/rom`)
    ).arrayBuffer();
    let wrappedFactory;
    Object.defineProperty(window, "createSnes9xModule", {
      configurable: true,
      get: () => wrappedFactory,
      set: (factory) => {
        wrappedFactory = async (options) => {
          module = await factory(options);
          const exec = module._s9xwasm_exec;
          module._s9xwasm_exec = (...args) => {
            if (!enabled) {
              frames++;
              return exec(...args);
            }
            const start = performance.now();
            try {
              return exec(...args);
            } finally {
              frames++;
              if (costs.length < 20000) costs.push(performance.now() - start);
            }
          };
          return module;
        };
      },
    });
    engine = await load({
      canvasEl: document.getElementById("canvas"),
      assets: { rom },
      persist: null,
      storageNamespace: "superflip-lab-only",
      options: { escMenu: false, gamepads: false, region: "auto", volume: 1 },
      onEvent(e) {
        if (e.type === "frame") lastFps = e.fps;
      },
    });
    window.superFlipBenchmark = Object.freeze({
      counter: () => ({ frames, now: performance.now() }),
      report: () => {
        const raw = costs;
        costs = [];
        return {
          engine: "wasm-gaming/snes9x-wasm",
          version: "0.1.1",
          frames,
          lastFps,
          nominalFps: module._s9xwasm_framerate_micro() / 1e6,
          wasmHeapBytes: module.HEAPU8.byteLength,
          coreAndShimMs: distribution(raw),
          rawCoreAndShimMs: raw,
          presentedGameFrames: unavailable(
            "2D canvas has no presentation feedback",
          ),
          hardwareValidated: false,
        };
      },
    });
    document.getElementById("start").hidden = true;
    status.textContent = "Comparação em execução; boot sem input, sem saves.";
    engine.start();
  } catch (error) {
    status.textContent = String(error.message || error);
    window.benchmarkError = status.textContent;
  }
};
window.addEventListener("pagehide", () => engine?.destroy());
