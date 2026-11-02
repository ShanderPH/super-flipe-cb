# Validação da investigação de desempenho — 17/10/2026

**Atualização operacional autorizada posteriormente pelo usuário:** IPK `com.superflipcb.app_0.0.2_all.ipk` de 1920×1080 atualizado na `superflip-tv`, sem desinstalação. CLI confirmou `Success`; metadados instalados confirmaram versão 0.0.2, resolução e `cloudgame_active=true`. SHA-256 do pacote: `0e065d0203c80d93717e5b115ff39cd6968ef8bed1a432dd66f3593032ceab03`. Servidor iniciado em `http://192.168.15.4:8797/`, vinculado apenas ao IP privado; `/api/health`, UI e player responderam pelo PC, runtime de produção verificado e saves idênticos ao backup anterior à atualização. [Registro local completo](../artifacts/updates/ipk-20261018-023953Z/update-result.json). Nenhum launcher/jogo foi aberto para testes; sem inspector, benchmark físico, mudança de firewall ou promoção do core experimental. Esta autorização específica não autoriza futuros testes na TV.

Continuação local do overhaul: **18 Vitest, 7 runtime, 12 E2E, 20 pytest passaram; 1 pytest ignorado por permissão de symlink**. Quatro testes Node do laboratório passaram (autorização antes de conexão, FIFO/resampling/limites). ESLint, TypeScript, build, Prettier, Ruff e contrato OpenAPI passaram. Builds O3/LTO/heap32 e equivalência de 600 frames em cinco ROMs, telemetria A/V desktop e memória PS1 estão na [execução detalhada](research/performance-overhaul-execution.md). Não há aceite físico novo. Os resultados da tabela abaixo são da investigação anterior.

Branch `codex/performance-investigation`, base `a69e2f70bc69aaeb98549b9611e9c6a0abaa2e38`, remoto `ShanderPH/super-flipe-cb`. As seções posteriores são histórico e descrevem um estado Git anterior.

| Verificação desta rodada | Resultado |
|---|---|
| ESLint, TypeScript/build Vite, Prettier | Passaram |
| Vitest | **17 passaram**: input/SRAM e novos limites de profiler/lifecycle Wake Lock/Luna |
| Testes no runtime EmulatorJS real | **7 passaram**: índices/reconexão, hotkeys, SRAM, audio-off e hooks pre/postMainLoop |
| Playwright desktop | **12 passaram**, zero retries: regressões existentes e novo isolamento de saves/relatório do benchmark |
| Pytest | **19 passaram, 1 ignorado** por privilégio de symlink no Windows; junction executado. Inclui lab read-only, travessia de manifesto, BIOS/mídia PS1 e nome correto da BIOS |
| Ruff lint/format do backend e scripts do lab | Passaram |
| Patch 2 em fontes pristine do SHA pinado | Hashes originais/finais, reaplicação idempotente e recusa de tamper; [prova](research/data/runtime-patch-proof-2026-10-17.json) |
| Desktop com ROM real local | 30 ensaios exploratórios, duas engines, A/V/profiler separados, nenhum page error; SwiftShader, **não aceite de hardware** |
| LG física | Inventário, matriz curta, baseline aquecida, GL2 e perfil CPU via inspector; [dados e limites](research/benchmark-results.md) |
| PS1 real desktop | Castlevania, BIOS `scph5501.bin` reconhecida, tela de título conferida; 59,897 core/s em 30 s após 60 s warmup; card volátil de 128 KiB idêntico após importação. **Não é aceite na LG ou de save dentro do jogo** |

Os testes de integração automatizados usam bytes sintéticos/stubs; o benchmark em separado usa cópia temporária da ROM local selecionada e core real. Nenhuma BIOS/jogo foi obtido pela rede. Core SNES, identidade dos saves e mapeamentos aprovados foram preservados. Sem instalação de IPK, merge, deploy, CI remota ou aceite PS1/streaming. A velocidade física medida continua insuficiente; não declarar release pronta.

**Pendências físicas:** atribuição interna de CPU/PPU/APU/Asyncify, alternativa independente em contexto seguro, áudio perceptivo/underruns, input→fóton, SRAM reconhecida por jogo real e aceite sustentado de 30/60 min. A proteção de tela e sua evidência de inatividade são relatadas separadamente. Métricas não observáveis permanecem `unavailable`.

O usuário confirmou Home/standby/outro aplicativo durante o ensaio prolongado de inatividade: ensaio invalidado para avaliar o protetor. O launcher original foi restaurado após a navegação de laboratório; não houve instalação de IPK.

---

# Histórico: rodada consolidada após auditoria — 17/10/2026

Resultado local: **42 testes passaram; 1 ignorado por permissão de symlink no Windows**.

