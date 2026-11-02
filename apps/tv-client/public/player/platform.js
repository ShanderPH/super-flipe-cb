// Browser API first; undocumented webOS fallback is capability checked.
export function screenProtection(env = window) {
  let playing = false,
    stopped = false,
    lock = null,
    pending = false;
  let registration = null,
    response = null;
  const state = {
    browser: "inactive",
    luna: "unavailable",
    reason: "Not requested",
    requests: 0,
    vetoes: 0,
    responsesAccepted: 0,
  };
  const active = () => playing && !stopped && !env.document.hidden;
  const cancel = (bridge) => {
    try {
      bridge?.cancel();
    } catch {
      /* Disconnected. */
    }
  };
  async function update() {
    if (!active()) {
      const previous = lock;
      lock = null;
      state.browser = "inactive";
      try {
        await previous?.release();
      } catch {
        /* Already released. */
      }
      return;
    }
    if (lock || pending) return;
    if (!env.navigator.wakeLock?.request) {
      state.browser = "unavailable";
      state.reason = "Screen Wake Lock API absent";
      return;
    }
    pending = true;
    try {
      const acquired = await env.navigator.wakeLock.request("screen");
      if (!active()) {
        await acquired.release();
        return;
      }
      lock = acquired;
      state.browser = "held";
      state.reason = "";
      acquired.addEventListener("release", () => {
        if (lock === acquired) {
          lock = null;
          state.browser = "released";
        }
      });
    } catch (error) {
      state.browser = "rejected";
      state.reason = String(error.message || error);
    } finally {
      pending = false;
    }
  }
  function register() {
    if (stopped || registration || typeof env.PalmServiceBridge !== "function")
      return;
    // A previous document may still own its name briefly after a reload.
    const clientName = "com.superflipcb.app.gameplay." + Date.now();
    try {
      registration = new env.PalmServiceBridge();
      state.luna = "pending";
      registration.onservicecallback = (message) => {
        if (stopped) return;
        let result;
        try {
          result = JSON.parse(message);
        } catch {
          state.luna = "invalid-response";
          return;
        }
        if (result.returnValue === false) {
          state.luna = "rejected";
          state.reason = String(result.errorText || result.errorCode);
          return;
        }
        if (result.returnValue !== true) {
          state.luna = "invalid-response";
          return;
        }
        state.luna = "registered";
        if (result.timestamp == null) return;
        state.requests++;
        const ack = !active();
        if (!ack) state.vetoes++;
        cancel(response);
        try {
          response = new env.PalmServiceBridge();
          response.onservicecallback = (text) => {
            if (stopped) return;
            try {
              const accepted = JSON.parse(text).returnValue;
              if (accepted === false) state.luna = "response-rejected";
              else if (accepted === true) state.responsesAccepted++;
              else state.luna = "invalid-response";
            } catch {
              state.luna = "invalid-response";
            }
          };
          response.call(
            "luna://com.webos.service.tvpower/power/responseScreenSaverRequest",
            JSON.stringify({ clientName, timestamp: result.timestamp, ack }),
          );
        } catch (error) {
          state.luna = "response-rejected";
          state.reason = String(error.message || error);
        }
      };
      registration.call(
        "luna://com.webos.service.tvpower/power/registerScreenSaverRequest",
        JSON.stringify({ clientName, subscribe: true }),
      );
    } catch (error) {
      state.luna = "rejected";
      state.reason = String(error.message || error);
    }
  }
  const visibility = () => {
    void update();
  };
  env.document.addEventListener("visibilitychange", visibility);
  return {
    setPlaying(value) {
      if (stopped) return;
      playing = value;
      if (value) register();
      void update();
    },
    report() {
      return { ...state, playing: active(), physicalValidation: "pending" };
    },
    stop() {
      stopped = true;
      playing = false;
      void update();
      cancel(registration);
      cancel(response);
      env.document.removeEventListener("visibilitychange", visibility);
    },
  };
}

export function deviceInfo(env = window) {
  return new Promise((resolve) => {
    if (typeof env.PalmServiceBridge !== "function") {
      resolve({
        status: "unavailable",
        reason: "PalmServiceBridge absent in hosted page",
      });
      return;
    }
    let bridge;
    const timer = setTimeout(() => {
      bridge?.cancel?.();
      resolve({ status: "unavailable", reason: "System info timeout" });
    }, 3000);
    try {
      bridge = new env.PalmServiceBridge();
      bridge.onservicecallback = (message) => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(message));
        } catch {
          resolve({
            status: "unavailable",
            reason: "Invalid system info response",
          });
        }
      };
      bridge.call(
        "luna://com.webos.service.tv.systemproperty/getSystemInfo",
        JSON.stringify({
          keys: ["modelName", "firmwareVersion", "sdkVersion", "UHD"],
        }),
      );
    } catch (error) {
      clearTimeout(timer);
      resolve({
        status: "unavailable",
        reason: String(error.message || error),
      });
    }
  });
}
