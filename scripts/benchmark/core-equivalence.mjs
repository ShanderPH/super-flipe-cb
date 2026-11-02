// Offline, deterministic fixed-frame A/V equivalence between compiled variants.
// Does not open browsers, contact hardware, or read/write saves.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    rom: { type: "string", multiple: true },
    build: { type: "string", multiple: true },
    frames: { type: "string", default: "600" },
    output: {
      type: "string",
      default: "artifacts/benchmarks/core-equivalence.json",
    },
  },
});
const frames = Number(values.frames);
if (
  !values.rom?.length ||
  !values.build?.length ||
  !Number.isInteger(frames) ||
  frames < 1 ||
  frames > 7200
)
  throw Error(
    "Explicit --rom and --build (repeatable), frames 1..7200 required",
  );
const result = {
  date: new Date().toISOString(),
  environment: "desktop-node-offline-fixed-frames",
  hardwareValidated: false,
  frames,
  scene:
    "reset; no input; fixed frame range; hashes of every frame and PCM sample",
  trials: [],
};
for (const rom of values.rom) {
  const bytes = await readFile(rom);
  const romSha256 = createHash("sha256").update(bytes).digest("hex");
  let reference;
  for (const directory of values.build) {
    const build = JSON.parse(await readFile(resolve(directory, "build.json")));
    const factory = (await import(pathToFileURL(resolve(directory, "core.js"))))
      .default;
    const module = await factory();
    const ptr = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, ptr);
    if (!module._lab_load(ptr, bytes.length)) throw Error("Core rejected ROM");
    module._free(ptr);
    const video = createHash("sha256"),
      audio = createHash("sha256");
    let pcmSamples = 0;
    const start = performance.now();
    for (let frame = 0; frame < frames; frame++) {
      module._lab_run();
      if (module._lab_overflow()) throw Error("Output exceeds lab bounds");
      const size = module._lab_width() * module._lab_height() * 4;
      video.update(
        module.HEAPU8.subarray(
          module._lab_pixels(),
          module._lab_pixels() + size,
        ),
      );
      const samples = module._lab_samples();
      audio.update(
        module.HEAPU8.subarray(
          module._lab_audio(),
          module._lab_audio() + samples * 2,
        ),
      );
      pcmSamples += samples;
    }
    const trial = {
      romSha256,
      build: directory.split(/[\\/]/).pop(),
      coreSha: build.coreSha,
      wasmSha256: build.files["core.wasm"],
      flags: build.flags,
      frames,
      pcmSamples,
      nominalFps: module._lab_fps(),
      sampleRate: module._lab_rate(),
      videoSha256: video.digest("hex"),
      audioSha256: audio.digest("hex"),
      heapBytes: module.HEAPU8.byteLength,
      elapsedIncludingHashingMs: performance.now() - start,
    };
    if (!reference) reference = trial;
    trial.matchesReference =
      trial.videoSha256 === reference.videoSha256 &&
      trial.audioSha256 === reference.audioSha256 &&
      trial.pcmSamples === reference.pcmSamples;
    result.trials.push(trial);
    console.log(
      JSON.stringify({
        build: trial.build,
        romSha256,
        matchesReference: trial.matchesReference,
        heapBytes: trial.heapBytes,
      }),
    );
  }
}
await mkdir(dirname(resolve(values.output)), { recursive: true });
await writeFile(values.output, JSON.stringify(result, null, 2));
if (result.trials.some((t) => !t.matchesReference)) process.exitCode = 1;
