// Uses the installed Playwright dependency. Runs only against the isolated lab.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, totalmem, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "apps/tv-client/package.json"));
const { chromium } = require("@playwright/test");
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8798" },
    seconds: { type: "string", default: "30" },
    warmup: { type: "string", default: "60" },
    repeats: { type: "string", default: "3" },
    output: { type: "string", default: "artifacts/benchmarks/desktop.json" },
    alternative: { type: "boolean", default: false },
    core: { type: "boolean", default: false },
    baseline: { type: "boolean", default: false },
    renderer: { type: "string", default: "webgl1" },
  },
});
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
  throw new Error("Invalid benchmark duration/repeats");
const base = new URL(values.base);
if (!["127.0.0.1", "localhost"].includes(base.hostname))
  throw new Error(
    "Desktop runner requires loopback lab; physical TV uses the inspector procedure",
  );
const config = await (await fetch(new URL("/lab/config", base))).json();
if (config.realSaves !== false || !config.gameId)
  throw new Error(
    "Run scripts/benchmark/serve.py with --rom; real saves must be disabled",
  );
const runtime = await (await fetch(new URL("/api/runtime", base))).json();
const matrix = [];
for (let repeat = 0; repeat < repeats; repeat++) {
  // Alternate order each repetition to expose thermal/order effects.
  const variants = [];
  for (const audio of [true, false])
    for (const video of [true, false])
      for (const diagnostics of [false, true])
        if (!values.core && (!values.baseline || (audio && video)))
          variants.push({ engine: "emulatorjs", audio, video, diagnostics });
  if (values.core)
    for (const diagnostics of [false, true])
      variants.push({
        engine: "libretro",
        audio: true,
        video: true,
        diagnostics,
      });
  if (values.alternative)
    for (const diagnostics of [false, true])
      variants.push({
        engine: "independent",
        audio: true,
        video: true,
        diagnostics,
      });
  if (repeat % 2) variants.reverse();
  matrix.push(...variants.map((mode) => ({ repeat: repeat + 1, ...mode })));
}
const browserArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ headless: true, args: browserArgs });
const results = {
  schemaVersion: 1,
  date: new Date().toISOString(),
  environment: "desktop-headless-software-GPU",
  hardwareValidated: false,
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  workingTreeChanges: true,
  hardware: {
    os: platform(),
    osRelease: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
  },
  browser: { version: browser.version(), args: browserArgs },
  gameId: config.gameId,
  scene: "cold-boot/no-input; fresh browser context per trial",
  warmupSeconds: warmup,
  durationSeconds: seconds,
  runtime,
  trials: [],
};
try {
  for (const mode of matrix) {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const params = new URLSearchParams({
      gameId: config.gameId,
      benchmark: "1",
      renderer: values.renderer,
      diagnostics: mode.diagnostics ? "1" : "0",
      audio: mode.audio ? "on" : "off",
      video: mode.video ? "on" : "off",
      region: "ntsc",
    });
    const pathname =
      mode.engine === "libretro"
        ? "/lab/assets/libretro.html"
        : mode.engine === "independent"
          ? "/lab/assets/independent.html"
          : "/player/";
    await page.goto(new URL(`${pathname}?${params}`, base).href);
    try {
      await page
        .getByRole("button", {
          name:
            mode.engine !== "emulatorjs"
              ? "Iniciar comparação"
              : "Iniciar jogo",
          exact: true,
        })
        .click();
      await page.waitForFunction(
        () => window.superFlipBenchmark || window.benchmarkError,
        { timeout: 60000 },
      );
      const error = await page.evaluate(() => window.benchmarkError);
      if (error) throw new Error(error);
      await page.waitForTimeout(warmup * 1000);
      const counter = () =>
        page.evaluate(
          () =>
            window.superFlipBenchmark.counter?.() ?? {
              frames: window.EJS_emulator.gameManager.functions.getFrameNum(),
              now: performance.now(),
            },
        );
      // Drain warmup samples before the timed window.
      await page.evaluate(() => window.superFlipBenchmark.report());
      const start = await counter();
      await page.waitForTimeout(seconds * 1000);
      const end = await counter();
      const report = await page.evaluate(() =>
        window.superFlipBenchmark.report(),
      );
      if (report.interrupted || report.paused || errors.length)
        throw new Error("Invalid trial: interrupted, paused or page error");
      const elapsedMs = end.now - start.now;
      const trial = {
        ...mode,
        start,
        end,
        elapsedMs,
        coreFps: ((end.frames - start.frames) * 1000) / elapsedMs,
        errors,
        report,
      };
      results.trials.push(trial);
      console.log(JSON.stringify({ ...mode, coreFps: trial.coreFps, errors }));
    } catch (error) {
      results.trials.push({
        ...mode,
        status: "failed",
        error: String(error),
        errors,
      });
      console.log(`${mode.engine}: ${error}`);
    } finally {
      await context.close();
    }
    const path = resolve(root, values.output);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(results, null, 2));
  }
} finally {
  await browser.close();
}
if (results.trials.some((trial) => trial.status === "failed"))
  process.exitCode = 1;
