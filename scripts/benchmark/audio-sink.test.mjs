import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function sink(inputRate = 48000) {
  let Sink;
  const messages = [];
  const context = vm.createContext({
    AudioWorkletProcessor: class {
      port = { postMessage: (data) => messages.push(data) };
    },
    sampleRate: 48000,
    Int16Array,
    Float32Array,
    registerProcessor: (name, constructor) => {
      Sink = constructor;
    },
  });
  vm.runInContext(
    readFileSync(new URL("web/audio-sink.js", import.meta.url), "utf8"),
    context,
  );
  return { instance: new Sink({ processorOptions: { inputRate } }), messages };
}
test("stereo samples preserve order, channels and source clock during resampling", () => {
  const { instance } = sink(24000);
  instance.port.onmessage({
    data: new Int16Array([0, 0, 16384, -16384, 32767, -32768, 0, 0]),
  });
  const left = new Float32Array(4),
    right = new Float32Array(4);
  instance.process([], [[left, right]]);
  assert.deepEqual([...left].slice(0, 3), [0, 0.25, 0.5]);
  assert.deepEqual([...right].slice(0, 3), [0, -0.25, -0.5]);
  assert.equal(instance.consumed, 2);
  assert.equal(instance.underruns, 0);
});
test("FIFO stays bounded, reports overflow and underrun, and reset preserves queued audio", () => {
  const { instance, messages } = sink();
  instance.port.onmessage({ data: new Int16Array(32767 * 2) });
  instance.port.onmessage({ data: new Int16Array(4) });
  assert.equal(instance.overflows, 1);
  assert.equal(instance.write, 32767);
  instance.port.onmessage({ data: { reset: true } });
  assert.equal(instance.overflows, 0);
  assert.equal(instance.write, 32767);
  for (let i = 0; i < 264; i++)
    instance.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.ok(instance.underruns > 0);
  assert.ok(messages.at(-1).underrunOutputSamples > 0);
  assert.ok(messages.at(-1).queuedFrames >= 0);
});
