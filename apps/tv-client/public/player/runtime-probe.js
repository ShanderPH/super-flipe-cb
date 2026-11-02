// Optional measurements at existing Emscripten/GL/Web Audio boundaries.
// WASM bytes, the scheduler, emulated clocks and save formats are unchanged.
export function distribution(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const at = (q) => ordered[Math.ceil(q * ordered.length) - 1];
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  return {
    count: values.length,
    mean,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: ordered[ordered.length - 1],
    jitterMs: Math.sqrt(
      values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length,
    ),
  };
}
export const unavailable = (reason) => ({ status: "unavailable", reason });

export function runtimeProbe(options, env = window) {
  const enabled = options.diagnostics === true;
  const now = () => env.performance.now();
  const restorers = [];
  let iterations = [],
    renderMs = 0,
    renderCalls = 0,
    audioMs = 0,
    audioCalls = 0;
  let began = 0,
    inputAt = null,
    inputDelays = [],
    audioContext = null,
    hooked = false;
  const append = (list, value) => {
    if (list.length < 4096) list.push(value);
  };
  function wrap(proto, name, type, suppress = false) {
    if (typeof proto?.[name] !== "function") return;
    const original = proto[name];
    const replacement = function (...args) {
      if (suppress) return;
      const start = now();
      try {
        return original.apply(this, args);
      } finally {
        const elapsed = now() - start;
        if (type === "video") {
          renderMs += elapsed;
          renderCalls++;
        } else {
          audioMs += elapsed;
          audioCalls++;
          audioContext = this.context;
        }
      }
    };
    proto[name] = replacement;
    restorers.push(() => {
      if (proto[name] === replacement) proto[name] = original;
    });
  }
  return {
    moduleOptions: enabled
      ? {
          preMainLoop() {
            began = now();
            if (inputAt !== null) {
              append(inputDelays, began - inputAt);
              inputAt = null;
            }
          },
          postMainLoop() {
            append(iterations, now() - began);
          },
        }
      : {},
    attach() {
      if (hooked) return;
      hooked = true;
      // CPU submission only: never gl.finish(), readPixels() or GPU stalls.
      if (enabled || options.video === false) {
        for (const proto of [
          env.WebGLRenderingContext?.prototype,
          env.WebGL2RenderingContext?.prototype,
        ])
          for (const name of [
            "texImage2D",
            "texSubImage2D",
            "drawArrays",
            "drawElements",
          ])
            wrap(proto, name, "video", options.video === false);
      }
      if (enabled) wrap(env.AudioBufferSourceNode?.prototype, "start", "audio");
    },
    input() {
      if (enabled) inputAt = now();
    },
    reset() {
      iterations = [];
      inputDelays = [];
      renderMs = renderCalls = audioMs = audioCalls = 0;
      inputAt = null;
    },
    read() {
      const result = {
        retroarchIterationMs: distribution(iterations),
        videoSubmission: { cpuMs: renderMs, calls: renderCalls },
        audioScheduling: { cpuMs: audioMs, calls: audioCalls },
        inputObservedToIterationMs: distribution(inputDelays),
        audioContext: audioContext
          ? {
              state: audioContext.state,
              sampleRate: audioContext.sampleRate,
              baseLatency: audioContext.baseLatency ?? null,
            }
          : null,
        rawIterationMs: iterations,
      };
      this.reset();
      return result;
    },
    stop() {
      restorers.reverse().forEach((restore) => restore());
    },
  };
}
