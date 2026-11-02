// Bounded stereo FIFO, resampled to the real output clock. Lab only.
class LabAudioSink extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.queue = new Float32Array(32768 * 2);
    this.read =
      this.write =
      this.consumed =
      this.underruns =
      this.overflows =
      this.tick =
        0;
    this.step = options.processorOptions.inputRate / sampleRate;
    this.port.onmessage = ({ data }) => {
      if (data.reset) {
        this.underruns = this.overflows = 0;
        return;
      }
      if (!(data instanceof Int16Array)) return;
      const count = data.length / 2;
      if (this.write - Math.floor(this.read) + count >= 32768) {
        this.overflows++;
        return;
      }
      for (let i = 0; i < count; i++) {
        const at = ((this.write + i) % 32768) * 2;
        this.queue[at] = data[2 * i] / 32768;
        this.queue[at + 1] = data[2 * i + 1] / 32768;
      }
      this.write += count;
    };
  }
  process(inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      const base = Math.floor(this.read);
      if (base + 1 >= this.write) {
        this.underruns++;
        continue;
      }
      const fraction = this.read - base;
      const a = (base % 32768) * 2,
        b = ((base + 1) % 32768) * 2;
      left[i] = this.queue[a] + (this.queue[b] - this.queue[a]) * fraction;
      right[i] =
        this.queue[a + 1] + (this.queue[b + 1] - this.queue[a + 1]) * fraction;
      this.read += this.step;
    }
    this.consumed = Math.floor(this.read);
    if (++this.tick % 8 === 0)
      this.port.postMessage({
        consumed: this.consumed,
        queuedFrames: this.write - this.read,
        underrunOutputSamples: this.underruns,
        overflowChunks: this.overflows,
      });
    return true;
  }
}
registerProcessor("superflip-lab-audio", LabAudioSink);