| Verificação | Resultado |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm run format:check` | Passaram |
| `npm test` | 11 testes / 4 arquivos passaram |
| `npm run runtime:test` | 5 regressões passaram contra fontes reais corrigidas |
| `npm run build` | Passou; UI de produção em `apps/tv-client/dist` |
| `npm run e2e` | 11 cenários passaram, sem retries; inclui bundle real no boot e fixtures de SRAM |
| `ruff check` e `ruff format --check` em server/app e server/tests | Passaram |
| `uv run --directory server pytest -q` | 15 passaram, 1 symlink ignorado; junction testado |
| `export-openapi.py --check` | Contrato atualizado e consistente |
| Patch em fonte upstream baixada do commit fixado | SHA antes/depois conferido; segunda aplicação idempotente |
| `git diff --check` | Passou; somente avisos de normalização CRLF existentes |
| IPK 1080p/720p | Ambos 0.0.2, manifesto interno `cloudgame_active=true`, resolução e SHA conferidos |

Aviso de backend: depreciação Starlette/httpx; não é falha funcional. Os arquivos `.verified.json` acompanham cada IPK em `artifacts/ipk/<resolução>/`. Capturas `audit-*` em `artifacts/screenshots/` foram revisadas em 1920 e 960 px. O modal menor usa scroll; foco espacial/Tab permanecem limitados ao contexto ativo. ROMs usadas nos testes são sintéticas, não executáveis.

**Não executado:** instalação na LG, pressões/reconexões físicas, SRAM reconhecida por jogo real, benchmark de FPS/áudio/memória, teste prolongado/standby, aceites de PS1/PS2, CI remota e publicação. Sem remoto/commit inicial nesta cópia; preservado trabalho preexistente. Mapeamento completo do relatório para entregas e pendências: [audit-improvements.md](audit-improvements.md).

---

# Evidência local — 17/10/2026

Ambiente: Windows, Node 24.15.0, Python 3.13.13, uv 0.11.9. Branch local `implementation/snes-foundation`. Não existe remote Git configurado; não houve push, PR, CI remota, release pública ou instalação na TV.

| Verificação executada | Resultado |
|---|---|
| Ruff lint + format check | Passou |
| Pytest | **12 passaram, 1 ignorado** |
| ESLint | Passou |
| Prettier check | Passou |
| TypeScript strict | Passou |
| Vitest | **4 passaram** |
| Build Vite | Passou; JS 237,45 kB, gzip 74,87 kB |
| Playwright Chromium desktop | **5 passaram** |
| OpenAPI export --check | Passou; cliente TS gerado do schema |
| npm audit do cliente (incluindo dev no bootstrap final) | 0 vulnerabilidades |
| npm audit --omit=dev do cliente | 0 vulnerabilidades |
| Runtime installer | Passou; commit fixo e checksums dos cores/relatório verificados |
| CLI ares-package 3.2.6 | Passou; IPK criado localmente |
| Conteúdo do IPK inspecionado | Apenas launcher, configuração e ícones; sem ROM/BIOS/save |
| git diff --check | Passou; hard breaks do Markdown importado preservados por atributo específico |

O teste ignorado tenta criar um symlink de arquivo: o Windows desta sessão não concedeu essa permissão. O teste específico de junction de diretório foi executado e passou. Pytest emite aviso de depreciação do adaptador httpx do Starlette TestClient; não houve falha funcional por esse aviso.

Cobertura backend: IDs estáveis e conteúdo alterado, catálogo/busca/paginação, 404/409/413/416/422/428, HEAD/Range, Host/Origin, limites, writes concorrentes, corrupção, integridade e troca de slots, falha de IO sem perder save anterior, backup e restauração sem overwrite, rejeição de junction. O teste de restore executa o script real em um processo separado.

Cobertura E2E: setas/OK/Back, foco do campo de busca até card, detalhes/player/menu/retorno, estados vazio/offline/reconexão, diagnóstico mesmo sem backend, viewport reduzida, ausência de dependência de assets externos da UI, limpeza dos bancos de ROM/core preservando estados. Um teste usa bridge/HTML/API/SaveStore reais, substituindo somente a engine por stub: confirma bytes gravados e não exibe sucesso depois de falha de rede. Outro substitui o iframe inteiro para testar jornada/foco.

**As fixtures são bytes sintéticos não executáveis.** Nenhuma ROM foi jogada; esses resultados não são um benchmark de emulação, prova de áudio, performance ou input no webOS. O aceite real está integralmente pendente em `hardware-tests.md`.

## Inspeção visual

Fonte: direção pixel 16-bit e tokens do plano, referências Xbox/Epic e craft de foco da skill Refero. Capturas reais da implementação local sem jogos, em `artifacts/screenshots/`: home/biblioteca 1920×1080 e biblioteca em viewports 960×540 e 390×844. Imagens foram abertas e inspecionadas; corrigimos o rodapé para não sobrepor conteúdo em telas pequenas. Foco amarelo visível, tipografia local, estado vazio honesto e hierarquia preservados.

Isso não comprova zoom real 200%, contraste/legibilidade no painel da LG, overscan ou distância de 2–3 m. Essas verificações permanecem pós-implementação. Não foram produzidas capturas de hardware.

## Artefato e operação

IPK: `artifacts/ipk/com.superflipcb.app_0.0.1_all.ipk` (3.526 bytes; regenerado com o favicon).

SHA-256: `c9711f253b971e020539ff8ba4d74473573e6b7ab37bac47e3db16514de89d5e`.

Favicon: SVG e ICO (16/32/48 px), com PNG de prévia, derivados do monograma SF original. Build atualizado; respostas HTTP 200 e MIME de imagem verificados no servidor real via TestClient, SVG parseado e entradas PNG do ICO validadas por tamanho/offset. API de sistemas reconferida: somente SNES habilitado.

Prévia loopback desta sessão: `http://127.0.0.1:8797/`. Foi usada porta alternativa porque 8787 estava ocupada; o processo existente não foi interrompido. Nenhuma interface LAN foi exposta nesta validação.

Limitações materiais: saves explícitos sem autosync/garantia contra encerramento abrupto; APIs internas do EmulatorJS pinadas mas sem teste do core real; contexto HTTP/Gamepad e redirecionamento do launcher pendentes na LG; CLI opcional com 10 vulnerabilidades conhecidas (incluindo 1 crítica), isolado do produto. Ver `security.md`. Sem aprovação de MVP ou release v0.1.0.
