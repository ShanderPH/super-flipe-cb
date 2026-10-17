# Super Flip CB — Planning de Arquitetura e Implementação

> **Etapa:** 02 — Planning / preparação para implementação  
> **Data:** 17 de outubro de 2026  
> **Status:** planejamento inicial concluído; execução condicionada aos *spikes* na LG real  
> **Fonte principal:** `researching.md` (etapa 01)  
> **Nome definitivo do produto:** **Super Flip CB**  
> **Plataforma alvo:** LG 55QNED70BSA, webOS TV 26 (versão/firmware real a confirmar)  
> **Escopo operacional:** uso pessoal, rede doméstica, sem root, sem distribuir ROMs/BIOS.

---

## 0. Resumo das decisões

**Decisão principal:** não utilizar Firebase ou Render como hospedagem principal no MVP. O **Super Flip CB** terá um **servidor local FastAPI**, inicialmente no PC Windows, capaz de hospedar a interface compilada, arquivos do EmulatorJS, API, ROMs, capas e saves **na mesma origem HTTP**. Um `.ipk` pequeno, instalado via Developer Mode, abre a interface na LG; a **emulação ocorre na própria TV por WASM**, não no servidor.

**Decisão de execução:** o MVP começa com **SNES**. Só avançar de uma PoC operacional para biblioteca/design avançado após comprovar áudio, gamepad, desempenho e comportamento do armazenamento na TV. Atari 2600 e Mega Drive vêm depois; PS1 é um experimento sem compromisso de entrega.

**Decisão de produto:** identidade visual própria **Super Flip CB**; a antiga designação de trabalho “Retroverse” deixa de ser o nome do aplicativo. Direção principal **16-bit / pixel arcade**, com referências complementares a Atari e PS1, sem imitar marcas, logos ou sprites proprietários.

**Estado de validação:** nenhuma medição nova na TV foi executada neste planejamento. Os *gates* abaixo são **critérios propostos**, não resultados de benchmark.

---

## 1. Revisão crítica do researching

### 1.1. Achados preservados

1. O requisito definidor é **executar o jogo na TV**, armazenando ROMs e saves na LAN. Não é um projeto de streaming de vídeo, cloud gaming ou emulação no PC.
2. O sistema observado em Developer Mode tem um sandbox restrito (`prisoner`/`jailer`). Os **129,2 MiB livres observados** são de um filesystem específico, **não** representam a RAM livre nem todo o armazenamento físico.
3. A LG documenta Chromium 132 para webOS TV 26 e resolução gráfica de aplicativos web de até 1920×1080. **Desempenho WASM/Gamepad API ainda depende do hardware real.**
4. O padrão oficial de **Hosted Web App** é um `.ipk` com página local de redirecionamento para servidor remoto; para o nosso caso, a URL remota será um endereço **privado da LAN**.
5. O EmulatorJS recomenda `iframe` para integração com React/SPA e oferece cores SNES, Atari, Mega Drive e PS1; porém isso **não demonstra compatibilidade/performance na LG**.
6. O emulador pode usar IndexedDB para ROMs, BIOS e cores. A documentação situa `EJS_cacheConfig` **após** a versão 4.2.3, enquanto 4.2.3 ainda aparece como release estável; não presumir que a configuração de desativação funcionará na versão candidata.
7. `FileResponse` + `Range` permite entrega de bytes parciais pelo servidor, mas **não garante streaming de setores de um disco PS1** no core WASM.
8. A instalação particular via Developer Mode **não equivale a distribuição permanente via loja LG**. A sessão de desenvolvimento precisa ser renovada conforme o processo oficial.

### 1.2. Ajustes que este planning introduz

- **Hospedagem não é uma escolha binária Firebase vs Render:** ambos são nuvens externas, enquanto os arquivos e a emulação devem permanecer no ambiente doméstico. A opção local é estrutural, não apenas uma preferência de custo.
- **Não separar UI na nuvem e API na LAN no MVP:** além de CORS e latência, há políticas de acesso à rede privada, conteúdo misto e diferenças por versão do Chromium. A política moderna do Chrome sobre Local Network Access **não deve ser presumida idêntica ao Chromium 132 embarcado no webOS**. Mesmo domínio, esquema e porta na LAN evitam boa parte do problema.
- **Shell offline:** um hosted app cujo `index.html` apenas redireciona não garante uma bela tela offline. Planejar fallback local simples no launcher e validar o tempo/comportamento do redirecionamento; se a experiência for ruim, mudar para *packaged shell* leve.
- **Gamepad como bloqueador real:** a UI ser navegável pelo Magic Remote não demonstra que o SNES será jogável com controle. Ter um gamepad concreto disponível e medir seus eventos é requisito antes de declarar o MVP viável.
- **Persistência antes de catálogo elaborado:** a capacidade de salvar/recuperar progresso é condição para uso real; se callbacks remotos não forem confiáveis, admitir solução provisória com exportação/importação explícitas sem prometer autosync.
- **Licenças:** o projeto pode integrar componentes GPL, mas qualquer redistribuição deve ser avaliada; não colocar ROMs, BIOS nem material comercial sem autorização no repositório ou em hospedagem pública.

---

## 2. ADR-001 — Decisão formal de hospedagem

### 2.1. Matriz de decisão

