import { distribution, unavailable } from "./runtime-probe.js";

export function sessionDiagnostics(engine, runtime, options, probe) {
  const started = performance.now();
  const samples = [],
    inputs = [],
    longTasks = [];
  let intervals = [],
    lastRaf = 0,
    lastSample = started,
    previousFrames = null;
  let frame = 0,
    timer = 0,
    observer = null,
    interrupted = false;
  const enabled = options.diagnostics === true;
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
    if (lastRaf && intervals.length < 4096) intervals.push(now - lastRaf);
    lastRaf = now;
    frame = requestAnimationFrame(raf);
  }
  function sample() {
    const now = performance.now(),
      frames = readFrames();
    const delta =
      frames !== null && previousFrames !== null && frames >= previousFrames
        ? frames - previousFrames
        : null;
    const coreFps = delta === null ? null : (delta * 1000) / (now - lastSample);
    samples.push({
      elapsedMs: now - started,
      windowMs: now - lastSample,
      paused: engine.paused,
      interrupted,
      hidden: document.hidden,
      warmup: now - started <= 60000,
      coreFramesPerSecond: coreFps,
      emulationSpeedPercent:
        coreFps !== null && options.nominalFps
          ? (coreFps / options.nominalFps) * 100
          : null,
      browserRafMs: distribution(intervals),
      rawRafMs: intervals,
      ...probe?.read(),
    });
    if (samples.length > 180) samples.shift();
    intervals = [];
    interrupted = false;
    previousFrames = frames;
    lastSample = now;
  }
  if (enabled) {
    previousFrames = readFrames();
    probe?.reset();
    frame = requestAnimationFrame(raf);
    timer = setInterval(sample, 10000);
    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask")
    ) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (longTasks.length >= 300) longTasks.shift();
          longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    }
  }
  return {
    input(event) {
      if (!enabled) return;
      probe?.input();
      if (inputs.length >= 300) inputs.shift();
      inputs.push({ elapsedMs: performance.now() - started, ...event });
    },
    report() {
      if (enabled && performance.now() > lastSample) sample();
      const core = runtime.core || "snes9x";
      const selectedCoreArtifact =
        engine.supportsWebgl2 && engine.webgl2Enabled
          ? core + "-wasm.data"
          : core + "-legacy-wasm.data";
      let renderer = unavailable(
        "No active WebGL context exposed by engine.canvas",
      );
      try {
        const gl = engine.canvas?.getContext(
          engine.supportsWebgl2 && engine.webgl2Enabled ? "webgl2" : "webgl",
        );
        if (gl)
          renderer = {
            api: gl.getParameter(gl.VERSION),
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
            drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          };
      } catch {
        /* Keep unavailable without creating another renderer. */
      }
      return {
        schemaVersion: 2,
        date: new Date().toISOString(),
        runtime,
        selectedCoreArtifact,
        selectedCoreSha256: runtime.coreHashes?.[selectedCoreArtifact],
        options,
        environment: /Web0S|webOS|SmartTV/i.test(navigator.userAgent)
          ? "tv-unverified"
          : "desktop",
        userAgent: navigator.userAgent,
        secureContext: window.isSecureContext,
        crossOriginIsolated: window.crossOriginIsolated === true,
        sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
        threads: false,
        hardwareConcurrency:
          navigator.hardwareConcurrency ?? unavailable("Not exposed"),
        viewport: [innerWidth, innerHeight],
        devicePixelRatio,
        renderer,
        elapsedMs: performance.now() - started,
        samples,
        inputs,
        nominalCoreRate: options.nominalFps
          ? {
              value: options.nominalFps,
              source: "operator-selected; verify ROM region",
            }
          : unavailable(
              "Core does not export retro_system_av_info; select verified ROM region for benchmarks",
            ),
        longTasks: observer
          ? longTasks
          : unavailable(
              enabled ? "Long Tasks API not supported" : "Profiler disabled",
            ),
        wasmHeapBytes:
          engine.Module?.HEAPU8?.byteLength ?? unavailable("Heap not exposed"),
        jsHeapBytes:
          performance.memory?.usedJSHeapSize ??
          unavailable("Non-standard performance.memory not exposed"),
        deviceMemoryGiB:
          navigator.deviceMemory ??
          unavailable("Not exposed; storage quota is not RAM"),
        pureCoreFrameMs: unavailable(
          "pre/postMainLoop includes RetroArch, core, video, audio and async yields; not retro_run alone",
        ),
        gpuTimeMs: unavailable(
          "Synchronous GL submission is not GPU execution time",
        ),
        presentedGameFrames: unavailable(
          "Canvas has no presentation feedback; rAF is not presented FPS",
        ),
        audioUnderruns: unavailable(
          "OpenAL driver does not export a reliable underrun counter",
        ),
        audioBufferOccupancy: unavailable("OpenAL queue not exported"),
        endToEndInputLatencyMs: unavailable(
          "Requires external input and screen measurement; event-to-iteration is partial",
        ),
        gcMs: unavailable("No portable GC observer"),
        limitations:
          "Raw intervals and iteration costs are bounded. Iteration time includes frontend and may include Asyncify yields. A/V-off is a diagnostic ablation, not equivalent gameplay. No physical LG acceptance is inferred.",
        hardwareValidated: false,
      };
    },
    stop() {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      observer?.disconnect();
      probe?.stop();
    },
  };
}
