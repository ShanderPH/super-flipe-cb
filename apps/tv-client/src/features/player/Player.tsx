import { useEffect, useRef, useState } from "react";
import type { Game } from "../../services/api";
import { command, validMessage } from "./adapter";
import {
  screenProtection,
  deviceInfo,
} from "../../../public/player/platform.js";

export function Player({
  game,
  onExit,
  menu,
  setMenu,
}: {
  game: Game;
  onExit: () => void;
  menu: boolean;
  setMenu: (value: boolean) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const protection = useRef<ReturnType<typeof screenProtection> | null>(null);
  const platformInfo = useRef<object>({ status: "pending" });
  useEffect(() => {
    const guard = screenProtection();
    protection.current = guard;
    void deviceInfo().then((info) => {
      platformInfo.current = info;
    });
    return () => {
      guard.stop();
      protection.current = null;
    };
  }, []);
  const [status, setStatus] = useState(
    "Carregando engine e ROM da rede local…",
  );
  const [started, setStarted] = useState(false);
  const [fatal, setFatal] = useState(false);
  const [pending, setPending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [autosync, setAutosync] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [progress, setProgress] = useState(
    "Sincronização desativada. Salve manualmente antes de sair.",
  );
  const [exitConfirm, setExitConfirm] = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const pendingId = useRef("");
  const pendingType = useRef("");
  const lastError = useRef("");
  const [playerOptions] = useState(() => {
    try {
      const options = JSON.parse(
        sessionStorage.getItem("superflip-player-options") || "{}",
      );
      return new URLSearchParams({
        renderer: options.renderer === "webgl2" ? "webgl2" : "webgl1",
        diagnostics: options.diagnostics === true ? "1" : "0",
        audio: options.audio === false ? "off" : "on",
        video: options.video === false ? "off" : "on",
        region: ["ntsc", "pal"].includes(options.region)
          ? options.region
          : "auto",
      }).toString();
    } catch {
      return "renderer=webgl1";
    }
  });
  const importFile = useRef<HTMLInputElement>(null);
  const requestTimer = useRef<number>(0);
  useEffect(() => {
    protection.current?.setPlaying(started && !menu && !paused && !fatal);
  }, [started, menu, paused, fatal]);
  useEffect(() => {
    let startTimer = 0;
    const handler = (event: MessageEvent) => {
      if (!validMessage(event, frame.current?.contentWindow ?? null, game.id))
        return;
      const { type, payload, requestId } = event.data;
      if (type === "ready") {
        setStatus(
          "Selecione “Iniciar jogo” na tela do emulador para liberar o áudio.",
        );
        clearTimeout(startTimer);
      }
      if (type === "started") {
        setStarted(true);
        clearTimeout(startTimer);
        setStatus(
          "Jogo em execução. Use Voltar ou Select + Start para abrir o menu.",
        );
      }
      if (type === "menu") setMenu(true);
      if (type === "progress") setProgress(String(payload.message));
      if (
        type === "error" &&
        (payload.fatal === true ||
          requestId === pendingId.current ||
          requestId === "event")
      ) {
        setStatus(String(payload.message));
        lastError.current = String(payload.message);
        if (payload.fatal === true) setFatal(true);
        setMenu(true);
        setPending(false);
        clearTimeout(requestTimer.current);
        pendingId.current = "";
      }
      if (
        requestId === pendingId.current &&
        (
          {
            pause: "paused",
            resume: "resumed",
            save: "saved",
            restore: "restored",
            import: "restored",
            export: "exported",
            exportPrevious: "exported",
            diagnostics: "exported",
            autosync: "configured",
          } as Record<string, string>
        )[pendingType.current] === type
      ) {
        if (type === "paused") {
          setPaused(true);
          setStatus(
            lastError.current ||
              "Jogo pausado. Solte os botões antes de escolher uma ação.",
          );
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(
                '[role="dialog"] button:not(:disabled)',
              )
              ?.focus(),
          );
        } else if (type === "resumed") {
          setPaused(false);
          setMenu(false);
          setStatus("Jogo em execução.");
        } else setStatus(String(payload.message));
        if (type === "restored") {
          setHasPrevious(true);
          setAutosync(false);
        }
        if (type === "configured") setAutosync(payload.enabled === true);
        setPending(false);
        clearTimeout(requestTimer.current);
        pendingId.current = "";
      }
    };
    window.addEventListener("message", handler);
    startTimer = window.setTimeout(() => {
      setStatus(
        "A engine não respondeu. Verifique o runtime local e a conexão.",
      );
      setFatal(true);
      setMenu(true);
    }, 60000);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(requestTimer.current);
      window.removeEventListener("message", handler);
    };
  }, [game.id, setMenu]);
  useEffect(() => {
    if (started && menu) {
      setPaused(false);
      setPending(true);
      if (!lastError.current) setStatus("Aguardando confirmação de pausa…");
      pendingType.current = "pause";
      pendingId.current = command(frame.current, game.id, "pause");
      clearTimeout(requestTimer.current);
      requestTimer.current = window.setTimeout(() => {
        pendingId.current = "";
        setPending(false);
        setStatus(
          "Pausa não confirmada. Volte à biblioteca ou tente pausar novamente.",
        );
      }, 15000);
    }
    if (menu)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[role="dialog"] button:not(:disabled)')
          ?.focus(),
      );
    else frame.current?.focus();
  }, [menu, game.id, started]);
  const run = (type: string, payload = {}) => {
    if (type !== "pause") lastError.current = "";
    setPending(true);
    setStatus("Aguardando confirmação…");
    pendingType.current = type;
    pendingId.current = command(frame.current, game.id, type, payload);
    clearTimeout(requestTimer.current);
    requestTimer.current = window.setTimeout(() => {
      pendingId.current = "";
      setPending(false);
      setStatus("Sem confirmação. Exporte o progresso antes de sair.");
    }, 15000);
  };
  useEffect(() => {
    const disconnected = () => {
      setStatus("Controle desconectado. Reconecte e confirme para continuar.");
      setMenu(true);
    };
    const visibility = () => {
      if (document.hidden) setMenu(true);
    };
    window.addEventListener("gamepaddisconnected", disconnected);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("gamepaddisconnected", disconnected);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [setMenu]);
  return (
    <section className="player">
      <iframe
        ref={frame}
        title={`Jogar ${game.title}`}
        src={`/player/?gameId=${encodeURIComponent(game.id)}&${playerOptions}`}
        allow="autoplay; gamepad; fullscreen"
      />
      {!menu && (
        <button
          className={
            started ? "menu-trigger gameplay-menu-access" : "menu-trigger"
          }
          onClick={() => setMenu(true)}
        >
          Menu / Voltar
        </button>
      )}
      {menu && (
        <div className="scrim">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-title"
            className="overlay panel"
          >
            <p className="eyebrow">SESSÃO SNES</p>
            <h1 id="player-title">{game.title}</h1>
            <p role="status">{status}</p>
            <p>
              Salve dentro do jogo e confirme no servidor antes de sair.
              Sincronização opcional: a cada 15 s, após validar a continuação.
            </p>
            <p>{progress}</p>
            <div className="actions vertical">
              <button
                disabled={fatal || pending || (started && !paused)}
                onClick={() => {
                  setExitConfirm(false);
                  if (started) run("resume");
                  else setMenu(false);
                }}
              >
                Continuar jogo
              </button>
              <button
                disabled={!started || !paused || pending || fatal}
                onClick={() => run("save")}
              >
                Salvar no servidor · slot 1
              </button>
              <button
                disabled={!started || !paused || pending || fatal}
                onClick={() => {
                  if (restoreConfirm) {
                    setRestoreConfirm(false);
                    run("restore");
                  } else {
                    setRestoreConfirm(true);
                    setStatus(
                      "Restaurar substitui o progresso desta sessão. Exporte antes. Selecione novamente para confirmar.",
                    );
                  }
                }}
              >
                {restoreConfirm
                  ? "Confirmar restauração · slot 1"
                  : "Restaurar do servidor · slot 1"}
              </button>
              <button
                disabled={!started || !paused || pending}
                onClick={() => run("export")}
              >
                Exportar SRAM para arquivo
              </button>
              <button
                disabled={!started || !paused || pending || fatal}
                onClick={() => importFile.current?.click()}
              >
                Importar SRAM de arquivo
              </button>
              <input
                ref={importFile}
                type="file"
                accept=".srm,.sav"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024 || !file.size) {
                    setStatus("Arquivo inválido: limite de 2 MiB.");
                    return;
                  }
                  run("import", {
                    bytes: new Uint8Array(await file.arrayBuffer()),
                  });
                }}
              />
              {hasPrevious && (
                <button
                  disabled={pending || !paused}
                  onClick={() => run("exportPrevious")}
                >
                  Exportar SRAM anterior à restauração
                </button>
              )}
              {started && !paused && !pending && (
                <button onClick={() => run("pause")}>
                  Tentar pausar novamente
                </button>
              )}
              <button
                disabled={!paused || pending || fatal}
                onClick={() => run("autosync", { enabled: !autosync })}
              >
                {autosync
                  ? "Desativar sincronização"
                  : "Ativar sincronização · SRAM já verificado"}
              </button>
              <button
                disabled={!started || pending}
                onClick={() =>
                  run("diagnostics", {
                    platform: {
                      device: platformInfo.current,
                      screenProtection: protection.current?.report(),
                    },
                  })
                }
              >
                Exportar diagnóstico da sessão
              </button>
              <button
                disabled={pending}
                onClick={() => (exitConfirm ? onExit() : setExitConfirm(true))}
              >
                {exitConfirm
                  ? "Confirmar saída da sessão"
                  : "Voltar à biblioteca"}
              </button>
            </div>
            {exitConfirm && (
              <p role="alert">
                Progresso não gravado no servidor será perdido. Salve ou exporte
                antes de confirmar.
              </p>
            )}
          </section>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </section>
  );
}
