// Preserve class/global names: loader.js consumes window.EmulatorJS.
import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { minify } from "rolldown/utils";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = process.argv[2] ? pathToFileURL(process.argv[2].replaceAll("\\", "/") + "/") : new URL("../../../vendor/emulatorjs/data/", import.meta.url);
const files = ["emulator.js", "nipplejs.js", "shaders.js", "storage.js", "gamepad.js", "GameManager.js", "socket.io.min.js", "compression.js"];
await access(root);
const sources = await Promise.all(files.map(f => readFile(new URL(`src/${f}`, root), "utf8")));
if (![0, 4, 5].every(i => sources[i].startsWith("// Super Flip CB input and SRAM integration patch 1"))) throw new Error("Apply the pinned runtime patch before building.");
const result = await minify("emulator.js", sources.join("\n;\n"), { compress: false, mangle: false });
await writeFile(new URL("emulator.min.js", root), result.code);
// CSS is local and small; preserve license and URL semantics without another compiler.
await writeFile(new URL("emulator.min.css", root), await readFile(new URL("emulator.css", root)));
const hashes = {};
for (const file of ["emulator.min.js", "emulator.min.css", "loader.js"]) hashes[file] = createHash("sha256").update(await readFile(new URL(file, root))).digest("hex");
await writeFile(new URL("superflip-build.json", root), JSON.stringify({ patch: 1, files: hashes }, null, 2));
console.log(`Production runtime built: ${fileURLToPath(root)}`);