| Critério | **LAN + FastAPI** | Firebase Hosting / Cloud Run | Render Web Service |
|---|---|---|---|
| ROMs disponíveis no PC/NAS sem publicação externa | **Sim, direto** | Não; exigiria sincronização, túnel ou ponte local | Não; exigiria sincronização, túnel ou ponte local |
| Interface e API no mesmo origin da TV | **Sim** | Possível na nuvem, mas não incluindo ROMs locais por padrão | Possível na nuvem, mas não incluindo ROMs locais por padrão |
| Funcionar sem internet externa | **Sim**, com rede local ativa | Não como arquitetura principal | Não como arquitetura principal |
| FastAPI Python | **Sim** | Via Cloud Run, com integração e faturamento | **Sim**, hospedagem gerenciada |
| Persistência de saves em disco doméstico | **Sim** | Necessitaria serviço de storage adicional | Necessitaria disco persistente pago ou storage externo |
| Transferência de discos grandes | Tráfego LAN | Saída de dados pela internet; quotas/custos | Saída de dados pela internet; quotas/custos |
| Operação/atualização | PC/NAS deve estar ligado | Deploy remoto | Deploy remoto; free tier hiberna |
| Complexidade para uso pessoal | **Baixa** | Desnecessária para este objetivo | Desnecessária para este objetivo |

### 2.2. Decisão aprovada

**MVP:** PC Windows na mesma rede da LG, `FastAPI + Uvicorn + build Vite + EmulatorJS self-hosted`. Porta de referência `8787`, configurável. URL ilustrativa: `http://192.168.x.y:8787/` (não substituir por IP sem descobrir/reservar o endereço verdadeiro).

**Evolução operacional:** mesmo servidor pode migrar do Windows para NAS/mini-PC sem mudar os contratos HTTP. Docker Compose será **opcional**, nunca requisito inicial.

**Firebase, se houver necessidade futura:** página pública de documentação, telemetria consentida ou sincronização remota de configurações/saves pequenos. **Não** hospedar ROMs em Firebase Hosting como opção padrão.

**Render, se houver necessidade futura:** dashboard/API pública complementar, se existir uma razão clara para expor um backend à internet. **Não** usar como gateway obrigatório para sessões domésticas.

**Reabrir ADR-001 somente se:** o requisito mudar para **jogar fora da rede doméstica** ou **dispensar totalmente um servidor local**; isso exigiria redesenhar segurança, transporte, armazenamento e possivelmente emulação.

---

## 3. Escopo funcional e requisitos do MVP

### 3.1. Perfil do usuário e jornada principal

**Único usuário / residência / uma TV.** Sem cadastro, autenticação online, multiplayers, loja de conteúdo ou sincronização multiusuário.

**Jornada:** ligar servidor → abrir **Super Flip CB** pelo Home da LG → visualizar estado da rede → entrar em **SNES** → selecionar ROM de teste → iniciar jogo → jogar com gamepad → abrir comando de saída/pausa → salvar/restaurar quando houver suporte verificado → voltar à biblioteca mantendo foco anterior.

### 3.2. Escopo do MVP SNES — P0

- Launcher `.ipk` com identidade Super Flip CB e abertura confiável da URL LAN.
- Diagnóstico mínimo do hardware, rede, APIs de áudio/input e capacidades WASM.
- Home enxuta; seção SNES; biblioteca a partir do catálogo local, inclusive estados vazios.
- Carregamento de **uma ou mais ROMs SNES legitimamente obtidas** por URL HTTP; suporte inicial a `.sfc`/`.smc` **dependente da release selecionada**.
- Player SNES em `iframe` isolado, com controle, áudio, retorno à biblioteca e tratamento de falha.
- Estados: servidor indisponível, ROM não encontrada, core não inicializa, gamepad não reconhecido.
- Inspeção e controle do cache persistente de ROMs na TV.
- Save normal ou estratégia provisória explicitamente documentada, validada por fechamento/reabertura; save state é objetivo subsequente se a API responder corretamente.
- Design 10-foot em PT-BR, navegação por controle remoto sem teclado e por pelo menos um gamepad real.

### 3.3. MVP+ — após os gates P0

- Favoritos/recentes, busca, cards com capas otimizadas.
- Saves por slot, restauração e backup com tratamento de conflitos.
- Atari 2600 (Stella2014), Mega Drive (Genesis Plus GX), somente após *spikes* individuais.
- Menu in-game próprio e refinamentos de motion pixel art.

### 3.4. Experimentos / fora do compromisso

- PS1 PCSX ReARMed, preferencialmente CHD, com memória, formato, áudio, BIOS, multidisco e saves comprovados.
- GBA, thumbnails automáticas, gamepad remapping avançado, mini-PC, Docker, TLS local, HLS/streaming, cloud sync.
- Fora de escopo: distribuição pública de ROMs, root, montagem SMB dentro do sandbox, reimplementação de emuladores, N64/PS2/PSP e execução remota no servidor.

---

## 4. Arquitetura de referência

```text
                         REDE DOMÉSTICA
  ┌──────────────────────────────────────────────────────┐
  │ PC Windows / futuro NAS      SERVIDOR LOCAL          │
  │                                                      │
  │  FastAPI + Uvicorn :8787                              │
  │  ├─ GET /                     → React/Vite build      │
  │  ├─ GET /player/              → HTML isolado          │
  │  ├─ GET /emulatorjs/data/     → EmulatorJS JS/WASM    │
  │  ├─ GET /api/...              → Catálogo e metadados  │
  │  ├─ GET /api/.../rom          → ROM por HTTP          │
  │  └─ GET/PUT /api/.../saves    → Saves + backups       │
  │                                                      │
  │  ./data [fora do Git]                                 │
  │  ├─ roms/, bios/, covers/, saves/, backups/           │
  │  └─ catalog.sqlite [quando necessário]               │
  └───────────────────┬──────────────────────────────────┘
                      │ HTTP same-origin na LAN
                      │
  ┌───────────────────▼──────────────────────────────────┐
  │ LG webOS 26 / 55QNED70BSA                            │
  │  Hosted launcher .ipk                                 │
  │      └─ React + TS + UI 1920×1080                    │
  │           ├─ InputRouter: Magic Remote / gamepad      │
  │           ├─ Library                                  │
  │           └─ PlayerAdapter → iframe EmulatorJS WASM │
  │                └─ CPU/GPU/áudio do emulador NA TV     │
  └──────────────────────────────────────────────────────┘
```

### 4.1. Fronteiras e responsabilidade

