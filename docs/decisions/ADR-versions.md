# ADR — versões implementadas

Data: 17/10/2026. Pins do plano foram conferidos contra registry/ambiente e transformados em locks, sem tratar os números documentais como instalações já existentes.

| Camada | Versão |
|---|---|
| Node real usado | 24.15.0 LTS; `.node-version` |
| npm real usado | 11.12.1 |
| uv | 0.11.9 |
| Python | 3.13.13; `server/.python-version` |
| React / React DOM | 19.3.1 |
| Vite / plugin React | 8.3.4 / 6.1.2 |
| TypeScript | 5.9.3 |
| FastAPI | 0.143.3 |
| Uvicorn | 0.42.0 |
| Starlette | 1.8.0, transitiva congelada no uv.lock |
| Pydantic | 2.14.1 |
| Filelock | 3.20.3 |
| EmulatorJS | 4.2.3, commit e150dc0491ae747028919fb82d6598954976ede6 |
| CLI webOS opcional | 3.2.6, lock próprio e vulnerabilidades conhecidas |
| Vitest / Playwright | 5.0.5 / 1.64.1 |
| OpenAPI TypeScript | 7.13.0 |

Node 24.21.0 era baseline no plano; o ambiente já possuía 24.15.0, compatível com o build e efetivamente usado. TypeScript 6.0.3 foi substituído por 5.9.3 no bootstrap para atender o peer do gerador OpenAPI, sem `--force` ou `--legacy-peer-deps`.

Runtime EmulatorJS vem do commit fixado, recebe o patch rastreado em `scripts/runtime/patch_runtime.py` (hash antes/depois) e é compilado em um único script compacto com o Rolldown já instalado pelo toolchain Vite. Nomes globais e semântica são preservados; debug fica desligado. Cores oficiais SNES GL e legacy continuam no caminho 4.2.3 com os mesmos hashes abaixo. O relatório é preservado para identificar o build do core. Não se infere a versão autônoma Snes9x pela versão do loader. O build gera manifesto de hashes, verificado no startup da API.

| Artefato | SHA-256 |
|---|---|
| snes9x-wasm.data | eaa0bcfce67673809886e50387a80a616b719502175db64c090d04c9d75958ee |
| snes9x-legacy-wasm.data | 7d427a575cefad98ff400493fa1d7e892da63fe7bab68979babd9cea0bfaaf3b |
| reports/snes9x.json | dc7ac963eb7935a7ac78956235ac0b8912ec785c57026336825aa2ed8031b3ad |

A baseURL do core é same-origin. Threads permanecem desligadas e não exigimos SharedArrayBuffer/COOP/COEP. O build usa target Chrome111 para compatibilidade conservadora; isso não comprova o motor da LG nem que sua Gamepad API funcione fora de contexto seguro.

Reprodução: `npm ci` no cliente; `uv sync --frozen` no servidor. Dependências JS têm pins exatos; transitivas Python estão no `uv.lock`. Atualizações devem ser mudanças separadas com revalidação do bridge, bundle, API e hardware quando afetarem engine/core.
