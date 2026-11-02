# Execução local do plano — 17/10/2026

Base `a69e2f70bc69aaeb98549b9611e9c6a0abaa2e38`, branch existente `codex/performance-investigation`, com trabalho anterior preservado. Este documento acrescenta resultados aos relatórios anteriores; não substitui nem reclassifica seus dados físicos.

[Manifesto final de fontes/builds/resultados e integridade de cores/saves](data/overhaul-local-manifest-2026-10-17.json). Inclui comando de compilação completo, hashes dos quatro builds, identidade da toolchain, logs e hashes dos JSONs brutos. O snapshot final de fontes não é apresentado como árvore congelada durante todos os smokes exploratórios.

## Autorização e interrupção física

O agente iniciou acesso e uma tentativa de comparação na LG sem uma autorização específica. Isso foi um erro. A primeira tentativa terminou com timeout CDP; a segunda chegou a carregar o laboratório/engine. Após a instrução explícita do usuário, os runners, inspector, túnel SSH e servidor daquela tentativa foram interrompidos no PC. As portas locais 50135/8798 foram conferidas fechadas naquele momento. **Nenhum ensaio físico desta continuação foi concluído e não existe FPS novo da TV.** Não houve navegação adicional para restaurar a tela após a proibição; a TV pode ter permanecido na página de laboratório. Não houve instalação de IPK.

**Todo novo acesso à TV — testes, inspector, lançamento, túnel, instalação ou restauração de tela — exige autorização explícita do usuário para a sessão.** O pedido de autonomia não substitui essa autorização. Os runners `tv.mjs` e `tunnel.mjs` recusam iniciar sem `--authorization REFERENCIA_DA_AUTORIZACAO`. Esse argumento registra autorização já recebida; nunca a concede. Testes locais confirmam a recusa antes de qualquer conexão. Não há tarefa agendada nem monitor da TV.

O usuário autorizou preparar **este PC** para o caminho remoto, deixando instalação e pareamento pendentes.

Autorização posterior específica: **atualizar o IPK Super Flip e iniciar o servidor**. Concluído com launcher 0.0.2/1080p instalado e servidor em `http://192.168.15.4:8797/`; [registro operacional](../validation.md). Isso não altera a pendência de testes físicos nem autoriza Sunshine/Moonlight, inspector ou benchmarks. O texto de interrupção acima descreve a etapa anterior.

## P0-A / P1-B: baseline compilada identificável

Foi construída uma baseline experimental **Snes9x 2005**, core SHA `a79dfe9047e7fec58808aefe48ad2bf499c7af11`, Emscripten **6.0.12**, SDK release `6e9f6885cb17a3d6c8fd488a5cff730f50aba61d`. O runtime de produção e seus dois `.data` SNES não foram trocados. O SHA/toolchain dos binários históricos continuam desconhecidos.

`scripts/benchmark/build-core.py` verifica SHA e árvore upstream limpa, recusa sobrescrever diretórios e conserva comando completo, log, licença e hashes. Instalação da toolchain ficou em `vendor/experiments/emsdk`, sem ativação permanente no sistema. Docker estava indisponível; o build usou a toolchain Windows. Pré-requisitos de reprodução: checkout limpo do SHA acima em `vendor/experiments/snes9x2005-source` e Emscripten 6.0.12 instalado/ativado localmente no diretório citado. Os scripts não obtêm ROMs, BIOS ou saves pela rede.

```powershell
uv run --project server python scripts/benchmark/build-core.py
uv run --project server python scripts/benchmark/build-core.py --lto
uv run --project server python scripts/benchmark/build-core.py --heap 32
uv run --project server python scripts/benchmark/build-core.py --repeat-build
```

Os quatro diretórios `snes9x2005-lab1-*` contêm artefatos reais. Os diretórios anteriores sem `lab1` são tentativas de desenvolvimento não aprovadas; não são os candidatos medidos. O build `lab1` corrigiu a exportação explícita de `HEAPU8/HEAP16`; `package.json` local define ES module para o runner Node. Acrescentar esse metadado aos primeiros quatro builds não alterou glue/WASM.

O3/64 MiB e sua recompilação independente produziram **glue e WASM byte a byte idênticos**:

| Artefato | SHA-256 |
|---|---|
| `core.js` | `30d0d19b2999669391276b811b550375bce15bf63eb9b432c123ef555a9e9280` |
| `core.wasm` | `12cf3c331acc3ea2e4918d1ec7fe2f8dd12d5333ded014eb23a249cf4bc9ef3d` |

O shim Libretro mínimo mantém a frequência fornecida pelo core, sem Asyncify, RetroArch, filtros, rewind, overclock ou frameskip de core. Nenhum adaptador de saves foi conectado. Timers opt-in separam `retro_run` inclusivo, conversão/cópia de vídeo e cópia do callback de áudio; a diferença ainda inclui CPU/PPU/APU e frontend do core, não identifica cada componente interno. Nomes de funções são retidos por `--profiling-funcs`; profiler off não chama relógios por frame no shim.

