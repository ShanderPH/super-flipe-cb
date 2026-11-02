import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
for (const file of ["tv.mjs", "tunnel.mjs"]) {
  test(`${file} refuses any TV access without recorded explicit approval`, () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL(file, import.meta.url))],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit approval/);
    assert.doesNotMatch(result.stdout, /Set target|Temporary lab|coreFps/);
  });
}