| Camada | Faz | Não faz |
|---|---|---|
| `webos-launcher` | Identidade, ícones, `appinfo.json`, redirecionar, diagnóstico/offline simples | Emular, carregar catálogo completo |
| `tv-client` | UI, foco, fluxo do jogador, estados de tela, leitura de API | Ler arquivos do PC diretamente; embutir dados privados no build |
| `player-adapter` | Isolar engine, sessões, `iframe`, input/saída, mensagens e eventos de saves | Expor detalhes globais do EmulatorJS para o resto da UI |
| `server/app` | Servir UI/Core/ROM, catalogar, persistir saves, validar paths, logar | Executar Snes9x no PC; transcodificar ou enviar vídeo |
| `storage` | ROMs e BIOS read-only, saves atomizados e backups | Estar em Git, ficar público na internet |

**Contrato de comunicação interna:** `postMessage` com `type`, `requestId`, `gameId` e `payload`; validar `event.origin === location.origin` **e** `event.source === iframe.contentWindow` antes de processar mensagens. A existência das APIs necessárias da engine deve ser confirmada antes de implementar o adaptador definitivo.

**Fluxo de dados:** download de ROM para memória de trabalho da TV, sem persistência **intencional** do arquivo. Isto **não** significa zero RAM usada, zero cache de engine ou zero arquivos temporários do webOS.

### 4.2. Estrutura do repositório

```text
super-flip-cb/
├─ apps/
│  ├─ webos-launcher/         # .ipk com appinfo.json, redirect e fallback
│  └─ tv-client/
│     ├─ src/
│     │  ├─ app/              # rotas, composição e error boundary
│     │  ├─ design-system/    # tokens, fontes, pixel primitives
│     │  ├─ components/       # PixelButton, GameCard, ConsoleTile...
│     │  ├─ features/
│     │  │  ├─ home/
│     │  │  ├─ library/
│     │  │  ├─ player/
│     │  │  ├─ settings/
│     │  │  └─ diagnostics/
│     │  ├─ input/            # mapa/foco, gamepad e back handling
│     │  ├─ platform/webos/   # app lifecycle, platform adapter
│     │  └─ services/api/
│     └─ public/player/      # entrada HTML isolada; assets de runtime separados
├─ server/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ api/{health,systems,games,saves}.py
│  │  ├─ catalog/
│  │  ├─ storage/
│  │  ├─ schemas/
│  │  └─ config.py
│  ├─ tests/
│  └─ pyproject.toml
├─ vendor/                     # artefatos permitidos/pinados, licenças
├─ assets/{brand,icons,fonts,licenses}/
├─ docs/{researching.md,planning.md,hardware-tests.md,design-system.md,decisions/}
├─ scripts/{dev,build,package,deploy,diagnose,backup}/
├─ data/                       # GITIGNORED; raiz configurável no host
│  ├─ roms/{snes,atari2600,megadrive,ps1}/
│  ├─ bios/
│  ├─ covers/
│  ├─ saves/
│  └─ backups/
├─ .github/workflows/ci.yml
├─ .gitignore
└─ README.md
```

**Sem monorepo framework especial inicialmente.** `npm` workspaces só se houver pacotes JS compartilhados. `data/` pode estar fora da pasta do repositório; garantir configuração por caminho absoluto e nunca fazer `git add` de conteúdo privado.

---

## 5. Stack, dependências e política de versionamento

| Área | Escolha | Situação de pin |
|---|---|---|
| Runtime JS/build | **Node.js 24 LTS** | **24.21.0** é baseline documental verificada; testar toolchain Windows |
| CLI webOS | `@webos-tools/cli` | **3.2.6** verificada na página oficial de releases |
| UI | React + TypeScript | Estabelecidos como stack; versão exata a congelar em `package-lock.json` na inicialização |
| Bundler | Vite | **8.3.4** listada na página npm consultada; testar build sob Node 24 |
| Estilos | CSS Modules + CSS Custom Properties | Sem dependência obrigatória de biblioteca UI |
| Rotas | Router mínimo (ou React Router, se necessário) | Condicional ao fluxo real; não introduzir prematuramente |
| Emulação | EmulatorJS + Snes9x WASM | **4.2.3 candidata**, não aprovada até verificar política de cache e desempenho |
| Python | Python 3.13 (linha proposta) | Fixar *patch* no arquivo de toolchain após instalar/testar |
| API | FastAPI + Uvicorn | **FastAPI 0.143.3** verificada em notas oficiais; congelar Uvicorn/transitivas no lock |
| Ambiente Python | `uv` + `uv.lock` | Lock reprodutível, `pyproject.toml` no servidor |
| Banco | Nenhum na PoC; JSON/manifest no MVP mínimo | SQLite quando metadados mutáveis justificarem; evita infraestrutura extra |
| Testes | Pytest; Vitest; Playwright desktop; testes manuais LG | Versões congeladas em lockfiles no bootstrap |
| CI | GitHub Actions | Lint, types, tests, build; **sem deploy público automático** |

**Política de pins:** números acima são referências verificadas em 17/10/2026, **não compõem um ambiente já instalado/testado**. Antes do primeiro código, gerar `package-lock.json`, `uv.lock`, `engines`, `.nvmrc`/`.node-version`, documento de licença e registrar versões de React, React DOM, TypeScript, Uvicorn, Starlette e plugins em `docs/decisions/ADR-versions.md`. Não usar `latest` em produção; manter atualizações separadas de mudanças funcionais.

**EmulatorJS:** não misturar a API nova documentada para versões *posteriores a 4.2.3* com o bundle estável 4.2.3. Investigar opções reais do tag selecionado. Se desativar cache não for confiável, comparar *pre-release* em ramo de experimento ou engine alternativa **antes** de aprovar o MVP.

---

## 6. Contrato HTTP inicial (API v1)

