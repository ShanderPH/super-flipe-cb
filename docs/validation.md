# Rodada consolidada após auditoria — 17/10/2026

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
