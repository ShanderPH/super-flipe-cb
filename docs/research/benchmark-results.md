# Benchmarks reproduzíveis — 17/10/2026

Base `a69e2f70bc69aaeb98549b9611e9c6a0abaa2e38` com alterações locais. Sem alegação de ganho antes/depois: não foi capturada uma baseline anterior equivalente. Os resultados abaixo medem a implementação instrumentável desta branch.

Continuação: [builds 2005 reproduzíveis, 18 ensaios desktop, equivalência em cinco ROMs e memória PS1](performance-overhaul-execution.md). Os números físicos abaixo são **históricos da investigação anterior**. A tentativa física desta continuação foi interrompida após a proibição expressa de testes sem autorização específica; não produziu FPS novo nem resultado válido de comparação. Qualquer novo acesso à TV depende de autorização prévia para a sessão.

## Conteúdo e cenário

ROM local fornecida: **Super Mario World**, 1.048.576 bytes, título interno `SUPER MARIOWORLD`, região do cabeçalho 1, checksum/complemento coerentes. ID SHA-256: `d728815c92e7e38de86f6fdc1742ad73db124bbdf91d366bc7392f6d4cb5291a`. Nenhuma ROM/BIOS foi baixada ou incluída nesta documentação.

Cena: **cold boot/demo sem input**, reiniciada a cada ensaio, sem SRAM. Isso é reproduzível como sequência de input vazia; em velocidades diferentes, a mesma janela de relógio pode abranger partes diferentes da demo. Não equivale a um save state da mesma cena jogável. Para comparação fina entre cores, acrescentar sequência de input sincronizada por frame e delimitar cena por estado emulado; não compartilhar save states incompatíveis.

Engine: EmulatorJS 4.2.3, fonte `e150dc0491ae747028919fb82d6598954976ede6`, patch Super Flip 2. Core build `snes9x-eaa0bcfce676-7d427a575cef`; hashes completos no JSON runtime de cada ensaio. GL1 baseline, threads desligadas, sem filtros/rewind/runahead adicionados, viewport 1920×1080, referência nominal NTSC 60,0988 Hz. O contador do core é a métrica de throughput; não mede frames apresentados.

## Desktop: comparação exploratória

Windows 10.0.26220, i5-13420H, 12 CPUs lógicas, 34.049.220.608 bytes RAM; Chromium headless 156.0.8078.4 com **SwiftShader/software GPU**. Aquecimento 5 s, janela 10 s, três repetições, ordem invertida na segunda. [30 ensaios brutos](data/desktop-2026-10-17.json).

| Engine | Áudio | Upload/draw | Profiler | Mediana core/s | Mín–máx |
|---|---|---|---|---:|---:|
| Atual | on | on | off | 59,954 | 59,932–59,989 |
| Atual | on | on | on | 59,974 | 59,948–60,031 |
| Atual | on | off | off | 59,999 | 59,991–60,022 |
| Atual | on | off | on | 60,066 | 59,957–60,077 |
| Atual | off | on | off | 59,986 | 59,968–60,037 |
| Atual | off | on | on | 60,033 | 60,017–60,033 |
| Atual | off | off | off | 59,978 | 59,953–60,007 |
| Atual | off | off | on | 60,003 | 59,968–60,091 |
| Shim independente 0.1.1 | on | on | off | 59,897 | 59,775–59,922 |
| Shim independente 0.1.1 | on | on | on | 59,947 | 59,894–60,012 |

Sem page errors nos 30 ensaios. Ambas chegam perto do limite nominal; throughput limitado a 60 não mede folga de CPU. A alternativa instrumentada mediu core+shim médio ~1,04–1,16 ms incluindo os 5 s de warmup; a atual ~1,84–1,91 ms por iteração na última subjanela. As fronteiras e janelas medidas são diferentes: **não transformar a razão em ganho de FPS nem extrapolar à TV**. O contador mínimo também adiciona overhead à alternativa sem profiler. O harness atual drena os custos da alternativa ao exportar, corrigindo a inclusão de warmup nos ensaios futuros; o FPS por diferença de contadores dessa primeira rodada permanece válido.

## LG física: reprodução da lentidão

55QNED70BSA.BWZDLJZ, webOS informado 26 / 11.2.0-2909; SDK 11.2.0, firmware físico 43.21.41. WAM Chromium 132.0.6834.207, 1080p/DPR1. HTTP LAN privado, sem contexto seguro/SAB, Wake Lock ausente; PalmServiceBridge disponível. Método: CDP via `ares-inspect` no target explícito `com.superflipcb.app`, sem instalar outro IPK.

Primeira matriz: aquecimento 5 s + janela 10 s, uma repetição por variante. [Dados](data/tv-2026-10-17.json).

