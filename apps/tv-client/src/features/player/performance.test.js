import { describe, expect, it, vi, afterEach } from "vitest";
import {
  runtimeProbe,
  distribution,
} from "../../../public/player/runtime-probe.js";
import { screenProtection } from "../../../public/player/platform.js";

afterEach(() => vi.restoreAllMocks());

it("measures a frontend iteration and CPU submissions without claiming GPU time", () => {
  let clock = 0;
  class GL {
    drawArrays() {
      clock += 2;
    }
  }
  const original = GL.prototype.drawArrays;
  const probe = runtimeProbe(
    { diagnostics: true },
    { performance: { now: () => clock }, WebGLRenderingContext: GL },
  );
  probe.attach();
  probe.moduleOptions.preMainLoop();
  new GL().drawArrays();
  clock += 3;
  probe.moduleOptions.postMainLoop();
  const report = probe.read();
  expect(report.retroarchIterationMs.mean).toBe(5);
  expect(report.videoSubmission).toEqual({ cpuMs: 2, calls: 1 });
  expect(probe.read().rawIterationMs).toEqual([]);
  probe.stop();
  expect(GL.prototype.drawArrays).toBe(original);
});

it("profiler off installs no hooks and video-off really bypasses GL submission", () => {
  let calls = 0;
  class GL {
    drawArrays() {
      calls++;
    }
  }
  const env = { performance: { now: () => 0 }, WebGLRenderingContext: GL };
  const original = GL.prototype.drawArrays;
  const off = runtimeProbe({ diagnostics: false }, env);
  off.attach();
  expect(off.moduleOptions).toEqual({});
  expect(GL.prototype.drawArrays).toBe(original);
  const videoOff = runtimeProbe({ video: false }, env);
  videoOff.attach();
  new GL().drawArrays();
  expect(calls).toBe(0);
  videoOff.stop();
  new GL().drawArrays();
  expect(calls).toBe(1);
});

it("uses nearest-rank percentiles and bounds iteration samples", () => {
  expect(distribution([])).toBeNull();
  expect(distribution([4, 1, 2, 3])).toMatchObject({
    p50: 2,
    p95: 4,
    p99: 4,
    mean: 2.5,
  });
  const probe = runtimeProbe(
    { diagnostics: true },
    { performance: { now: () => 0 } },
  );
  for (let i = 0; i < 5000; i++) {
    probe.moduleOptions.preMainLoop();
    probe.moduleOptions.postMainLoop();
  }
  expect(probe.read().rawIterationMs.length).toBe(4096);
});

describe("screen protection", () => {
  function environment(request) {
    return {
      document: new EventTarget(),
      navigator: { wakeLock: { request } },
    };
  }
  it("releases on pause, reacquires on resume and releases on disposal", async () => {
    const released = vi.fn();
    const sentinel = () =>
      Object.assign(new EventTarget(), { release: released });
    const request = vi.fn(async () => sentinel());
    const guard = screenProtection(environment(request));
    guard.setPlaying(true);
    await Promise.resolve();
    expect(guard.report().browser).toBe("held");
    guard.setPlaying(false);
    await Promise.resolve();
    expect(released).toHaveBeenCalledTimes(1);
    guard.setPlaying(true);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    guard.stop();
    await Promise.resolve();
    expect(released).toHaveBeenCalledTimes(2);
  });
  it("does not retain a lock acquired after gameplay already ended", async () => {
    let resolve;
    const release = vi.fn();
    const guard = screenProtection(
      environment(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    guard.setPlaying(true);
    guard.setPlaying(false);
    resolve(Object.assign(new EventTarget(), { release }));
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledOnce();
    expect(guard.report().browser).not.toBe("held");
    guard.stop();
  });
  it("a disposed owner cannot register again or reacquire protection", async () => {
    const request = vi.fn();
    const bridge = vi.fn();
    const guard = screenProtection({
      ...environment(request),
      PalmServiceBridge: bridge,
    });
    guard.stop();
    guard.setPlaying(true);
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
    expect(guard.report().playing).toBe(false);
  });
  it("reports browser denial and only vetoes Luna screensaver requests during visible gameplay", async () => {
    const bridges = [];
    class Bridge {
      constructor() {
        bridges.push(this);
      }
      call = vi.fn();
      cancel = vi.fn();
    }
    const env = {
      ...environment(async () => {
        throw new Error("NotAllowedError");
      }),
      PalmServiceBridge: Bridge,
    };
    const guard = screenProtection(env);
    guard.setPlaying(true);
    await Promise.resolve();
    expect(guard.report().browser).toBe("rejected");
    bridges[0].onservicecallback("{}");
    expect(guard.report().luna).toBe("invalid-response");
    expect(bridges).toHaveLength(1);
    bridges[0].onservicecallback(
      JSON.stringify({ returnValue: true, timestamp: 1 }),
    );
    expect(JSON.parse(bridges[1].call.mock.calls[0][1]).ack).toBe(false);
    bridges[1].onservicecallback("{}");
    expect(guard.report().responsesAccepted).toBe(0);
    bridges[1].onservicecallback('{"returnValue":true}');
    expect(guard.report().responsesAccepted).toBe(1);
    bridges[1].onservicecallback('{"returnValue":false}');
    expect(guard.report().luna).toBe("response-rejected");
    expect(guard.report().responsesAccepted).toBe(1);
    guard.setPlaying(false);
    bridges[0].onservicecallback(
      JSON.stringify({ returnValue: true, timestamp: 2 }),
    );
    expect(JSON.parse(bridges[2].call.mock.calls[0][1]).ack).toBe(true);
    env.document.hidden = true;
    guard.setPlaying(true);
    bridges[0].onservicecallback(
      JSON.stringify({ returnValue: true, timestamp: 3 }),
    );
    expect(JSON.parse(bridges[3].call.mock.calls[0][1]).ack).toBe(true);
    guard.stop();
    expect(bridges[0].cancel).toHaveBeenCalledOnce();
  });
});
