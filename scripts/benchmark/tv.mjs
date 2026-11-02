// Attach only to the explicitly selected Super Flip page; restores its URL.
// Start the read-only lab on the PC's explicit private LAN IP first.
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isIP } from "node:net";
const { values } = parseArgs({
  options: {
    inspector: { type: "string" },
    base: { type: "string" },
    seconds: { type: "string", default: "30" },
    warmup: { type: "string", default: "60" },
    repeats: { type: "string", default: "3" },
    output: { type: "string", default: "artifacts/benchmarks/tv.json" },
    readOnly: { type: "boolean", default: false },
    baseline: { type: "boolean", default: false },
    cpuProfile: { type: "boolean", default: false },
    renderer: { type: "string", default: "webgl1" },
    alternative: { type: "boolean", default: false },
    alternativeOnly: { type: "boolean", default: false },
    core: { type: "boolean", default: false },
    loopbackTunnel: { type: "boolean", default: false },
    authorization: { type: "string" },
  },
});
// Required before even enumerating targets. A flag records approval, never grants it.
if (!values.authorization?.trim())
  throw new Error(
    "TV access requires the user's explicit approval for this session; pass --authorization with its reference only after approval.",
  );
if (!values.inspector)
  throw new Error("--inspector http://localhost:<forwarded port> is required");
const inspector = new URL(values.inspector);
if (!["localhost", "127.0.0.1"].includes(inspector.hostname))
  throw new Error("Use the local ares-inspect tunnel");