| Áudio | Upload/draw | Profiler | Core/s | Validade |
|---|---|---|---:|---|
| on | on | off | 45,971 | Visível, sem pausa/ocultação registrada |
| on | on | on | 41,212 | Visível |
| on | off | off | 37,908 | Visível |
| on | off | on | 24,364 | Visível; transientes grandes |
| off | on | off | 35,472 | Visível |
| off | on | on | — | **Inválido: core pausado** |
| off | off | off | 37,135 | Visível |
| off | off | on | 35,070 | Visível |

Ordem, compilação, memória e transientes impedem conclusão causal de diferenças entre essas linhas. Não afirmar que desligar áudio/vídeo piora ou melhora o core com essa amostra. Desabilitar áudio muda sincronização; suprimir upload/draw mantém emulação PPU/conversão e outras chamadas GL: é ablação diagnóstica da submissão, não outra implementação completa de renderer.

Confirmação com aquecimento maior: **60 s + janela 30 s**, A/V on, profiler do produto off, duas repetições: **34,454 / 37,367 core/s**, ambas visíveis, sem pausa ou interrupção registrada. [Dados](data/tv-steady-2026-10-17.json). Resultado não satisfatório e sem estabilidade/aceite de 30 min.

WebGL2, mesmo protocolo de 60 s + 30 s, uma repetição: **37,347 core/s**, sem pausa/interrupção, artefato `snes9x-wasm.data`. [Dados](data/tv-webgl2-2026-10-17.json). Próximo da segunda baseline GL1, sem repetição suficiente para declarar equivalência ou ganho. GL1 continua padrão.

Perfil CPU separado: 60 s + ~20 s, 35,215 core/s; fonte e limites no [diagnóstico de causa](performance-root-cause.md). Dados de SO: [identidade](data/tv-device-cli-2026-10-17.txt), [CPU](data/tv-cpu-cli-2026-10-17.txt), [recursos](data/tv-resources-2026-10-17.txt) e [pressão de memória](data/tv-memory-pressure-2026-10-17.txt). A rede/mode de imagem/transporte do controle não foram estabelecidos nesta execução; não inferir medição de input físico.

Uma primeira tentativa com app em segundo plano marcou ~1 FPS: **invalidada e excluída da análise de gameplay**, preservada em [background-invalid](data/tv-background-invalid-2026-10-17.json). O runner recusa ensaios ocultos/pausados/interrompidos. Uma captura já inválida nunca vira referência de ganho após foreground.

Ensaio de inatividade: 60 s de aquecimento e janela planejada de 300 s; terminou oculto/pausado/interrompido. **O usuário confirmou uso de Home/standby/outro aplicativo durante o intervalo (~21h05–21h12).** Portanto, não comprova entrada automática nem falha do protetor, tampouco sua prevenção. O registro Luna estava ativo, com zero pedidos/vetos/respostas aceitas. [Dados e esclarecimento do operador](data/tv-inactivity-2026-10-17.json). O aceite de inatividade sem intervenção continua pendente.

O shim independente foi tentado fisicamente com profiler off/on: ambas as variantes recusaram iniciar pelo requisito de contexto seguro. [Falhas explícitas](data/tv-alternative-2026-10-17.json). Não há FPS físico para essa engine; AudioWorklet exposto no objeto global não elimina o requisito de origem segura.

## Reproduzir sem tocar nos saves

Com runtime de produção já instalado, UI compilada e mídia legítima selecionada:

```powershell
uv run --project server python scripts/benchmark/prepare.py --alternative
uv run --project server python scripts/benchmark/serve.py --rom 'CAMINHO\JOGO.sfc' --alternative 'vendor/experiments/snes9x-wasm-0.1.1'
node scripts/benchmark/run.mjs --alternative --warmup 60 --seconds 30 --repeats 3
```

O preparador recusa sobrescrever um experimento existente. Não baixa jogos/BIOS; hashes fixos e revisão de licença em [comparação](emulation-framework-comparison.md). O servidor usa catálogo temporário com cópia de uma ROM, nenhuma pasta de saves reais e middleware que recusa todas as escritas. O bridge `benchmark=1` também bloqueia leitura/restauração/save/import/autosync de progresso. Não usar a flag como substituto da separação de servidor.

Para TV, iniciar o mesmo lab com `--host IP_PRIVADO_REAL`, abrir o app em foreground, iniciar `ares-inspect` e usar o endereço local devolvido:

**Executar somente após autorização explícita do usuário para a sessão**, inclusive para abrir inspector/launcher/túnel. Acrescentar `--authorization REFERENCIA_DA_AUTORIZACAO` ao runner; o parâmetro só registra uma aprovação já recebida. Os comandos abaixo, sem esse parâmetro, agora recusam iniciar.

```powershell
node scripts/benchmark/tv.mjs --inspector http://localhost:PORTA --base http://IP_PRIVADO_REAL:8798 --warmup 60 --seconds 30 --repeats 3
# Uma baseline apenas, ou amostragem CPU que deve ficar separada da baseline:
node scripts/benchmark/tv.mjs --inspector http://localhost:PORTA --base http://IP_PRIVADO_REAL:8798 --baseline --warmup 60 --seconds 30 --repeats 3
```