**Base:** `http://<IP-PRIVADO>:8787`, única origem para SPA, `iframe`, API, cores e arquivos. FastAPI deve expor OpenAPI em `/openapi.json` durante desenvolvimento, com documentação acessível somente na LAN.

| Método | Endpoint | Função | Etapa |
|---|---|---|---|
| `GET` | `/api/health` | Estado e versão do servidor, sem dados sensíveis | PoC |
| `GET` | `/api/capabilities` | Sistemas/cores configurados; formatos e avisos | PoC |
| `GET` | `/api/systems` | Lista dos consoles liberados | MVP |
| `GET` | `/api/games?system=snes&page=1&pageSize=24&search=` | Catálogo paginado; metadados seguros | MVP |
| `GET` | `/api/games/{gameId}` | Detalhes do jogo | MVP |
| `GET`, `HEAD` | `/api/games/{gameId}/rom` | ROM por ID, content length, range quando aplicável | PoC |
| `GET` | `/api/games/{gameId}/cover` | Thumbnail local, com fallback | MVP+ |
| `GET` | `/api/games/{gameId}/saves/{slot}` | Recuperação de save, se suportado | Spike/MVP |
| `PUT` | `/api/games/{gameId}/saves/{slot}` | Gravação binária segura, checksum/versão | Spike/MVP |
| `GET`, `PUT` | `/api/games/{gameId}/states/{slot}` | Save state, quando engine validar | MVP+ |

**Não criar `/api/games/{id}/bios` genericamente sem modelar múltiplas BIOS/regiões.** Preferir um `BiosResolver` interno e uma rota específica somente se o core exigir URL. Catálogo publica URLs resolvidas, nunca caminhos absolutos do Windows. Para PS1, modelar `discs[]` explicitamente e criar endpoint de disco **quando** o experimento justificar.

### 6.1. Modelos de dados propostos

```ts
type ConsoleId = 'snes' | 'atari2600' | 'megadrive' | 'ps1';
type GameId = string;

interface GameSummary {
  id: GameId;
  title: string;
  system: ConsoleId;
  core: string;
  media: {
    url: string;
    format: string;
    sizeBytes: number;
  };
  coverUrl: string | null;
  favorite: boolean;
  lastPlayedAt: string | null;
}

interface SaveMetadata {
  gameId: GameId;
  slot: string;
  kind: 'sram' | 'state';
  coreId: string;
  coreVersion: string;
  updatedAt: string;
  sha256: string;
  sizeBytes: number;
}
```

**Catálogo:** inicialmente manifesto gerado a partir de diretórios aceitos, com ID estável derivado de `console + identificador de conteúdo` (definir colisões e atualização quando arquivo muda). Não usar nome de arquivo bruto como chave pública; não assumir que título/capa podem ser extraídos sem metadados adicionais.

**Protocolo:** JSON para catálogo/status, binário (`application/octet-stream`) para ROMs e saves. Servir ROMs com `Content-Disposition`/`Content-Type` apropriados, `HEAD`, `ETag`, `Content-Length` e `Range` **sem afirmar que o core fará streaming parcial**. Preferir `Cache-Control: no-store` para ROMs como proteção adicional, **não** substituto de auditoria IndexedDB.

### 6.2. Erros previsíveis

| Código | Significado na API | Estado exibido na TV |
|---|---|---|
| 404 | Game ID/arquivo inexistente | “Jogo indisponível” |
| 409 | Conflito de versão de save | “Progresso alterado; escolha como recuperar” |
| 413 | Save excedeu limite permitido | “Não foi possível salvar” |
| 416 | Range inválido | Erro técnico no diagnóstico |
| 500 | Falha interna | “Erro no servidor”; oferecer retorno |
| Falha de rede | Servidor offline ou LAN indisponível | “Sem conexão com a biblioteca” + reconectar |

---

## 7. Política de saves, estados e recuperação

1. **Prioridade:** preservar progresso, mesmo diante de standby, encerramento abrupto ou servidor temporariamente indisponível.
2. **Fonte de verdade ideal:** arquivos no servidor, com metadados incluindo jogo, console, core, versão, tipo e slot.
3. **Escrita no servidor:** validar ID/slot/tamanho, gravar em temporário **na mesma unidade**, forçar persistência quando adequado, fazer rename atômico e manter backup anterior. Evitar sobrescrever silenciosamente estados incompatíveis.
4. **Concorrência:** entregar `ETag`/versão; verificar `If-Match` no `PUT` onde o cliente puder usá-lo; responder `409/412` se houver conflito e preservar ambos os saves.
5. **Disparo:** usar eventos públicos `EJS_onSaveUpdate`/state **somente após** confirmar que funcionam na versão instalada. Nunca confiar apenas em `beforeunload` ou em finalização normal do app.
6. **Offline:** qualquer tentativa de autosync sem servidor precisa de uma fila **limitada**, sem crescimento persistente de ROMs; não prometer fila durável antes de testar limites do webOS.
7. **Plano de contingência:** se o EmulatorJS não expuser restore persistente confiável, MVP técnico pode demonstrar **export/import manual de saves**, desde que declarado como limitação; versão jogável para uso contínuo exige fechar esse gap antes de “MVP pronto”.
8. **Backup:** cópia diária/manual dos saves do PC para outro diretório/dispositivo; testar restauração de uma gravação antes de confiar no procedimento.

---

## 8. Estratégia de rede, segurança e operação local

