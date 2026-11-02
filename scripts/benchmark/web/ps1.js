import { controls } from "/player/controls.js";
import { screenProtection } from "/player/platform.js";
import { runtimeProbe } from "/player/runtime-probe.js";
import { sessionDiagnostics } from "/player/diagnostics.js";
const options = { diagnostics: true, audio: true, video: true };
const probe = runtimeProbe(options);
const guard = screenProtection();
const status = document.getElementById("status"),
  menu = document.getElementById("menu");
const engine = () => window.EJS_emulator;
let previous = null,
  diagnostics = null;
let discOwnership = { status: "not-loaded" };
const profile = controls();
Object.assign(profile[0], {
  12: { value: "r", value2: "LEFT_BOTTOM_SHOULDER" },
  13: { value: "t", value2: "RIGHT_BOTTOM_SHOULDER" },
});
try {
  const config = await (await fetch("/lab/ps1-config")).json();
  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: "pcsx_rearmed",
    EJS_gameUrl: config.gameUrl,
    EJS_externalFiles: config.externalFiles,
    EJS_biosUrl: "/lab/bios/" + config.biosName,
    EJS_gameName: "superflip-ps1-lab",
    EJS_pathtodata: "/emulatorjs/data/",
    EJS_threads: false,
    EJS_paths: {
      "pcsx_rearmed-wasm.data": "/ps1-cores/pcsx_rearmed-wasm.data",
      "pcsx_rearmed-legacy-wasm.data":
        "/ps1-cores/pcsx_rearmed-legacy-wasm.data",
      "pcsx_rearmed.json": "/ps1-cores/reports/pcsx_rearmed.json",
    },
    EJS_disableDatabases: true,
    EJS_disableLocalStorage: true,
    EJS_defaultControls: profile,
    EJS_startOnLoaded: false,
    EJS_startButtonName: "Iniciar PS1 experimental",
    EJS_Buttons: {
      saveState: false,
      loadState: false,
      quickSave: false,
      quickLoad: false,
      netplay: false,
      fullscreen: false,
      settings: false,
      gamepad: false,
    },
    EJS_ready() {
      engine().debug = new URLSearchParams(location.search).has("debug");
      // EJS 4.2.3 passes externalFiles response ArrayBuffers directly to
      // MEMFS.writeFile, which silently creates an empty file. A typed view
      // preserves the downloaded bytes without another full-disc copy.
      const download = engine().downloadFile.bind(engine());
      engine().downloadFile = async (url, ...args) => {
        const response = await download(url, ...args);
        if (url === "/lab/disc" && response?.data instanceof ArrayBuffer)
          response.data = new Uint8Array(response.data);
        return response;
      };
      // The dedicated disc ArrayBuffer is immutable after download. Let MEMFS
      // own it instead of allocating another whole-disc copy. No SRAM/card path
      // or production GameManager is changed; this subclass lives in this lab document.
      const BaseManager = window.EJS_GameManager;
      window.EJS_GameManager = class extends BaseManager {
        writeFile(path, data) {
          if (path === "/disc.bin" && data instanceof Uint8Array) {
            this.FS.createDataFile("/", "disc.bin", data, true, false, true);
            const node = this.FS.analyzePath("/disc.bin").object;
            discOwnership = {
              bytes: data.byteLength,
              sameArrayBuffer: node.contents?.buffer === data.buffer,
              status:
                node.contents?.buffer === data.buffer
                  ? "owned-without-full-copy"
                  : "copied-by-runtime",
            };
            return;
          }
          return super.writeFile(path, data);
        }
      };
      // Volatile FS and explicit memory-card ownership, preserving production SRAM.
      engine().config.superFlip = {
        allowInput: () => !engine().paused,
        runtimeOptions: probe.moduleOptions,
      };
      probe.attach();
      const button = document.querySelector(".ejs_start_button");
      button?.setAttribute("role", "button");
      if (button) {
        button.tabIndex = 0;
        button.focus();
      }
    },
    EJS_onGameStart() {
      // PS1 adds L2/R2 (RetroPad 12/13), whereas production SNES admits 0..11.
      const manager = engine().gameManager;
      manager.simulateInput = (player, index, value) => {
        if (index < 14 && (!engine().paused || value === 0))
          manager.functions.simulateInput(player, index, value);
      };
      diagnostics = sessionDiagnostics(
        engine(),
        { ...config, engineVersion: "4.2.3" },
        options,
        probe,
      );
      guard.setPlaying(true);
      window.superFlipPS1Lab = Object.freeze({
        report: () => ({
          ...diagnostics.report(),
          media: config,
          discOwnership,
          screenProtection: guard.report(),
        }),
      });
      status.textContent =
        "PS1 experimental. Voltar/Escape abre o menu. Exporte o cartão antes de fechar.";
    },
  });
  const loader = document.createElement("script");
  loader.src = "/emulatorjs/data/loader.js";
  document.body.append(loader);
} catch (error) {
  status.textContent = String(error.message || error);
}
function pause() {
  if (!engine()?.started) return;
  engine()?.pause();
  guard.setPlaying(false);
  menu.hidden = false;
  document.getElementById("resume").focus();
}
document.addEventListener(
  "keydown",
  (event) => {
    if (
      ["Escape", "BrowserBack"].includes(event.key) ||
      event.keyCode === 461
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pause();
    } else if (event.key === "Enter" && !engine()?.started) {
      event.preventDefault();
      document.querySelector(".ejs_start_button")?.click();
    }
  },
  true,
);
document.getElementById("resume").onclick = () => {
  engine().play();
  menu.hidden = true;
  guard.setPlaying(true);
  engine().canvas.focus();
};
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.getElementById("export").onclick = () => {
  try {
    download(engine().gameManager.getSaveFile(), "ps1-card.srm");
    if (previous) download(previous, "ps1-card-before-import.srm");
  } catch (error) {
    status.textContent = String(error.message || error);
  }
};
document.getElementById("report").onclick = () => {
  if (diagnostics)
    download(
      JSON.stringify({
        ...diagnostics.report(),
        screenProtection: guard.report(),
      }),
      "ps1-diagnostic.json",
    );
};
document.getElementById("import").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const manager = engine().gameManager,
      before = manager.getSaveFile().slice();
    if (
      !engine().paused ||
      !before.length ||
      file.size !== before.length ||
      file.size > 2 * 1024 * 1024
    )
      throw new Error(
        "Pause e use um cartão do mesmo tamanho. O cartão atual foi preservado.",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    previous = before;
    try {
      manager.FS.writeFile(manager.getSaveFilePath(), bytes);
      manager.loadSaveFiles();
    } catch (error) {
      manager.FS.writeFile(manager.getSaveFilePath(), before);
      manager.loadSaveFiles();
      throw error;
    }
    status.textContent =
      "Cópia importada nesta sessão; cartão anterior disponível na exportação. Confira dentro do jogo.";
  } catch (error) {
    status.textContent = String(error.message || error);
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("gamepaddisconnected", pause);
window.addEventListener("pagehide", () => {
  guard.stop();
  diagnostics?.stop();
  probe.stop();
});