`--renderer webgl2` seleciona outro artefato; `--cpuProfile` adiciona V8 sampling e precisa ser rotulado como instrumentado. O runner restaura a URL capturada; se a sessão já começou em página de laboratório, voltar manualmente ao launcher após terminar. Parar lab/túnel próprios. Nunca enumerar credenciais do dispositivo em logs.

`--alternative` acrescenta as duas variantes do shim independente (profiler off/on) também ao runner físico; `--alternativeOnly` executa apenas essas variantes. O pré-requisito de contexto seguro continua obrigatório; a recusa no HTTP LAN foi reproduzida, sem fabricar FPS. Os últimos ensaios guardam hashes dos módulos de player servidos para identificar a versão exata medida.

## PS1 experimental

```powershell
uv run --project server python scripts/benchmark/prepare.py --ps1
uv run --project server python scripts/benchmark/serve.py --ps1-image 'data/roms/psx/Castlevania.cue' --bios 'data/roms/psx/bios/scph5501.bin' --port 8799
node scripts/benchmark/ps1.mjs --warmup 60 --seconds 30 --output artifacts/benchmarks/ps1.json
# Ou abrir http://127.0.0.1:8799/lab/assets/ps1.html
```

PCSX ReARMed separado, sem habilitar PS1 no catálogo de produção. Aceita imagem single-file PBP/BIN/IMG ou CUE com um único BIN, e BIOS de 512 KiB com nome `scphNNN.bin`/`scphNNNN.bin`, preservando o nome real e registrando SHA-256. Tamanho/nome não validam autenticidade: conferir dump legítimo e checksum conforme documentação Libretro. CHD, CUE com múltiplos BINs, multidisco, controles analógicos, netplay e sincronização de cards ficam pendentes. Card volátil, importação somente pausada com tamanho igual, cópia anterior exportável e rollback em erro; não usa SaveStore SNES.

O operador forneceu `Castlevania.cue`/`.bin` e BIOS. O CUE aponta originalmente para um caminho Windows antigo; o servidor admite apenas o basename de um BIN irmão confinado e reescreve **somente a resposta em memória** para `disc.bin`. Mantém as duas tracks (MODE2/2352 e áudio). O loader EJS 4.2.3 passa o ArrayBuffer de `externalFiles` diretamente a MEMFS e deixava um BIN vazio; a integração experimental agora converte a resposta em uma view Uint8Array, sem outra cópia integral. O runner verifica tamanho no MEMFS, identificação do disco e BIOS antes de medir, impedindo classificar o menu RetroArch como gameplay.

**Ensaio real desktop, não TV:** Castlevania: Symphony of the Night, ID reconhecido `SLUS00067`; BIN 582.978.480 bytes, SHA-256 `bb005be58d185be5bf26ea3425019bf6a4b86f789db29d740a37c9f582d85595`. BIOS `scph5501.bin`, 524.288 bytes, MD5 `490f666e1afb15b7362b406ed1cea246`, consistente com a [tabela Libretro](https://docs.libretro.com/library/pcsx_rearmed/). PCSX ReARMed identifica revisão `092633f8`, compilação Clang 21.0.0git de 14/06/2025; frontend RetroArch 1.21.0, Git `6dd4353`. Hashes completos no [JSON bruto](data/ps1-desktop-2026-10-17.json).

Mesmo PC/Chromium/SwiftShader do benchmark desktop, viewport 1920×1080, GL2, A/V e profiler on, threads off, boot sem input, aquecimento 60 s + janela 30 s. **59,897 frames do core/s**, 1.798 frames em 30.018,3 ms, visível/sem pausa e sem page errors. A captura local `artifacts/benchmarks/ps1-steady-game.png` mostra a tela de título. A exportação/reimportação de um cartão **volátil de 131.072 bytes** foi idêntica; não comprova save criado/reconhecido dentro do jogo. Os logs retêm avisos de shader/playlist/dimensões do frontend; a imagem de título foi conferida. A primeira tentativa, com BIN vazio e menu a 60 FPS, foi **invalidada**, preservada em [menu-invalid](data/ps1-menu-invalid-2026-10-17.json).

Áudio perceptivo, partida com controle físico, cinco títulos, estabilidade de 60 min e save dentro do jogo continuam pendentes. **PS1 não foi executado na LG:** carregar esse BIN de ~556 MiB mais cópias/heap não é uma escolha segura sem orçamento de memória, diante de ~1,67 GiB visíveis ao SO e ~400 MiB disponíveis nas leituras. Avaliar formato/loader com menor pico ou execução remota antes desse ensaio. Não há benchmark ou PoC de streaming instalado; a alternativa remota é recomendação arquitetural. PS2 está excluído.
