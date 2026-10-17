/* EmulatorJS 4.2.3 pinned; all runtime details stay in this iframe. */
import {
  controls,
  getPads,
  inputGate,
  readProfile,
  SNES_BUTTONS,
} from "./controls.js";
import { SaveSync, validateSram } from "./sram.js";
import { sessionDiagnostics } from "./diagnostics.js";
const params = new URLSearchParams(location.search);
const gameId = params.get("gameId"),
  status = document.getElementById("status");
const options = {
  webgl2: params.get("renderer") === "webgl2",
  diagnostics: params.get("diagnostics") === "1",
};
const gate = inputGate();
const bootStarted = performance.now();
let loaderReadyAt = null,
  gestureAt = null;
let ready = false,
  busy = false,
  bootTimer = 0,
  sync = null,
  previousSram = null,
  coreBuild = "";
let diagnostics = null,
  lastPadState = "",
  activePad = "",
  profile = SNES_BUTTONS,
  seenPad = "";
let autosync = false; // Enable after a real save/continue check on this TV/core.
const endpoint = "/api/games/" + encodeURIComponent(gameId) + "/saves/1";
const engine = () => window.EJS_emulator;
function send(type, requestId = "event", payload = {}) {
  parent.postMessage({ type, requestId, gameId, payload }, location.origin);
}
function fail(message, requestId = "event", fatal = false) {
  status.textContent = message;
  send("error", requestId, { message, fatal });
}
async function request(url, options = {}) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.arrayBuffer();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}
function download(bytes, name, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function releaseInputs() {
  const fn = engine()?.gameManager?.functions?.simulateInput;
  if (fn)
    for (let player = 0; player < 4; player++)
      for (let i = 0; i < 12; i++) fn(player, i, 0);
}
function pause() {
  gate.block();
  releaseInputs();
  engine().pause();
  if (engine().paused !== true)
    throw new Error("O core não confirmou a pausa.");
}
function openMenu() {
  if (ready) {
    try {
      pause();
    } catch (error) {
      fail(error.message, "event", true);
    }
  }
  send("menu");
}
function restoreBytes(bytes) {
  const gm = engine().gameManager,
    current = gm.getSaveFile();
  validateSram(bytes, current?.byteLength);
  const path = gm.getSaveFilePath();
  if (!path || typeof gm.loadSaveFiles !== "function")
    throw new Error("Este core não oferece restauração SRAM.");
  previousSram = current.slice();
  try {
    gm.FS.writeFile(path, bytes);
    gm.loadSaveFiles();
  } catch (error) {
    try {
      gm.FS.writeFile(path, previousSram);
      gm.loadSaveFiles();
    } catch {
      throw Object.assign(
        new Error(
          "Falha ao recuperar a SRAM anterior. Preserve o save do servidor e reabra a sessão.",
        ),
        { fatal: true },
      );
    }
    throw error;
  }
}
function checkSaved(response) {
  if (
    response.headers.get("x-core-version") !== "emulatorjs-4.2.3" ||
    response.headers.get("x-core-build") !== coreBuild ||
    !response.headers.get("etag")
  )
    throw new Error("Save incompatível. Preserve e recupere antes de jogar.");
}
async function boot() {
  if (!/^snes-[a-f0-9]{64}$/.test(gameId ?? ""))
    throw new Error("Identificador de jogo inválido.");
  const response = await request("/api/games/" + gameId);
  if (!response.ok) throw new Error("Jogo indisponível. Volte à biblioteca.");
  const game = await response.json();
  const runtimeResponse = await request("/api/runtime");
  if (!runtimeResponse.ok)
    throw new Error("Não foi possível identificar o runtime.");
  const runtime = await runtimeResponse.json();
  coreBuild = runtime.coreBuild;
  const saved = await request(endpoint);
  let initialSave = null,
    etag = '"0"';
  if (saved.ok) {
    checkSaved(saved);
    initialSave = new Uint8Array(await saved.arrayBuffer());
    etag = saved.headers.get("etag");
  } else if (saved.status !== 404)
    throw new Error(
      "Não foi possível verificar seu save. Reconecte antes de jogar.",
    );
  sync = new SaveSync(
    (bytes, version) =>
      request(endpoint, {
        method: "PUT",
        body: bytes,
        headers: {
          "Content-Type": "application/octet-stream",
          "If-Match": version,
          "X-Core-Version": "emulatorjs-4.2.3",
          "X-Core-Build": coreBuild,
          "X-Super-Flip": "1",
        },
      }),
    (state, message) => send("progress", "event", { state, message }),
    initialSave,
    etag,
  );
  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: "snes9x",
    EJS_gameUrl: game.media.url + "#game." + game.media.format,
    EJS_gameName: gameId,
    EJS_gameID: gameId,
    EJS_pathtodata: "/emulatorjs/data/",
    EJS_DEBUG_XX: false,
    EJS_disableDatabases: true,
    EJS_disableLocalStorage: true,
    EJS_threads: false,
    EJS_defaultControls: controls(),
    EJS_defaultOptions: {
      webgl2Enabled: options.webgl2 ? "enabled" : "disabled",
    },
    EJS_startOnLoaded: false,
    EJS_startButtonName: "Iniciar jogo",
    EJS_language: "pt-BR",
    EJS_backgroundColor: "#000000",
    EJS_Buttons: {
      playPause: false,
      restart: false,
      rightClick: false,
      saveState: false,
      loadState: false,
      quickSave: false,
      quickLoad: false,
      cacheManager: false,
      saveSavFiles: false,
      loadSavFiles: false,
      netplay: false,
      fullscreen: false,
      settings: false,
      gamepad: false,
    },
    EJS_ready: () => {
      engine().config.superFlip = {
        allowInput: () => {
          if (!ready || !gate.armed || engine().paused) return false;
          const pad = getPads().find((p) => p.id + ":" + p.index === activePad);
          if (
            pad?.buttons[profile[2]]?.pressed &&
            pad?.buttons[profile[3]]?.pressed
          ) {
            openMenu();
            return false;
          }
          return true;
        },
      };
      for (const type of ["buttondown", "buttonup", "axischanged"])
        engine().gamepad.on(type, (event) => {
          const pad = getPads().find((p) => p.index === event.gamepadIndex);
          if (!pad || pad.id + ":" + pad.index !== activePad) return;
          engine().gamepadEvent(event);
        });
      // Reapply the profile if a controller was already present before loader readiness.
      engine().controls = controls(profile);
      engine().setupKeys();
      status.textContent = "";
      loaderReadyAt = performance.now();
      send("ready");
      const button = document.querySelector(".ejs_start_button");
      if (button) {
        button.setAttribute("role", "button");
        button.tabIndex = 0;
        button.focus();
      }
      engine().on("start-clicked", () => {
        gestureAt = performance.now();
        bootTimer = setTimeout(
          () =>
            fail(
              "O core não iniciou em 60 segundos. Verifique os arquivos e a rede.",
              "event",
              true,
            ),
          60000,
        );
      });
      engine().on("exit", () =>
        fail("A execução do core foi encerrada.", "event", true),
      );
    },
    EJS_onGameStart: () => {
      clearTimeout(bootTimer);
      try {
        gate.block();
        if (initialSave) {
          pause();
          restoreBytes(initialSave);
          initialSave = null;
          engine().play();
        }
        engine().controls = controls(profile);
        engine().setupKeys();
        ready = true;
        diagnostics = sessionDiagnostics(engine(), runtime, {
          ...options,
          boot: {
            untilReadyMs:
              loaderReadyAt === null ? null : loaderReadyAt - bootStarted,
            gestureToStartMs:
              gestureAt === null ? null : performance.now() - gestureAt,
          },
        });
        send("started");
      } catch (error) {
        engine().pause();
        fail(error.message, "event", true);
      }
    },
  });
  const loader = document.createElement("script");
  loader.src = "/emulatorjs/data/loader.js";
  loader.onerror = () =>
    fail("Runtime não instalado. Consulte o README.", "event", true);
  document.body.appendChild(loader);
}
window.addEventListener("message", async (event) => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const d = event.data;
  if (
    !d ||
    d.gameId !== gameId ||
    typeof d.requestId !== "string" ||
    !d.payload ||
    typeof d.payload !== "object"
  )
    return;
  const { type, requestId } = d;
  if (
    ![
      "pause",
      "resume",
      "save",
      "restore",
      "export",
      "import",
      "exportPrevious",
      "diagnostics",
      "autosync",
    ].includes(type)
  )
    return;
  if (!ready) {
    fail("O jogo ainda não iniciou.", requestId);
    return;
  }
  let acquired = false;
  try {
    if (type === "pause" || type === "resume") status.textContent = "";
    if (type === "pause") {
      pause();
      send("paused", requestId);
      return;
    }
    if (type === "resume") {
      if (busy || sync.busy)
        throw new Error("Aguarde a operação de progresso antes de continuar.");
      gate.block();
      engine().play();
      if (engine().paused !== false)
        throw new Error("O core não confirmou a retomada.");
      send("resumed", requestId);
      return;
    }
    if (type === "diagnostics") {
      download(
        JSON.stringify(diagnostics.report(), null, 2),
        "super-flip-sessao.json",
        "application/json",
      );
      send("exported", requestId, {
        message: "Diagnóstico solicitado ao navegador. Confira o arquivo.",
      });
      return;
    }
    if (busy || sync.busy)
      throw new Error("Outra operação de progresso está em andamento.");
    if (!engine().paused)
      throw new Error("Pause o jogo antes de alterar o progresso.");
    busy = true;
    acquired = true;
    if (type === "autosync") {
      autosync = d.payload.enabled === true;
      send("progress", "event", {
        state: "configured",
        message: autosync
          ? "Sincronização ativada; aguardando a próxima verificação de SRAM."
          : "Sincronização desativada. Salve manualmente antes de sair.",
      });
      send("configured", requestId, {
        enabled: autosync,
        message: autosync
          ? "Sincronização ativada. Grave primeiro dentro do jogo; confira a confirmação do servidor."
          : "Sincronização desativada. Salve manualmente antes de sair.",
      });
    } else if (type === "save") {
      await sync.save(engine().gameManager.getSaveFile(), true);
      send("saved", requestId, { message: "Progresso gravado no servidor." });
    } else if (type === "export" || type === "exportPrevious") {
      const bytes =
        type === "exportPrevious"
          ? previousSram
          : engine().gameManager.getSaveFile();
      if (!bytes?.byteLength)
        throw new Error("Nenhum SRAM disponível para exportar.");
      download(
        bytes,
        gameId + (type === "exportPrevious" ? "-anterior" : "") + ".srm",
      );
      send("exported", requestId, {
        message:
          "Exportação solicitada ao navegador. Confira o arquivo antes de sair.",
      });
    } else if (type === "import") {
      restoreBytes(d.payload.bytes);
      autosync = false;
      send("progress", "event", {
        state: "local",
        message:
          "SRAM importado somente na sessão. Sincronização desativada; confirme no jogo antes de salvar.",
      });
      send("restored", requestId, {
        message:
          "SRAM importado na sessão; cópia anterior preservada. Sincronização desativada. Confirme no jogo e salve manualmente.",
      });
    } else if (type === "restore") {
      const response = await request(endpoint);
      if (!response.ok)
        throw new Error(
          "Não foi possível recuperar este slot. Seu jogo foi preservado.",
        );
      checkSaved(response);
      const bytes = new Uint8Array(await response.arrayBuffer());
      restoreBytes(bytes);
      sync.restored(bytes, response.headers.get("etag"));
      autosync = false;
      send("progress", "event", {
        state: "confirmed",
        message:
          "SRAM recuperado do servidor. Sincronização desativada; confirme a continuação no jogo.",
      });
      send("restored", requestId, {
        message:
          "SRAM restaurado; cópia anterior preservada. Confirme Continuar no jogo. Sincronização desativada.",
      });
    }
  } catch (error) {
    fail(
      error.message || "Falha ao acessar o servidor. Preserve seu progresso.",
      requestId,
      error.fatal === true,
    );
  } finally {
    if (acquired) busy = false;
  }
});
for (const type of ["keydown", "keyup"])
  document.addEventListener(
    type,
    (event) => {
      gate.key(event);
      diagnostics?.input({
        type,
        key: event.key,
        code: event.code,
        keyCode: event.keyCode,
        paused: engine()?.paused,
        focus: document.activeElement?.tagName,
      });
      if (
        event.key === "Escape" ||
        event.key === "BrowserBack" ||
        event.keyCode === 461
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (type === "keydown" && !event.repeat) openMenu();
      } else if (
        !ready &&
        type === "keydown" &&
        !event.repeat &&
        (event.key === "Enter" || event.key === " ")
      ) {
        event.preventDefault();
        document.querySelector(".ejs_start_button")?.click();
      }
    },
    true,
  );