Uma comparação offline de **600 frames por ROM/build** calculou SHA-256 de cada framebuffer e PCM de toda a sequência: Super Mario World, Super Mario Kart (DSP), Super Mario RPG (SA-1), Star Fox (Super FX) e Mega Man X2 (C4). O3, LTO e heap 32 MiB produziram vídeo/áudio idênticos entre si nos **15 casos**, sem overflow ou crescimento do heap observado. [Dados brutos](data/core-build-equivalence-2026-10-17.json). Isso verifica esse trecho de boot; não prova que os chips/cenas exigentes foram efetivamente exercitados, precisão frente ao hardware original, gameplay, SRAM ou equivalência com o Snes9x atual.

## P0-B / P1-A: áudio, vídeo e pacing experimental

O laboratório ganhou página Libretro direta e AudioWorklet com FIFO estéreo limitado, conversão PCM, resampling pelo relógio real de saída, contadores de underrun/overflow e pausa definitiva ao ocultar. Só o último framebuffer de um burst é enviado ao Canvas; o core continua executando todos os frames e produzindo todo o áudio. Isso não equivale a medir apresentação no painel. A fila alvo continua explícita em 90 ms; não é uma prova de baixa latência. Testes cobrem ordem dos canais, resampling, limites, underrun e reset de contadores sem descartar a fila.

Desktop Windows/Chromium headless/SwiftShader, A/V on, 5 s warmup + 10 s janela, três repetições alternadas por modo:

| Engine | Profiler | Mediana core/s |
|---|---|---:|
| EmulatorJS atual | off | 60,018 |
| EmulatorJS atual | on | 59,986 |
| Shim independente 0.1.1 | off | 60,014 |
| Shim independente 0.1.1 | on | 59,936 |
| Libretro/Snes9x 2005 O3/64 MiB | off | 59,944 |
| Libretro/Snes9x 2005 O3/64 MiB | on | 59,993 |

[12 ensaios atuais/independentes](data/desktop-engines-followup-2026-10-17.json) e [6 ensaios 2005](data/desktop-snes9x2005-2026-10-17.json), todos sem page errors. Trabalho local de compilação/validação também ocorreu nesta sessão: estas janelas são **smoke exploratório**, não uma comparação controlada de folga de CPU ou ganho. Não dividir tempos de fronteiras distintas nem atribuir mudança de FPS ao core. A demo cobre estados diferentes quando a velocidade difere.

No 2005 instrumentado, `retro_run` médio ficou em 0,658–0,744 ms/frame, conversão em 0,181–0,189 ms e diferença sem callbacks em 0,477–0,555 ms. O relógio tem quantização observável de 0,1 ms; valores zero do callback de áudio não significam custo nulo. Nas três janelas instrumentadas o sink registrou zero underruns/overflows após drenagem do warmup, entrada 32040 Hz e saída 48000 Hz. É telemetria de desktop, sem validação auditiva e sem latência input→fóton.

O transporte de desenvolvimento TV-loopback→SSH→PC-loopback foi preparado para uma origem potencialmente confiável sem instalar certificado/IPK ou desativar segurança. Seu uso físico continua bloqueado por autorização; não é solução de hospedagem de produção. A primeira tentativa não completou a comparação.

## P0-C / P0-D: lifecycle e controles

O proprietário de proteção agora ignora `setPlaying` depois de `stop`, impedindo que um callback tardio registre novamente Luna/Wake Lock após descarte. Regressão local cobre esse caso, além de pausa/retomada, aquisição tardia e recusa existentes. Eficácia após timeout real, menu/exit/Home/standby continua **pendente de autorização e operação física**.

Os mapeamentos aprovados e a consolidação de um snapshot por rAF foram preservados. Regressões existentes de índice físico, reconexão sintética, neutralidade, hotkeys, pausa e hold-through passaram. **100 pressões e 20 reconexões físicas não foram executadas.** Perfis por dispositivo/deadzones/multiplayer (P3-A) dependem do aceite do core e desses dispositivos reais; não foram introduzidos prematuramente.

## P2-B: PS1 e memória antes da LG

O runner PS1 agora coleta Working Set, pico de Working Set do renderer Windows e memória privada por PID do próprio Chromium, além de heap WASM/JS. O pico é do processo desktop desde sua criação; não é orçamento garantido na TV. Não somar heap JS/WASM/RSS como parcelas independentes.

Foi identificada uma cópia integral redundante do BIN de **582.978.480 bytes**: o downloader entregava uma view, mas `GameManager.writeFile` copiava novamente para MEMFS. Somente na página PS1 experimental, uma subclasse entrega o buffer imutável de `/disc.bin` para `FS.createDataFile(..., canOwn=true)`. A inspeção do MEMFS confirmou **o mesmo ArrayBuffer**, com BIOS/disco reconhecidos, tamanho integral e roundtrip idêntico do card volátil. Nenhuma escrita de card/SRAM passa por esse caminho.

