export function sessionDiagnostics(engine, runtime, options) {
  const started = performance.now();
  const samples = [],
    inputs = [];
  let intervals = [],
    lastRaf = 0,
    lastSample = started,
    previousFrames = null;
  let frame = 0,
    timer = 0;
  let interrupted = false;
  const readFrames = () => {
    try {
      const n = engine.gameManager.functions.getFrameNum();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  };
  function raf(now) {
    interrupted ||= engine.paused || document.hidden;
    if (lastRaf && intervals.length < 1200) intervals.push(now - lastRaf);
    lastRaf = now;
    frame = requestAnimationFrame(raf);
  }
  previousFrames = readFrames();
  function sample() {
    const now = performance.now(),
      frames = readFrames();
    const ordered = intervals.sort((a, b) => a - b);
    const percentile = (q) =>
      ordered.length
        ? ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * q))]
        : null;
    const delta =
      frames !== null && previousFrames !== null && frames >= previousFrames
        ? frames - previousFrames
        : null;
    samples.push({
      elapsedMs: now - started,
      windowMs: now - lastSample,
      paused: engine.paused,
      interrupted,
      warmup: now - started < 60000,
      coreFramesPerSecond:
        delta === null ? null : (delta * 1000) / (now - lastSample),
      browserRafMs: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99),
      },
      hidden: document.hidden,
    });
    if (samples.length > 360) samples.shift();
    intervals = [];
    interrupted = false;
    previousFrames = frames;
    lastSample = now;
  }
  if (options.diagnostics) {
    frame = requestAnimationFrame(raf);
    timer = setInterval(sample, 10000);
  }
  return {
    input(event) {
      if (!options.diagnostics) return;
      inputs.push({ elapsedMs: performance.now() - started, ...event });
      if (inputs.length > 300) inputs.shift();
    },
    report() {
      const selectedCoreArtifact =
        engine.supportsWebgl2 && engine.webgl2Enabled
          ? "snes9x-wasm.data"
          : "snes9x-legacy-wasm.data";
      let renderer = null;
      try {
        const canvas = engine.canvas;
        const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
        if (gl)
          renderer = {
            api:
              typeof WebGL2RenderingContext !== "undefined" &&
              gl instanceof WebGL2RenderingContext
                ? "webgl2"
                : "webgl1",
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
            version: gl.getParameter(gl.VERSION),
            drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          };
      } catch {
        /* Explicit null when unavailable. */
      }
      return {
        date: new Date().toISOString(),
        runtime,
        selectedCoreArtifact,
        selectedCoreSha256: runtime.coreHashes[selectedCoreArtifact],
        options,
        userAgent: navigator.userAgent,
        secureContext: isSecureContext,
        crossOriginIsolated: window.crossOriginIsolated === true,
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        threads: false,
        viewport: [innerWidth, innerHeight],
        renderer,
        elapsedMs: performance.now() - started,
        samples,
        inputs,
        nominalCoreRate: null,
        emulationSpeedPercent: null,
        audioUnderruns: null,
        audioBufferOccupancy: null,
        activeCoreTime: null,
        presentedGameFrames: null,
        memoryBytes: null,
        limitations:
          "rAF mede callbacks do navegador, não frames apresentados nem trabalho ativo do core. Taxa nominal, áudio e memória não são expostos por esta integração. Confirmar firmware, conexão do controle, áudio e continuação no jogo na TV.",
        hardwareValidated: false,
      };
    },
    stop() {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    },
  };
}