- **PC e LG na mesma LAN/sub-rede com tráfego entre clientes permitido**. Evitar rede de convidados / AP isolation.
- Usar **reserva DHCP** para IP do PC (ou nome local confiável) e evitar hardcode difícil de corrigir na TV. Um hosted launcher com URL fixa pode requerer reinstalação quando o IP muda; prever configuração de endpoint em revisão futura.
- Iniciar API com `0.0.0.0` somente quando necessário à TV, com firewall Windows liberando a porta **apenas para rede privada** e, idealmente, para o IP da TV/sub-rede.
- **Sem port-forward, túnel público ou URL externa** para ROMs e saves.
- Implementar resolução por ID de catálogo; validar `Path.resolve()` e raízes permitidas, bloquear travessia de diretórios/symlinks inesperados.
- Restringir escrita a `/saves`, validar tamanhos e tipos; não oferecer API pública para mover/apagar arquivos arbitrários.
- Verificar `Origin`/`Host` e cabeçalhos relevantes de chamadas de escrita; CORS não é um mecanismo de autenticação. Token local, se necessário, precisa ser tratado como controle contra outras máquinas da LAN, **não** segredo embutido no JS.
- Não ativar Service Worker/PWA que armazene ROMs; evitar caches persistentes inadvertidos. Inspecionar IndexedDB/Cache Storage.
- **HTTP local** é o padrão provisório e simples. HTTPS local só após necessidade comprovada (segurança reforçada ou APIs que dependam de contexto seguro); certificados devem ser confiáveis no webOS. Não presumir que regras atuais do Chrome desktop se comportam igualmente no motor embarcado.
- Backend deve responder `/api/health` rápido e apresentar mensagem de reconexão quando desativado. Se PC estiver desligado, a TV não poderá iniciar jogos; o shell pode mostrar erro/fallback.
- Manter procedimento de renovação do Developer Mode; **não** planejar instalação privada como permanentemente isenta de expiração.

### Operação Windows — primeira versão

1. Executar `scripts/dev/start-server.ps1` com diretório de dados configurado e console visível.
2. Verificar `http://localhost:8787/api/health` no PC e `http://<IP-LAN>:8787/api/health` em dispositivo na mesma rede.
3. Reservar IP do PC no roteador e registrar URL no arquivo de configuração do launcher (exemplo, não no código distribuível).
4. Empacotar/instalar com CLI webOS, validar o Home e o controle remoto.
5. Em evolução, oferecer inicialização automática do backend via Agendador de Tarefas/serviço gerenciado; não começar com essa complexidade.
6. Fazer backup da pasta de saves, conferir espaço do servidor, testar recuperação pós-reboot da TV e pós-restart do PC.

---

## 9. Design system — Super Flip CB

### 9.1. Direção aprovada como baseline de planejamento

**Nome na tela e launcher:** `Super Flip CB`  
**Tom:** console retrô pessoal, inspirado em 16-bit, visual moderno e legível à distância.  
**Resolução de projeto:** canvas lógico 1920×1080; verificar resolução efetiva e `devicePixelRatio` na LG.  
**Referências por console:** SNES roxo, Atari laranja, Mega Drive verde-água, PS1 azul, sem copiar trademarks.

Tokens candidatos herdados do researching (ainda pendentes de contraste/validação visual na TV):

| Token | Cor | Uso |
|---|---|---|
| `--color-bg` | `#101321` | Background |
| `--color-surface` | `#1B2034` | Painéis |
| `--color-text` | `#F5F1E8` | Títulos e texto |
| `--color-muted` | `#ADB7CC` | Secundário |
| `--color-focus` | `#F9DB6D` | Foco de navegação |
| `--accent-snes` | `#A889F7` | Console SNES |
| `--accent-atari` | `#F48A52` | Atari |
| `--accent-megadrive` | `#63D4BD` | Mega Drive |
| `--accent-ps1` | `#65B6E8` | PlayStation |

**Tipografia:** `Pixelify Sans` em destaques curtos, com família sans legível (ex. Archivo) para corpo; `Press Start 2P` opcional em título/logotipo curto após teste. Fontes self-hosted e licenças registradas. Não tornar toda a interface pixelada se isso comprometer legibilidade.

**Motion:** 100–180 ms em menus; foco fortemente visível e independente de hover; preferir `transform`/`opacity`. Sem filtros CRT pesados, blur ou animação contínua durante o jogo. Respeitar redução de movimento quando aplicável.

### 9.2. Layout da Home (wireframe textual)

```text
╔════════════════════════════════════════════════════════════════════╗
║ SUPER FLIP CB                    ● SERVIDOR ONLINE       ⚙ AJUSTES ║
╠════════════════════════════════════════════════════════════════════╣
║                         CONTINUE JOGANDO                           ║
║       [ ARTE DO JOGO ]          [ CONTINUAR ]     SNES              ║
║                                                                    ║
║                         ESCOLHA O CONSOLE                          ║
║                 [ SNES ]    [ ATARI ]   [ MEGA ]    [ PS1* ]        ║
║                                                                    ║
║                         BIBLIOTECA SNES                            ║
║         [ CARTÃO ]     [ CARTÃO ]     [ CARTÃO ]     [ CARTÃO ]     ║
║                                                                    ║
║     ◀ VOLTAR                   OK SELECIONAR          START MENU   ║
╚════════════════════════════════════════════════════════════════════╝
* Console PS1 oculto ou marcado experimental até passar no benchmark.
```

**Tela do Player:** jogo 4:3 centralizado sem distorção; overlay independente (pausa, save/load se validado, controles, voltar). Não obrigar controle remoto como input para o gameplay. Mostrar estado de carregamento/erro de forma acessível.

**Componentes prioritários:** `PixelButton`, `FocusRing`, `GameCard`, `ConsoleTile`, `StatusChip`, `EmptyState`, `LoadingTiles`, `OnScreenHelp`, `EmulatorOverlay`; incluir estados `idle`, `focused`, `selected`, `disabled`, `loading`, `error`.

### 9.3. Foco e navegação por controle

```text
[HOME] --OK--> [LISTA SNES] --OK--> [DETALHES] --JOGAR--> [PLAYER]
  ^                 |                |                    |
  |               BACK             BACK              MENU/SAIR
  +-----------------+----------------+--------------------+
```