document.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
window.addEventListener("blur", () => {
  gate.resetKeys();
  if (ready) openMenu();
});
window.addEventListener("gamepaddisconnected", () => {
  gate.block();
  if (ready) openMenu();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && ready) openMenu();
});
window.addEventListener("error", () =>
  fail("A engine encontrou uma falha. Abra o menu para voltar.", "event", true),
);
let startHeld = true;
function poll() {
  const pads = getPads(),
    pad = pads[0];
  const device = pad ? pad.id + ":" + pad.index : "";
  if (device !== seenPad) {
    let calibrated = null;
    try {
      calibrated = pad && readProfile(localStorage, pad.id);
    } catch {
      /* Optional profile. */
    }
    const supported = pad && (pad.mapping === "standard" || calibrated);
    releaseInputs();
    gate.block();
    seenPad = device;
    activePad = supported ? device : "";
    profile = calibrated || SNES_BUTTONS;
    if (engine()?.controls) {
      engine().controls = controls(profile);
      engine().setupKeys();
    }
    if (pad && !supported)
      send("progress", "event", {
        state: "input",
        message:
          "Controle sem mapeamento padrão. Calibre em Diagnóstico ou use o teclado/controle remoto.",
      });
  }
  const snapshot = options.diagnostics
    ? JSON.stringify(
        pads.map((p) => ({
          index: p.index,
          id: p.id,
          mapping: p.mapping,
          buttons: p.buttons.map((b) => b.pressed),
          axes: p.axes.map((a) => Math.round(a * 100) / 100),
        })),
      )
    : "";
  if (snapshot !== lastPadState) {
    diagnostics?.input({
      type: "gamepad",
      pads: JSON.parse(snapshot),
      paused: engine()?.paused,
      focus: document.activeElement?.tagName,
    });
    lastPadState = snapshot;
  }
  if (
    ready &&
    activePad &&
    gate.armed &&
    !engine().paused &&
    pad.buttons[profile[2]]?.pressed &&
    pad.buttons[profile[3]]?.pressed
  )
    openMenu();
  gate.update(pads);
  if (!ready) {
    const pressed = !!(
      activePad &&
      (pad.buttons[profile[0]]?.pressed || pad.buttons[profile[3]]?.pressed)
    );
    if (pressed && !startHeld)
      document.querySelector(".ejs_start_button")?.click();
    startHeld = pressed;
  }
  requestAnimationFrame(poll);
}
setInterval(() => {
  if (!ready || !autosync || busy || sync.busy) return;
  try {
    void sync.save(engine().gameManager.getSaveFile()).catch(() => {});
  } catch {
    send("progress", "event", {
      state: "unsent",
      message: "Falha ao obter SRAM. Pause e preserve o progresso.",
    });
    autosync = false;
  }
}, 15000);
boot().catch((error) => fail(error.message, "event", true));
requestAnimationFrame(poll);
