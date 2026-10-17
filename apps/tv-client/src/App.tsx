import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { get, type Capabilities, type Game, type Page } from "./services/api";
import { startInput } from "./input/navigation";
import { Diagnostics } from "./features/diagnostics/Diagnostics";
import { Player } from "./features/player/Player";

type Screen = "home" | "library" | "diagnostics" | "details";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main>
        <h1>Não foi possível abrir esta tela.</h1>
        <button onClick={() => location.reload()}>Reabrir biblioteca</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [items, setItems] = useState<Page>({
    items: [],
    total: 0,
    page: 1,
    pageSize: 24,
  });
  const [cap, setCap] = useState<Capabilities | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [game, setGame] = useState<Game | null>(null);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState(false);
  const restoreFocus = useRef("nav-home");
  const hasLoaded = useRef(false);
  const current = useRef({ screen, playing, menu });
  current.current = { screen, playing, menu };
  const back = useCallback(() => {
    const s = current.current;
    if (s.playing) setMenu(true);
    else if (s.screen === "details") setScreen("library");
    else setScreen("home");
  }, []);
  useEffect(
    () =>
      startInput(back, () => current.current.playing && !current.current.menu),
    [back],
  );
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    if (!hasLoaded.current) setLoading(true);
    setError("");
    const timer = setTimeout(() => controller.abort(), 10000);
    Promise.all([
      get<Page>(
        `/api/games?system=snes&page=${page}&pageSize=24&search=${encodeURIComponent(search)}`,
        controller.signal,
      ),
      get<Capabilities>("/api/capabilities", controller.signal),
    ])
      .then(([games, caps]) => {
        if (disposed) return;
        setItems(games);
        setCap(caps);
        setOnline(true);
      })
      .catch(() => {
        if (disposed) return;
        if (!controller.signal.aborted)
          setError(
            "Sem conexão com a biblioteca. Verifique o servidor e a rede local.",
          );
        else setError("O servidor demorou a responder. Tente reconectar.");
        setOnline(false);
      })
      .finally(() => {
        clearTimeout(timer);
        if (!disposed) {
          hasLoaded.current = true;
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [page, search, reload]);
  useEffect(() => {
    if (playing) return;
    const listener = () => setReload((n) => n + 1);
    window.addEventListener("online", listener);
    const timer = setInterval(listener, 30000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", listener);
    };
  }, [playing]);
  useEffect(() => {
    if (playing) return;
    requestAnimationFrame(() => {
      const target =
        screen === "library" && restoreFocus.current.startsWith("game-")
          ? document.getElementById(restoreFocus.current)
          : null;
      (
        target ??
        document.querySelector<HTMLElement>(
          "main button:not(:disabled), main input",
        ) ??
        document.getElementById("nav-home")
      )?.focus();
    });
  }, [screen, playing, error]);
  const choose = (selected: Game) => {
    restoreFocus.current = `game-${selected.id}`;
    setGame(selected);
    setScreen("details");
  };
  return (
    <div className="app-shell">
      <header hidden={playing}>
        <button
          id="nav-home"
          className="brand"
          onClick={() => setScreen("home")}
        >
          <span className="brand-mark" aria-hidden="true">
            SF
          </span>
          <span>
            SUPER FLIP <b>CB</b>
          </span>
        </button>
        <nav aria-label="Principal">
          <button
            aria-current={screen === "library" ? "page" : undefined}
            onClick={() => setScreen("library")}
          >
            Biblioteca
          </button>
          <button onClick={() => setScreen("diagnostics")}>Diagnóstico</button>
        </nav>
        <span className={`status ${online ? "online" : ""}`} role="status">
          {online ? "Servidor conectado" : "Servidor desconectado"}
        </span>
      </header>
      <main hidden={playing}>
        {screen === "diagnostics" ? (
          <Diagnostics />
        ) : error ? (
          <section className="panel">
            <p className="eyebrow">CONEXÃO INTERROMPIDA</p>
            <h1>Sua biblioteca está na rede local.</h1>
            <p role="alert">{error}</p>
            <button onClick={() => setReload((n) => n + 1)}>Reconectar</button>
          </section>
        ) : screen === "details" && game ? (
          <section className="details panel">
            <p className="eyebrow">
              SUPER NINTENDO / {game.media.format.toUpperCase()}
            </p>
            <h1>{game.title}</h1>
            <p>
              {(game.media.sizeBytes / 1024 / 1024).toFixed(2)} MiB · Emulação
              na TV · Arquivo na sua rede
            </p>
            <p>
              Use um gamepad. Voltar ou Select + Start abre o menu. O progresso
              deve ser salvo manualmente.
            </p>
            {!cap?.runtimeInstalled && (
              <p role="alert">
                Runtime SNES não instalado. Execute o instalador local indicado
                no README.
              </p>
            )}
            <div className="actions">
              <button
                className="primary"
                disabled={!cap?.runtimeInstalled}
                onClick={() => {
                  setMenu(false);
                  setPlaying(true);
                }}
              >
                Jogar agora
              </button>
              <button onClick={() => setScreen("library")}>
                Voltar à biblioteca
              </button>
            </div>
          </section>
        ) : (
          <>
            {screen === "home" && (
              <section className="hero">
                <div>
                  <p className="eyebrow">SEU CONSOLE. SUA COLEÇÃO.</p>
                  <h1>
                    Uma nova partida.
                    <br />O mesmo encanto.
                  </h1>
                  <p>
                    Seus jogos na rede de casa.
                    <br />A próxima aventura, na tela grande.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setScreen("library")}
                  >
                    Abrir biblioteca <span aria-hidden="true">→</span>
                  </button>
                </div>
                <div className="console-art" aria-hidden="true">
                  <span className="pixel-number">16</span>
                  <span>BIT / LOCAL PLAY</span>
                  <div className="pixel-line" />
                </div>
              </section>
            )}
            <section aria-labelledby="library-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {screen === "home"
                      ? "ESCOLHA SEU CONSOLE"
                      : "COLEÇÃO LOCAL"}
                  </p>
                  <h2 id="library-title">
                    Super Nintendo{" "}
                    <span className="count">{items.total} jogos</span>
                  </h2>
                </div>
                <span className="system-label">
                  SNES <span aria-hidden="true">● ●</span>
                </span>
              </div>
              {screen === "library" && (
                <label className="search-label">
                  Buscar na biblioteca
                  <input
                    value={search}
                    onChange={(e) => {
                      setPage(1);
                      setSearch(e.target.value);
                    }}
                    placeholder="Nome do jogo"
                    maxLength={200}
                  />
                </label>
              )}
              {loading ? (
                <p role="status" className="panel">
                  Lendo biblioteca local…
                </p>
              ) : items.items.length ? (
                <div className="game-grid">
                  {items.items.map((item, i) => (
                    <button
                      className="game-card"
                      key={item.id}
                      id={`game-${item.id}`}
                      onClick={() => choose(item)}
                    >
                      <div className="cover">
                        {item.coverUrl ? (
                          <img
                            src={item.coverUrl}
                            alt=""
                            onError={(e) => {
                              e.currentTarget.style.visibility = "hidden";
                            }}
                          />
                        ) : (
                          <>
                            <span className="cartridge" aria-hidden="true">
                              {String(i + 1 + (page - 1) * 24).padStart(2, "0")}
                            </span>
                            <span className="cover-tag">
                              SNES / COLEÇÃO LOCAL
                            </span>
                          </>
                        )}
                      </div>
                      <span className="game-title">{item.title}</span>
                      <span className="muted">
                        {item.media.format.toUpperCase()} ·{" "}
                        {(item.media.sizeBytes / 1024 / 1024).toFixed(1)} MiB
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty panel">
                  <span className="empty-symbol" aria-hidden="true">
                    ＋
                  </span>
                  <div>
                    <h3>
                      {search
                        ? "Nenhum jogo encontrado."
                        : "Sua coleção começa aqui."}
                    </h3>
                    <p>
                      {search
                        ? "Tente outro nome para buscar na coleção."
                        : "Adicione seus arquivos .sfc ou .smc à pasta roms/snes do servidor e reinicie o servidor para atualizar o catálogo."}
                    </p>
                    <p className="muted">
                      Nenhuma ROM acompanha o Super Flip CB.
                    </p>
                  </div>
                </div>
              )}
              {items.total > 24 && (
                <div className="actions pagination">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Página anterior
                  </button>
                  <span>
                    {page} / {Math.ceil(items.total / 24)}
                  </span>
                  <button
                    disabled={page * 24 >= items.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Próxima página
                  </button>
                </div>
              )}
            </section>
            <aside className="notice">
              EM DESENVOLVIMENTO{" "}
              <span>
                Compatibilidade com a LG será verificada na etapa de validação.
              </span>
            </aside>
          </>
        )}
      </main>
      {playing && game && (
        <Player
          game={game}
          onExit={() => {
            setPlaying(false);
            setScreen("library");
          }}
          menu={menu}
          setMenu={setMenu}
        />
      )}
      {!playing && (
        <footer>
          <span>
            <kbd>↑ ↓ ← →</kbd> Navegar
          </span>
          <span>
            <kbd>OK / A</kbd> Selecionar
          </span>
          <span>
            <kbd>Voltar / B</kbd> Retornar
          </span>
          <span className="footer-end">LAN · SNES · v0.0.1</span>
        </footer>
      )}
    </div>
  );
}