- **Menu:** setas/OK/Back devem funcionar sempre. Implementar `FocusManager` com navegação espacial, estado por tela, rolagem ao elemento focado e restauração de foco ao retornar.
- **Gamepad:** abstrair `InputAdapter` para teclado/eventos HID. Testar `cloudgame_active: false` (teclas traduzidas) e `true` (leitura direta) em builds comparativas; registrar mapa real.
- **Durante jogo:** o gameplay detém input; definir combinação de pausa/saída que não conflite com controles do emulador. A transição `iframe` → UI deve devolver foco ao último card.
- **Acessibilidade:** texto com tamanho confortável a 2–3 m, foco por contraste/contorno e não apenas cor; legibilidade testada na TV.

---

## 10. Spikes técnicos e gates GO / NO-GO (ordem obrigatória)

**Toda tarefa a seguir é um experimento executado na LG real.** Documentar em `docs/hardware-tests.md`: data, firmware, versão do CLI, core e bundle, controle usado, arquivo de teste, rede, resultado, logs/capturas e decisão.

| ID | Experimento | Evidência exigida | Gate de aceite / decisão |
|---|---|---|---|
| **S0** | Ambiente e IPK básico | CLI instalada, IPK abre Home, redireciona LAN e exibe erro offline | **GO** se fluxo inicial confiável; senão testar packaged shell |
| **S1** | APIs e input no hardware | `navigator.getGamepads()`, `keydown`, WebAssembly, áudio, `innerWidth`, WebGL; mapeamento remoto/controle | **GO** se um gamepad efetivamente controla UI/jogo; senão investigar flags/HID |
| **S2** | EmulatorJS + SNES | Core Snes9x carrega ROM de teste via HTTP, vídeo e áudio | **NO-GO** se não jogar na TV; comparar alternativa antes da UI completa |
| **S3** | Qualidade de jogo | Taxa de quadros do core (quando exposta), áudio, latência percebida; sessão ≥30 min | **GO** se velocidade nominal e áudio utilizável de forma sustentada; não depender só de FPS de UI |
| **S4** | Cache/storage | 5 ROMs diferentes, inspeção de IndexedDB, Cache Storage e armazenamento após sair/reabrir | **NO-GO** se ROMs persistirem sem mecanismo confiável de limpeza/desativação |
| **S5** | Save e retomada | Save, sair, fechar, reiniciar app, restaurar; checksum e backup no servidor quando viável | **GO** para MVP utilizável só com recuperação confiável ou limitação/solução alternativa formalmente aceite |
| **S6** | Lifecycle/rede | Suspend/resume/Home/standby; desligar/religar backend | **GO** se não há perda silenciosa de progresso e há recuperação clara |
| **S7** | Comparação engine | EmulatorJS vs webЯcade, mesma ROM e controle | Mudar engine apenas se obtiver ganho relevante ou resolver bloqueador |
| **S8** | PS1 experimental | PCSX, BIOS, CHD, áudio, RAM/tempos/estabilidade | Não bloqueia MVP; habilitar só com evidência |

### 10.1. Métricas e limites iniciais

- **Performance:** SNES NTSC busca ~60 fps / PAL ~50 fps no jogo; registrar a fonte da medida e se o core efetivamente oferece indicador; medir áudio e jogabilidade, não apenas `requestAnimationFrame`.
- **Estabilidade:** sessão sustentada de 30 min como *gate mínimo*; repetir 60 min antes de considerar uso prolongado aprovado.
- **Memória:** não inventar teto de RAM. Se API de medição não existir no webOS, registrar sinais indiretos (crashes, reloads, logs) e possíveis ferramentas oficiais de resource monitor.
- **Armazenamento:** objetivo é **nenhuma biblioteca de ROMs persistida** na TV; bytes de runtime e saves mínimos são toleráveis se documentados. Registrar antes/depois, com limitação de visibilidade.
- **Usabilidade:** 100% das telas principais acessíveis por setas/OK/Voltar e recuperação de foco; validar a 2–3 m.
- **Rede:** teste deliberado de servidor offline, IP inválido, 404 e transferência interrompida.

### 10.2. Decisão se SNES WASM reprovar

1. **Corrigir fatores simples:** engine/core alternativo, modo de input, áudio, assets reduzidos, desligar recursos custosos e reproduzir benchmark.
2. Comparar **webЯcade** num protótipo mínimo idêntico.
3. **Se WASM não for viável na LG:** suspender o desenvolvimento da UI completa. Investigar RetroArch nativo existente com importação temporária via HTTP ou integração libretro/VFS como **outra arquitetura**, com custo e limitações próprias.
4. **Não** declarar que Firebase/Render resolvem baixo FPS: hospedagem dos arquivos não aumenta a capacidade computacional local da TV.

---

## 11. Backlog de implementação e dependências

### EPIC E0 — Fundação técnica (gate antes do produto)

- [ ] **E0-01** Preparar Node LTS, Python/uv, CLI webOS, versões e scripts PowerShell reproduzíveis.
- [ ] **E0-02** Criar launcher Super Flip CB, ícones provisórios e `appinfo.json` com ID reverso-DNS **provisório** `com.superflipcb.app`; confirmar unicidade antes de publicação.
- [ ] **E0-03** Implementar microservidor FastAPI com `/api/health`, uma ROM de teste e UI mínima.
- [ ] **E0-04** Criar painel de diagnóstico na TV, medir resoluções, APIs e input.
- [ ] **E0-05** Integrar EmulatorJS isolado; testes de SNES, cache e save.
- [ ] **E0-06** Documentar gates S0–S6 com evidências e decisão GO/NO-GO.

**Dependências:** E0-01 → E0-02/E0-03 → E0-04/E0-05 → E0-06.  
**Definition of Done:** SNES inicia e é jogável na LG com gamepad, saída confiável, controle de cache e plano de saves comprovado.

### EPIC E1 — Fundação do produto (após GO técnico)