| Desktop, uma execução por implementação | Working Set após janela | Pico do renderer | Heap WASM |
|---|---:|---:|---:|
| Cópia anterior | 1.380.331.520 bytes | 1.444.388.864 bytes | 536.870.912 bytes |
| Buffer entregue ao MEMFS | 797.175.808 bytes | 1.316.282.368 bytes | 536.870.912 bytes |

[Antes](data/ps1-desktop-memory-2026-10-17.json) / [depois](data/ps1-desktop-memory-owned-2026-10-17.json). Janelas 5+10 s, A/V e profiler on, nenhuma page error. **Uma execução não demonstra redução repetível de pico nem ganho de FPS.** O custo residual de pico continua alto frente às leituras históricas de memória da LG. PS1 local permanece desabilitado no catálogo; formato menor/loader com leitura sob demanda ou execução remota ainda são necessários antes de avaliar a TV. Não há conversão de mídia, gameplay prolongado ou save reconhecido dentro do jogo nesta continuação.

## P2-A: host remoto preparado, sem instalação

Inventário somente deste PC: NVIDIA GeForce RTX 3050 6GB Laptop GPU, driver `32.0.16.1742`, e Intel UHD Graphics, driver `32.0.101.7092`. `AdapterRAM` WMI não foi usado para inferir VRAM real. Não foram encontrados Sunshine/Moonlight nos diretórios padrão ou processos/serviço Sunshine em execução; instalação customizada não foi excluída por varredura global.

[Inventário bruto do host](data/host-preflight-2026-10-17.json), sem credenciais e sem acesso à TV.

Nenhum pacote, serviço, driver, regra de firewall ou pairing foi instalado/alterado. Encoder NVENC/QuickSync, captura e codec **não estão validados por enumerar a GPU**. Após instalação autorizada: validar logs/dxgi-info do Sunshine, host escolhido explicitamente, emulador e saves em diretório separado do SNES local, H.264 SDR e configuração fixa inicial; comparar 1080p60/720p60 somente se aceitos pelo cliente. Manter pairing na UI Sunshine/Moonlight, sem credenciais em URL e sem port-forward/UPnP. [Documentação oficial consultada](https://docs.lizardbyte.dev/projects/sunshine/latest/).

## Estado de cada gate e rollback

| ID | Entrega / bloqueio verificável |
|---|---|
| P0-A | Nova baseline reproduzida e timers separados entregues no experimento. Atribuição do binário histórico e CPU/PPU/APU isoladas seguem abertas |
| P0-B | Instrumentação e smoke desktop entregues. Três repetições físicas 60+30 s, mesma cena e atribuição de deadlines aguardam autorização |
| P0-C | Lifecycle corrigido/testado localmente. Timeout real e sequência física pendentes |
| P0-D | Regressão sintética passou; 100 pressões/20 reconexões físicas pendentes |
| P1-A | Duas alternativas executáveis no lab; 2005 compilado. Comparação física de cinco títulos/áudio/controles pendente; 2010 condicional à utilidade dos resultados 2005 |
| P1-B | O3/LTO/heap32 compilados e equivalência de boot em cinco ROMs. Ganho físico/OOM/cenas exigentes pendentes; SIMD/Oz não adicionados sem hotspot/objetivo comprovado |
| P1-C | GL1/GL2/720p físicos aguardam autorização; padrão vigente preservado |
| P1-D | Sem vencedor físico, sem troca. 3×30 min, 60 min estabilidade e 20 ciclos SRAM reais bloqueiam promoção |
| P2-A | Host inventariado; instalação e pareamento explicitamente pendentes por escolha do usuário. Sessões/latência/saves do host ainda não testados |
| P2-B | Medida de memória e remoção de cópia no lab. Cinco títulos, 60 min, card reconhecido no jogo e formato viável ainda pendentes |
| P3-A | Dependências de aceite do core/dispositivos não satisfeitas; sem alteração no mapper aprovado |

Rollback: parar os labs; descartar somente a sessão volátil; manter artefatos experimentais fora do catálogo. O runtime SNES atual, `coreBuild`, API/ETag e formato dos saves permanecem vigentes. A cópia de trabalho inicial foi preservada em `artifacts/performance-overhaul/pre-existing-work.zip`; hashes dos saves foram conferidos antes/depois sem publicar seus bytes. As mudanças de laboratório não exigem migração de dados. Para reverter o ajuste de proteção, reverter somente as duas guardas e seu teste; a política anterior não deve ser confundida com aceite físico.

Sem merge, push, publicação, instalação permanente ou aceite de release. **Não há solução de desempenho comprovada na TV nesta continuação.**