const targets = await (await fetch(new URL("/json/list", inspector))).json();
const target = targets.find((t) => t.description === "com.superflipcb.app");
if (!target)
  throw new Error("Super Flip target is absent; other apps are never selected");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let sequence = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const event = JSON.parse(data);
  const waiter = pending.get(event.id);
  if (!waiter) return;
  pending.delete(event.id);
  clearTimeout(waiter.timer);
  if (event.error) waiter.reject(new Error(event.error.message));
  else waiter.resolve(event.result);
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("CDP timeout: " + method));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, userGesture = false) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.text +
        ": " +
        result.exceptionDetails.exception?.description,
    );
  return result.result?.value;
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(expression, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await evaluate(expression);
    if (result) return result;
    await pause(500);
  }
  throw new Error("TV condition timed out: " + expression);
}
const originalUrl = target.url;
const hardware = await evaluate(
  `({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,secureContext:window.isSecureContext,viewport:[innerWidth,innerHeight],devicePixelRatio,screen:[screen.width,screen.height],wakeLock:typeof navigator.wakeLock,serviceBridge:typeof PalmServiceBridge,audioWorklet:typeof AudioWorkletNode,crossOriginIsolated:window.crossOriginIsolated===true,sharedArrayBuffer:typeof SharedArrayBuffer})`,
);
const result = {
  schemaVersion: 1,
  authorization: values.authorization,
  date: new Date().toISOString(),
  environment: "physical-lg",
  hardware,
  trials: [],
  physicalAcceptance: "pending",
  gameId: null,
  scene: "cold-boot/no-input",
  cpuProfilerEnabled: values.cpuProfile,
  renderer: values.renderer,
  sourceBaseSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
  }).trim(),
};
try {
  if (!values.readOnly) {
    const base = new URL(values.base);
    const tunneled = values.loopbackTunnel && base.hostname === "127.0.0.1";
    if (
      isIP(base.hostname) !== 4 ||
      !["http:", "https:"].includes(base.protocol) ||
      (!tunneled &&
        !/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(base.hostname))
    )
      throw new Error("Use a private LAN lab IP");
    const seconds = Number(values.seconds),
      warmup = Number(values.warmup),
      repeats = Number(values.repeats);
    if (
      ![seconds, warmup, repeats].every(Number.isFinite) ||
      seconds < 1 ||
      seconds > 1800 ||
      warmup < 0 ||
      repeats < 1 ||
      repeats > 10 ||
      !Number.isInteger(repeats)
    )
      throw new Error("Invalid timings");
    result.warmupSeconds = warmup;
    result.durationSeconds = seconds;
    result.transport = tunneled
      ? "SSH TV-loopback to PC-loopback; development only"
      : "LAN";
    result.servedPlayerHashes = {};
    for (const name of [
      "bridge.js",
      "diagnostics.js",
      "runtime-probe.js",
      "platform.js",
    ]) {
      const response = await fetch(new URL("/player/" + name, base));
      if (!response.ok) throw new Error("Player asset unavailable: " + name);
      result.servedPlayerHashes[name] = createHash("sha256")
        .update(new Uint8Array(await response.arrayBuffer()))
        .digest("hex");
    }
    await send("Page.navigate", {
      url: new URL("/lab/assets/independent.html", base).href,
    });
    await until(
      `location.origin === ${JSON.stringify(base.origin)} && document.readyState === "complete"`,
    );
    const config = await evaluate(`fetch('/lab/config').then(r=>r.json())`);
    if (config.realSaves !== false || !config.gameId)
      throw new Error("Isolated lab with selected ROM required");
    result.gameId = config.gameId;
    result.runtime = await evaluate(`fetch('/api/runtime').then(r=>r.json())`);
    for (let repeat = 0; repeat < repeats; repeat++) {
      const modes = [];
      for (const audio of [true, false])
        for (const video of [true, false])
          for (const diagnostics of [false, true]) {
            if (
              !values.alternativeOnly &&
              !values.core &&
              (!values.baseline || (audio && video && !diagnostics))
            )
              modes.push({ engine: "emulatorjs", audio, video, diagnostics });
          }
      if (values.alternative || values.alternativeOnly)
        for (const diagnostics of [false, true])
          modes.push({
            engine: "independent",
            audio: true,
            video: true,
            diagnostics,
          });
      if (values.core)
        for (const diagnostics of [false, true])
          modes.push({
            engine: "libretro",
            audio: true,
            video: true,
            diagnostics,
          });
      if (repeat % 2) modes.reverse();
      for (const mode of modes) {
        const params = new URLSearchParams({
          gameId: config.gameId,
          benchmark: "1",
          diagnostics: mode.diagnostics ? "1" : "0",
          audio: mode.audio ? "on" : "off",
          video: mode.video ? "on" : "off",
          renderer: values.renderer,
          region: "ntsc",
        });
        const trial = { repeat: repeat + 1, ...mode };
        try {
          const independent = mode.engine === "independent";
          const libretro = mode.engine === "libretro";
          const labMode = independent || libretro;
          await send("Page.navigate", {
            url: new URL(
              (libretro
                ? "/lab/assets/libretro.html?"
                : independent
                  ? "/lab/assets/independent.html?"
                  : "/player/?") + params,
              base,
            ).href,
          });
          await until(
            labMode
              ? `!!document.querySelector('#start')?.onclick`
              : `document.querySelector('.ejs_start_button') && window.EJS_emulator?.config?.superFlip`,
          );
          await evaluate(
            labMode
              ? `document.querySelector('#start').click()`
              : `document.querySelector('.ejs_start_button').click()`,
            true,
          );
          await until(
            `!!window.superFlipBenchmark || !!window.benchmarkError`,
            90000,
          );
          trial.context = await evaluate(
            `({secureContext:isSecureContext,origin:location.origin,audioWorklet:typeof AudioWorkletNode,viewport:[innerWidth,innerHeight],devicePixelRatio})`,
          );
          const startError = await evaluate(`window.benchmarkError`);
          if (startError) throw new Error(startError);
          await evaluate(
            `(()=>{if(document.hidden||window.EJS_emulator?.paused)throw Error('TV app must be visible and running');window.labInvalid=false;document.addEventListener('visibilitychange',()=>{if(document.hidden)window.labInvalid=true})})()`,
          );
          await evaluate(
            `import('/player/platform.js').then(({screenProtection})=>{window.labScreenGuard=screenProtection();labScreenGuard.setPlaying(true);addEventListener('pagehide',()=>labScreenGuard.stop(),{once:true})})`,
          );
          await pause(warmup * 1000);
          await evaluate(`window.superFlipBenchmark.report()`);
          if (values.cpuProfile) {
            await send("Profiler.enable");
            await send("Profiler.setSamplingInterval", { interval: 1000 });
            await send("Profiler.start");
          }
          trial.start = await evaluate(
            `window.superFlipBenchmark.counter?.() ?? ({frames:EJS_emulator.gameManager.functions.getFrameNum(),now:performance.now()})`,
          );
          await pause(seconds * 1000);
          trial.end = await evaluate(
            `window.superFlipBenchmark.counter?.() ?? ({frames:EJS_emulator.gameManager.functions.getFrameNum(),now:performance.now()})`,
          );
          if (values.cpuProfile)
            trial.cpuProfile = (await send("Profiler.stop")).profile;
          trial.report = await evaluate(`window.superFlipBenchmark.report()`);
          trial.screenProtection = await evaluate(
            `window.labScreenGuard.report()`,
          );
          trial.validity = await evaluate(
            `({hidden:document.hidden,paused:window.EJS_emulator?.paused === true,interrupted:window.labInvalid})`,
          );
          if (
            trial.validity.hidden ||
            trial.validity.paused ||
            trial.validity.interrupted
          )
            throw new Error(
              "Invalid trial: TV hidden, paused or interrupted; never interpret as gameplay FPS",
            );
          trial.elapsedMs = trial.end.now - trial.start.now;
          trial.coreFps =
            ((trial.end.frames - trial.start.frames) * 1000) / trial.elapsedMs;
          console.log(
            JSON.stringify({
              ...mode,
              repeat: repeat + 1,
              coreFps: trial.coreFps,
            }),
          );
        } catch (error) {
          trial.status = "failed";
          trial.error = String(error);
          console.log(trial.error);
        } finally {
          if (values.cpuProfile) await send("Profiler.disable");
          await evaluate(`window.labScreenGuard?.stop()`);
        }
        result.trials.push(trial);
        const path = resolve(values.output);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(result, null, 2));
      }
    }
  } else {
    const path = resolve(values.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(hardware));
  }
} finally {
  if (!values.readOnly) await send("Page.navigate", { url: originalUrl });
  ws.close();
}
if (result.trials.some((trial) => trial.status === "failed"))
  process.exitCode = 1;
// Some TV inspector proxies never finish a WebSocket close handshake.
await pause(1000);
process.exit(process.exitCode || 0);