- [ ] **E1-01** Criar `super-flip-cb` com pastas da seção 4.2, `.gitignore`, `README`, configurações de dev e CI.
- [ ] **E1-02** Definir contratos Pydantic/OpenAPI e clientes TypeScript; testes de contrato.
- [ ] **E1-03** Indexação segura de catálogo de ROMs SNES e manifest local; IDs estáveis.
- [ ] **E1-04** Criar `PlayerAdapter` com contrato pequeno `load/pause/resume/exit/save` apenas para operações realmente suportadas.
- [ ] **E1-05** Criar `InputRouter` + `FocusManager` e testes de navegação/foco.

### EPIC E2 — Interface e design system

- [ ] **E2-01** Brand kit Super Flip CB: logo, ícone 80×80/130×130, splash e manifesto de licenças.
- [ ] **E2-02** Tokens CSS/fonte e componentes `PixelButton`, `FocusRing`, `PixelPanel`, `GameCard`, `ConsoleTile`.
- [ ] **E2-03** Home, biblioteca, detalhes e estados offline/erro.
- [ ] **E2-04** Player/overlay 4:3, loading real, retorno com restauração de foco.
- [ ] **E2-05** Testes de legibilidade/motion na TV e correções de contraste.

### EPIC E3 — Saves e robustez

- [ ] **E3-01** Avaliar callbacks reais e arquivos gerados, documentar compatibilidade.
- [ ] **E3-02** API de saves com writes atômicos, backups, conflito e testes de corrupção.
- [ ] **E3-03** Recovery de sessão, reinicialização, gamepad reconectado, backend offline.
- [ ] **E3-04** Diagnósticos/export de logs técnicos anonimizados.

### EPIC E4 — Deploy e operações domésticas

- [ ] **E4-01** Gerar build de UI e integrá-lo com static hosting do FastAPI.
- [ ] **E4-02** Script reproduzível `package/deploy` com webOS CLI e instruções do Dev Manager.
- [ ] **E4-03** Reserva DHCP e firewall de rede privada; operacionalizar backups.
- [ ] **E4-04** Guia de reinstalação, update e renovação Developer Mode.
- [ ] **E4-05** Release local `v0.1.0` somente após checklist completo do MVP.

### EPIC E5 — Expansão (somente depois do MVP)

- [ ] **E5-01** Atari 2600 — spike core + input + saves.
- [ ] **E5-02** Mega Drive — spike Genesis Plus GX + controles + saves.
- [ ] **E5-03** PS1 — orçamento de memória, formato CHD, BIOS e multidisco; release flag `experimental`.
- [ ] **E5-04** Favoritos, recentes, busca e capas licenciadas/autorais.
- [ ] **E5-05** Avaliar serviço doméstico em NAS/mini-PC e Cloud opcional **sem alterar a dependência da LAN para ROMs**.

---

## 12. Testes, qualidade e CI

### 12.1. Testes automatizáveis fora da TV

- **Backend:** pytest cobrindo 200/404/409/413/416, `HEAD`/`Range`, proibição de path traversal e symlinks, atomicidade dos saves, erros de IO, IDs inválidos e catálogo não exposto.
- **Frontend:** testes de `InputRouter`, `FocusManager`, navegação Back, restauração de foco, estados vazios/erro, labels e renderização em 1920×1080.
- **Integração:** Playwright em desktop para fluxo catálogo → player stub → sair; uso de fixture sem conteúdo protegido.
- **Contrato:** schemas de Game/Save versionados, testes que verifiquem clientes contra OpenAPI.
- **Bundle:** verificar build sem import remoto obrigatório (fontes, JS, WASM), sem mapas de fonte ou secrets inadvertidos no IPK público.
- **Qualidade:** TypeScript strict, ESLint, formatador; Python Ruff e teste unitário. Evitar travar o projeto com arquitetura genérica e abstrações não utilizadas.

### 12.2. Testes que necessariamente dependem da LG real

- Gamepad HID/teclas, áudio/autoplay, performance do Snes9x, tamanho e cache real, lifecycle, Back/Home e foco dentro de `iframe`.
- Rede LAN da residência, alcance do Wi-Fi/Ethernet, firewall/roteador e eventual política do navegador webOS.
- Recursos de dispositivo sem telemetria externa e sem inferir RAM por APIs não disponíveis.

### 12.3. CI e releases

**Pipeline GitHub Actions:** `lint → typecheck → unit tests → API tests → build`. Gerar `.ipk` como artefato opcional em job de empacotamento. **Não** publicar ROMs, BIOS, saves ou `.env`. CI **não substitui** aceite hardware e não faz deploy automático da instalação na TV.

**Semver:** `v0.0.x` provas técnicas, `v0.1.0` MVP SNES, `v0.2.0` polimento/catálogo, `v0.3.0` plataformas adicionais **apenas como rótulos indicativos, não cronograma ou promessa de compatibilidade**.

---

## 13. Critérios de aceite finais do MVP

- [ ] Nome, ícone e splash identificados como **Super Flip CB**.
- [ ] `.ipk` abre pelo Home LG e o app comunica estado online/offline com clareza.
- [ ] Jogo SNES carregado de ROM na LAN, sem copiar arquivo intencionalmente para o armazenamento persistente da TV.
- [ ] Gameplay com gamepad físico, áudio íntegro, velocidade nominal aceitável e sessão prolongada validada.
- [ ] Biblioteca navegável por setas/OK/Voltar; foco mantido/recuperado entre telas e `iframe`.
- [ ] Cache da engine/ROM auditado; se não houver forma confiável de limitar ROMs persistentes, **MVP não aprovado**.
- [ ] Save com reabertura/restauração funcional; se solução for manual, limitação declarada e decisão de produto registrada.
- [ ] Backend protege caminhos privados, ROMs/BIOS/saves fora do Git e LAN não exposta à internet.
- [ ] Falhas de servidor/ROM/core são tratadas sem tela em branco ou perda silenciosa de progresso.
- [ ] Testes automatizados passam e relatório de hardware registra versão de firmware/core e resultados.
- [ ] Procedimento documentado para inicializar backend, renovar Developer Mode, reinstalar e recuperar saves.

