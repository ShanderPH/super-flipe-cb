// Desktop PS1 lab only; never mounts or uploads production saves.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cpus, totalmem } from "node:os";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "apps/tv-client/package.json"));
const { chromium } = require("@playwright/test");
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8799" },
    warmup: { type: "string", default: "60" },
    seconds: { type: "string", default: "30" },
    output: { type: "string", default: "artifacts/benchmarks/ps1.json" },
  },
});
const base = new URL(values.base);
const warmup = Number(values.warmup),
  seconds = Number(values.seconds);
if (
  !["127.0.0.1", "localhost"].includes(base.hostname) ||
  !Number.isFinite(warmup) ||
  warmup < 0 ||
  !Number.isFinite(seconds) ||
  seconds < 1 ||
  seconds > 1800
)
  throw Error("Loopback lab and finite timings required");
const response = await fetch(new URL("/lab/ps1-config", base));
if (!response.ok) throw Error("PS1 lab not configured");
const media = await response.json();
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const result = {
  environment: "desktop-headless-software-GPU",
  date: new Date().toISOString(),
  cpu: cpus()[0].model,
  ramBytes: totalmem(),
  browser: browser.version(),
  media,
  warmupSeconds: warmup,
  durationSeconds: seconds,
  scene: "cold-boot/no-input",
  hardwareValidated: false,
  errors: [],
  console: [],
};
// A stalled renderer/evaluation must leave a report instead of hanging the lab.
const bounded = (operation, label, timeout = 15000) => {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error("Timeout: " + label)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
};
async function rendererMemory(page) {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send("SystemInfo.getProcessInfo");
    const ids = processInfo
      .filter((p) => p.type === "renderer")
      .map((p) => Number(p.id));
    if (!ids.length || !ids.every(Number.isSafeInteger))
      throw Error("Renderer PIDs unavailable");
    const os =
      process.platform === "win32"
        ? JSON.parse(
            execFileSync(
              "powershell.exe",
              [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                `Get-Process -Id ${ids.join(",")} | Select-Object Id,WorkingSet64,PeakWorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`,
              ],
              { encoding: "utf8" },
            ),
          )
        : {
            status: "unavailable",
            reason: "OS sampling implemented for Windows only",
          };
    return {
      os,
      rendererLifetimePeak: true,
      note: "OS peak working set is resident memory for this desktop renderer, not a TV budget. JS and WASM overlap; do not add blindly.",
      browser: await page.evaluate(() => ({
        wasmHeapBytes: EJS_emulator.Module?.HEAPU8?.byteLength ?? null,
        jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
      })),
    };
  } finally {
    await session.detach();
  }
}
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("console", (message) => {
    if (
      !message.text().startsWith("Translation not found") &&
      result.console.length < 1500
    )
      result.console.push({ type: message.type(), text: message.text() });
  });
  await page.goto(new URL("/lab/assets/ps1.html?debug", base).href);
  await page
    .getByRole("button", { name: "Iniciar PS1 experimental", exact: true })
    .click();
  await page.waitForFunction(() => !!window.superFlipPS1Lab, null, {
    timeout: 180000,
  });
  console.log("PS1 core initialized; validating BIOS/disc");
  result.boot = await bounded(
    page.evaluate(() => {
      const e = EJS_emulator,
        fs = e.gameManager.FS;
      return {
        fileName: e.fileName,
        externalMediaBytes: e.config.externalFiles?.["/disc.bin"]
          ? fs.stat("/disc.bin").size
          : null,
        biosBytes: fs.stat("/" + e.config.biosUrl.split("/").pop()).size,
        discOwnership: window.superFlipPS1Lab.report().discOwnership,
      };
    }),
    "boot validation",
  );
  result.boot.evidence = result.console
    .map((entry) => entry.text)
    .filter((line) =>
      /found BIOS file:|BIOS:|CD-ROM (ID|Label|EXE)|Starting PCSX|Track 0/.test(
        line,
      ),
    );
  if (
    result.console.some((entry) =>
      /Failed to load content|unsupported\/invalid CD image/.test(entry.text),
    ) ||
    !result.boot.evidence.some((line) => line.includes("CD-ROM ID:")) ||
    !result.boot.evidence.some((line) => line.includes("found BIOS file:")) ||
    (media.format === "cue" &&
      result.boot.externalMediaBytes !== media.mediaBytes)
  )
    throw Error("BIOS/disc boot not validated; menu counters are not game FPS");
  console.log("BIOS/disc recognized; warming up");
  result.memoryAfterBoot = await rendererMemory(page);
  await page.waitForTimeout(warmup * 1000);
  await bounded(
    page.evaluate(() => window.superFlipPS1Lab.report()),
    "warmup report",
  );
  const counter = () =>
    bounded(
      page.evaluate(() => ({
        frames: window.EJS_emulator.gameManager.functions.getFrameNum(),
        now: performance.now(),
        hidden: document.hidden,
        paused: EJS_emulator.paused,
      })),
      "frame counter",
    );
  result.start = await counter();
  console.log("Measuring PS1 core counters");
  await page.waitForTimeout(seconds * 1000);
  result.end = await counter();
  result.report = await bounded(
    page.evaluate(() => window.superFlipPS1Lab.report()),
    "final report",
  );
  result.memoryAfterWindow = await rendererMemory(page);
  if (
    result.start.hidden ||
    result.start.paused ||
    result.end.hidden ||
    result.end.paused
  )
    throw Error("Interrupted PS1 trial");
  result.coreFps =
    ((result.end.frames - result.start.frames) * 1000) /
    (result.end.now - result.start.now);
  const folder = dirname(resolve(values.output));
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: resolve(folder, "ps1-game.png") });
  // A byte-identical volatile card roundtrip tests integration, not in-game save recognition.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.EJS_emulator.paused);
  const before = await page.evaluate(() =>
    Array.from(window.EJS_emulator.gameManager.getSaveFile() || []),
  );
  if (before.length) {
    await page.locator("#import").setInputFiles({
      name: "same-card.srm",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(before),
    });
    await page.waitForFunction(() =>
      document.getElementById("status").textContent.includes("Cópia importada"),
    );
    const after = await page.evaluate(() =>
      Array.from(window.EJS_emulator.gameManager.getSaveFile() || []),
    );
    result.cardRoundtrip = {
      bytes: before.length,
      identical: Buffer.from(before).equals(Buffer.from(after)),
      inGameRecognition: "unverified; same volatile card bytes only",
    };
    if (!result.cardRoundtrip.identical)
      throw Error("Volatile card roundtrip changed bytes");
  } else
    result.cardRoundtrip = {
      status: "unavailable",
      reason: "No memory card exported by core",
    };
  await page.screenshot({ path: resolve(folder, "ps1-lab.png") });
  console.log(
    JSON.stringify({
      coreFps: result.coreFps,
      cardRoundtrip: result.cardRoundtrip,
      errors: result.errors,
    }),
  );
} catch (error) {
  result.error = String(error);
  process.exitCode = 1;
  console.log(result.error);
} finally {
  const path = resolve(values.output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(result, null, 2));
  await bounded(browser.close(), "browser shutdown", 10000);
}
