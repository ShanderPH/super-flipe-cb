import { useEffect, useState } from "react";
import { connectedGamepads } from "../../input/navigation";
import { PROFILE_KEY, SNES_LABELS } from "../../../public/player/controls.js";

export function Diagnostics() {
  const [pads, setPads] = useState<string[]>([]);
  const [key, setKey] = useState("Aguardando entrada");
  const [storage, setStorage] = useState("Não disponível neste contexto");
  const [dbs, setDbs] = useState("Inspeção não disponível");
  const [audio, setAudio] = useState("Não testado");
  const [cacheResult, setCacheResult] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState("");
  const [renderer, setRenderer] = useState("webgl1");
  const [recordSession, setRecordSession] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("superflip-player-options") || "{}",
      );
      setRenderer(saved.renderer === "webgl2" ? "webgl2" : "webgl1");
      setRecordSession(saved.diagnostics === true);
    } catch {
      /* Optional session settings. */
    }
  }, []);
  const configureSession = (nextRenderer: string, diagnostics: boolean) => {
    setRenderer(nextRenderer);
    setRecordSession(diagnostics);
    try {
      sessionStorage.setItem(
        "superflip-player-options",
        JSON.stringify({ renderer: nextRenderer, diagnostics }),
      );
    } catch {
      setCalibration(
        "Este navegador não permitiu guardar a configuração da sessão.",
      );
    }
  };
  useEffect(() => {
    if (!calibrating) return;
    const selected = connectedGamepads()[0];
    if (!selected) {
      setCalibration(
        "Nenhum controle detectado. Pressione um botão e tente novamente.",
      );
      setCalibrating(false);
      return;
    }
    const buttons: number[] = [];
    let neutral = false;
    setCalibration(`Solte os botões. Depois pressione ${SNES_LABELS[0]}.`);
    const timer = setInterval(() => {
      const pad = connectedGamepads().find(
        (p) => p.index === selected.index && p.id === selected.id,
      );
      if (!pad) {
        setCalibration("Controle desconectado. Calibração cancelada.");
        setCalibrating(false);
        return;
      }
      const held = pad.buttons.flatMap((b, i) => (b.pressed ? [i] : []));
      if (held.length === 0) {
        neutral = true;
        return;
      }
      if (!neutral || held.length !== 1) return;
      neutral = false;
      if (buttons.includes(held[0])) {
        setCalibration(
          `Botão já usado. Solte e pressione ${SNES_LABELS[buttons.length]}.`,
        );
        return;
      }
      buttons.push(held[0]);
      if (buttons.length === SNES_LABELS.length) {
        try {
          localStorage.setItem(
            PROFILE_KEY,
            JSON.stringify({ id: pad.id, buttons }),
          );
          setCalibration(
            "Perfil SNES salvo para este controle. Solte os botões antes de navegar.",
          );
        } catch {
          setCalibration("Não foi possível salvar o perfil neste navegador.");
        }
        setCalibrating(false);
      } else
        setCalibration(
          `Solte os botões. Depois pressione ${SNES_LABELS[buttons.length]}.`,
        );
    }, 100);
    return () => clearInterval(timer);
  }, [calibrating]);
  useEffect(() => {
    const timer = window.setInterval(
      () =>
        setPads(
          connectedGamepads().map(
            (p) =>
              `${p.id} · índice ${p.index} · mapping ${p.mapping || "não padrão"}`,
          ),
        ),
      500,
    );
    const handler = (e: KeyboardEvent) =>
      setKey(`${e.type}: ${e.key} / ${e.code} / ${e.keyCode}`);
    document.addEventListener("keydown", handler);
    document.addEventListener("keyup", handler);
    navigator.storage
      ?.estimate?.()
      .then((s) =>
        setStorage(
          `${s.usage ?? "?"} bytes utilizados / quota ${s.quota ?? "?"}`,
        ),
      )
      .catch(() => {});
    indexedDB
      ?.databases?.()
      .then((items) =>
        setDbs(
          items.map((d) => d.name).join(", ") || "Nenhum banco identificado",
        ),
      )
      .catch(() => {});
    return () => {
      clearInterval(timer);
      document.removeEventListener("keydown", handler);
      document.removeEventListener("keyup", handler);
    };
  }, []);
  const testAudio = async () => {
    try {
      const context = new AudioContext();
      await context.resume();
      const oscillator = context.createOscillator(),
        gain = context.createGain();
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.25);
      oscillator.onended = () => {
        void context.close();
      };
      setAudio("Sinal emitido. Confirme se ouviu na TV.");
    } catch {
      setAudio("Não foi possível iniciar áudio.");
    }
  };
  const clearRomCache = async () => {
    try {
      await Promise.all(
        ["EmulatorJS-roms", "EmulatorJS-bios", "EmulatorJS-core"].map(
          (name) =>
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(name);
              request.onsuccess = () => resolve();
              request.onerror = () =>
                reject(new Error("Falha ao limpar cache."));
              request.onblocked = () =>
                reject(new Error("Feche outras sessões e tente novamente."));
            }),
        ),
      );
      setCacheResult(
        "Cache de ROMs, BIOS e cores removido desta origem. Saves não foram removidos.",
      );
    } catch (error) {
      setCacheResult(
        error instanceof Error ? error.message : "Limpeza indisponível.",
      );
    }
  };
  const exportReport = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            date: new Date().toISOString(),
            viewport: [innerWidth, innerHeight],
            dpr: devicePixelRatio,
            wasm: typeof WebAssembly !== "undefined",
            secureContext: isSecureContext,
            crossOriginIsolated: window.crossOriginIsolated,
            sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
            gamepadCount: pads.length,
            storage,
            dbs,
            audio,
            hardwareValidated: false,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = "super-flip-diagnostico.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="panel">
      <p className="eyebrow">SISTEMA / DIAGNÓSTICO</p>
      <h1>Pronto para testar na TV.</h1>
      <p>
        Estas informações descrevem este navegador. Não comprovam desempenho ou
        compatibilidade na LG.
      </p>
      <dl>
        <dt>Resolução</dt>
        <dd>
          {innerWidth} × {innerHeight} · DPR {devicePixelRatio}
        </dd>
        <dt>WebAssembly</dt>
        <dd>
          {typeof WebAssembly !== "undefined"
            ? "API disponível"
            : "Indisponível"}
        </dd>
        <dt>Contexto seguro</dt>
        <dd>
          {isSecureContext ? "Sim" : "Não — algumas APIs podem ser limitadas"}
        </dd>
        <dt>Gamepads</dt>
        <dd>
          {pads.join(" · ") ||
            "Nenhum detectado. Pressione um botão do controle."}
        </dd>
        <dt>Última tecla</dt>
        <dd>{key}</dd>
        <dt>Armazenamento da origem</dt>
        <dd>{storage}</dd>
        <dt>IndexedDB</dt>
        <dd>{dbs}</dd>
        <dt>Áudio</dt>
        <dd>{audio}</dd>
      </dl>
      <div className="actions">
        <button onClick={() => void testAudio()}>Testar áudio</button>
        <button onClick={exportReport}>Exportar diagnóstico</button>
        <button onClick={() => void clearRomCache()}>
          Limpar cache de ROMs e cores
        </button>
      </div>
      {cacheResult && <p role="status">{cacheResult}</p>}
      <fieldset data-input-calibration={calibrating ? "true" : undefined}>
        <legend>Controle SNES por posição física</legend>
        <p>
          Use um controle por vez. Controles sem mapping padrão precisam de
          calibração dos 12 botões, incluindo o D-pad. Teclado e controle remoto
          continuam disponíveis.
        </p>
        <div className="actions">
          <button onClick={() => setCalibrating((v) => !v)}>
            {calibrating ? "Cancelar calibração" : "Calibrar controle SNES"}
          </button>
          <button
            disabled={calibrating}
            onClick={() => {
              try {
                localStorage.removeItem(PROFILE_KEY);
                setCalibration(
                  "Perfil removido. O padrão por posição será usado.",
                );
              } catch {
                setCalibration("Não foi possível remover o perfil.");
              }
            }}
          >
            Restaurar perfil padrão
          </button>
        </div>
        {calibration && <p role="status">{calibration}</p>}
      </fieldset>
      <fieldset>
        <legend>Comparação na próxima partida</legend>
        <label>
          Renderer solicitado{" "}
          <select
            value={renderer}
            onChange={(e) => configureSession(e.target.value, recordSession)}
          >
            <option value="webgl1">WebGL 1 · referência atual</option>
            <option value="webgl2">WebGL 2 · experimento</option>
          </select>
        </label>
        <button
          aria-pressed={recordSession}
          onClick={() => configureSession(renderer, !recordSession)}
        >
          {recordSession
            ? "Desativar registro da sessão"
            : "Ativar registro da sessão"}
        </button>
        <p>
          Exporte o diagnóstico pelo menu do jogo. O registro inclui eventos,
          identificação do controle, core e renderer; não inclui ROMs ou SRAM.
          rAF não é FPS do jogo. Áudio, velocidade nominal e memória sem medição
          ficam marcados como indisponíveis.
        </p>
      </fieldset>
      <p className="muted">
        O diagnóstico básico omite identificadores de gamepad, ROM e caminhos do
        PC. O registro opcional da sessão inclui o identificador do controle.
      </p>
    </section>
  );
}