---

## 14. Registro de decisões arquiteturais (ADRs)

| ADR | Status | Decisão |
|---|---|---|
| **ADR-001** | **Aprovada** | LAN + FastAPI como hospedagem principal; não Firebase/Render no MVP |
| **ADR-002** | **Aprovada para PoC** | `.ipk` hosted, com fallback/alternativa packaged shell se necessário |
| **ADR-003** | **Aprovada sob gate** | React/TS/Vite + EmulatorJS em `iframe`, sujeito a benchmark LG |
| **ADR-004** | **Aprovada** | Tudo no mesmo origin HTTP local: UI, API, ROMs e WASM |
| **ADR-005** | **Aprovada** | ROMs/BIOS/saves não entram no repositório/IPK |
| **ADR-006** | **Gate obrigatório** | ROMs não ficam em cache persistente, mediante verificação real da release |
| **ADR-007** | **Aprovada** | Primeiro SNES; Atari/Mega depois; PS1 experimental |
| **ADR-008** | **Aprovada como direção** | Design system Super Flip CB, pixel arcade 16-bit, 10-foot UI |
| **ADR-009** | **Pendente S5** | Autosync saves versus import/export controlado |
| **ADR-010** | **HTTP provisório** | HTTP LAN; HTTPS quando necessário/viável na TV |
| **ADR-011** | **Aprovada** | Sem Firebase Auth/Firestore, Redis ou PostgreSQL no MVP |
| **ADR-012** | **Pendente S1** | `cloudgame_active` e estratégia gamepad exata por build |

---

## 15. Próximo ciclo de trabalho: ordem exata recomendada

**Não iniciar o desenvolvimento do frontend completo agora.** A próxima iteração deve produzir somente a **PoC de viabilidade Super Flip CB**:

1. Criar o repositório/pastas essenciais, lockfiles e o registro de versões.
2. Executar FastAPI mínimo na LAN com `/api/health` e **uma** ROM SNES de teste, fora do Git.
3. Instalar o hosted `.ipk` Super Flip CB e abrir diagnóstico na LG.
4. Medir gamepad, APIs WASM/áudio, resolução e rede.
5. Carregar SNES por URL no EmulatorJS 4.2.3 candidato e testar jogabilidade/áudio.
6. Auditar armazenamento/cache e viabilidade de save/restauração.
7. Comparar webЯcade se houver bloqueador e registrar **GO/NO-GO**.
8. Só após GO, executar os épicos de biblioteca, identidade visual completa, saves e release.

**Entregáveis da próxima iteração:** `docs/hardware-tests.md` preenchido, PoC mínima reproduzível, build `.ipk`, relatório de benchmark/armazenamento e ADRs 003/006/009/012 revisadas.

### Pendências que dependem do ambiente do usuário, sem bloquear a escrita deste plano

- Marca/modelo do gamepad a utilizar e tipo de ligação (Bluetooth ou USB).
- Versão real do firmware e resultados das APIs na LG.
- PC Windows como servidor de uso contínuo versus futuro NAS/mini-PC.
- IP/reserva DHCP e configuração de firewall/isolamento Wi-Fi.
- Caminho de dados local e disponibilidade de ROM de teste obtida legitimamente.

---

## 16. Referências de apoio consultadas para o planning

**Base:** `docs/researching.md` (pesquisa de 17/10/2026), incluindo referências LG, EmulatorJS, FastAPI, webЯcade e licenças. Este documento registra decisões novas e não afirma ter executado testes novos na TV.

**Fontes externas verificadas nesta etapa:**

- [LG — Web App Types](https://webostv.developer.lge.com/develop/getting-started/web-app-types): hosted e packaged.
- [LG — CLI Developer Guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide): template hosted, empacotar, instalar, inspecionar.
- [LG — appinfo.json](https://webostv.developer.lge.com/develop/references/appinfo-json): `cloudgame_active`, resolution e Back.
- [LG — Web API and Web Engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine): Chromium 132 para webOS TV 26.
- [LG — Developer Mode App](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app): extensão de sessão.
- [webOS CLI releases](https://github.com/webos-tools/cli/releases): 3.2.6.
- [EmulatorJS releases](https://github.com/EmulatorJS/EmulatorJS/releases): 4.2.3 estável e 4.3.0-pre.
- [EmulatorJS embed](https://emulatorjs.org/docs/embed/): `iframe` React/SPA.
- [EmulatorJS options](https://emulatorjs.org/docs/options/): cache, saves e diferenças por versão.
- [Render — Free](https://render.com/docs/free) e [Render — Persistent Disks](https://render.com/docs/disks): spin down e persistência.
- [Firebase Hosting](https://firebase.google.com/docs/hosting/) e [Firebase + Cloud Run](https://firebase.google.com/docs/hosting/cloud-run): conteúdo estático e microsserviços.
- [Google Chrome — Local Network Access](https://developer.chrome.com/blog/local-network-access): regras atuais de Chromium (cautela: não equivalem automaticamente às do webOS 26).
- [Node.js release schedule](https://github.com/nodejs/Release): Node 24 LTS.
- [FastAPI release notes](https://fastapi.tiangolo.com/release-notes/): 0.143.3, 16/10/2026.
- [Vite npm](https://www.npmjs.com/package/vite): 8.3.4 consultada em 17/10/2026.

---

## Conclusão de planning

**Arquitetura autorizada a entrar em PoC:** `Super Flip CB hosted .ipk → UI React/TS na LG → EmulatorJS WASM na LG → FastAPI + ROMs/saves em servidor local LAN`.

**Ainda não autorizada a implementação integral do MVP:** faltam os resultados de desempenho, input, cache e saves da LG real. Não prometer suporte a PS1 antes de teste. O próximo trabalho é a **PoC técnica**, não uma nova etapa de pesquisa genérica nem deploy em Firebase/Render.
