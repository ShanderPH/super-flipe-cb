import createCore from "/experimental-core/core.js";
import { distribution, unavailable } from "/player/runtime-probe.js";
const enabled = new URLSearchParams(location.search).get("diagnostics") === "1";
let context,
  sink,
  module,
  raf,
  frames = 0,
  stopped = false,
  invalid = false;
let enqueued = 0,
  audio = { consumed: 0 },
  costs = [],
  rafIntervals = [],
  lastRaf;
let videoMs = 0,
  audioSubmitMs = 0,
  sampleDrops = 0,
  frameBounds;
const canvas = document.getElementById("canvas");
const status = document.getElementById("status");
function stop() {
  stopped = true;
  cancelAnimationFrame(raf);
  sink?.disconnect();
  void context?.close();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    invalid = true;
    stop();
  }
});
window.addEventListener("pagehide", stop, { once: true });
document.getElementById("start").onclick = async () => {
  try {
    if (!isSecureContext || typeof AudioWorkletNode === "undefined")
      throw Error("AudioWorklet requires a trustworthy origin");
    const config = await (await fetch("/lab/config")).json();
    if (config.realSaves !== false || !config.gameId)
      throw Error("Isolated ROM required");
    const build = await (await fetch("/experimental-core/build.json")).json();
    module = await createCore();
    const bytes = new Uint8Array(
      await (await fetch(`/api/games/${config.gameId}/rom`)).arrayBuffer(),
    );
    const pointer = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, pointer);
    // libretro fullpath=false core copies the ROM during load.
    const loaded = module._lab_load(pointer, bytes.length);
    module._free(pointer);
    if (!loaded) throw Error("Core rejected ROM");
    module._lab_profile(enabled ? 1 : 0);
    const fps = module._lab_fps(),
      rate = module._lab_rate();
    context = new AudioContext();
    await context.audioWorklet.addModule("/lab/assets/audio-sink.js");
    sink = new AudioWorkletNode(context, "superflip-lab-audio", {
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { inputRate: rate },
    });
    sink.port.onmessage = ({ data }) => {
      audio = data;
    };
    sink.connect(context.destination);
    await context.resume();
    if (context.state !== "running") throw Error("Audio output did not start");
    const paint = canvas.getContext("2d");
    let image, imageView;
    const tick = (now) => {
      if (stopped) return;
      if (enabled && lastRaf !== undefined && rafIntervals.length < 20000)
        rafIntervals.push(now - lastRaf);
      lastRaf = now;
      const deficit = rate * 0.09 - (enqueued - audio.consumed);
      const count = Math.max(0, Math.min(5, Math.ceil(deficit / (rate / fps))));
      for (let i = 0; i < count; i++) {
        module._lab_run();
        frames++;
        if (module._lab_overflow()) {
          invalid = true;
          stop();
          status.textContent = "Core output exceeds lab bounds";
          return;
        }
        if (enabled) {
          if (costs.length < 20000)
            costs.push([0, 1, 2, 3].map((n) => module._lab_metric(n)));
          else sampleDrops++;
        }
        const at = module._lab_audio() >> 1,
          length = module._lab_samples();
        const start = enabled ? performance.now() : 0;
        const chunk = module.HEAP16.slice(at, at + length);
        sink.port.postMessage(chunk, [chunk.buffer]);
        enqueued += length / 2;
        if (enabled) audioSubmitMs += performance.now() - start;
        // Preserve every core frame; only the final framebuffer is painted per display tick.
      }
      if (count) {
        const start = enabled ? performance.now() : 0;
        const w = module._lab_width(),
          h = module._lab_height(),
          ptr = module._lab_pixels();
        if (w && h) {
          if (
            !image ||
            image.width !== w ||
            image.height !== h ||
            imageView.buffer !== module.HEAPU8.buffer
          ) {
            canvas.width = w;
            canvas.height = h;
            imageView = new Uint8ClampedArray(
              module.HEAPU8.buffer,
              ptr,
              w * h * 4,
            );
            image = new ImageData(imageView, w, h);
          }
          paint.putImageData(image, 0, 0);
        }
        if (enabled) videoMs += performance.now() - start;
      }
      raf = requestAnimationFrame(tick);
    };
    window.superFlipBenchmark = Object.freeze({
      counter: () => ({ frames, now: performance.now() }),
      report: () => {
        const raw = costs;
        costs = [];
        const intervals = rafIntervals;
        rafIntervals = [];
        const start = frameBounds ?? 0;
        frameBounds = frames;
        const result = {
          engine: "direct-libretro-lab",
          build,
          nominalFps: fps,
          frames,
          frameRange: [start, frames],
          paused: stopped,
          interrupted: invalid,
          audio: {
            ...audio,
            inputSampleRate: rate,
            outputSampleRate: context.sampleRate,
            state: context.state,
          },
          retroRunInclusiveMs: distribution(raw.map((x) => x[0])),
          videoConversionMs: distribution(raw.map((x) => x[1])),
          audioCallbackCopyMs: distribution(raw.map((x) => x[2])),
          retroRunWithoutCallbacksMs: distribution(raw.map((x) => x[3])),
          rawComponentMs: raw,
          rawRafMs: intervals,
          rafMs: distribution(intervals),
          videoCanvasSubmissionCpuMs: videoMs,
          audioSubmissionCpuMs: audioSubmitMs,
          sampleDrops,
          wasmHeapBytes: module.HEAPU8.byteLength,
          presentedGameFrames: unavailable(
            "Canvas presentation has no panel feedback",
          ),
          hardwareValidated: false,
        };
        videoMs = audioSubmitMs = sampleDrops = 0;
        sink.port.postMessage({ reset: true });
        return result;
      },
    });
    document.getElementById("start").hidden = true;
    status.textContent =
      "Core experimental em execução. Nenhum save é lido ou gravado.";
    raf = requestAnimationFrame(tick);
  } catch (error) {
    stop();
    window.benchmarkError = status.textContent = String(error.message || error);
  }
};
