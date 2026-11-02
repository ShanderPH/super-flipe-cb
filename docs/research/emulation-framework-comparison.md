# Engines, cores e builds — 17/10/2026

Base auditada: `a69e2f70bc69aaeb98549b9611e9c6a0abaa2e38`, produto 0.0.1, launcher 0.0.2. As versões consultadas, SHAs completos, datas, URLs e hashes das fontes estão em [upstream-inventory](data/upstream-inventory-2026-10-17.json). Release estável, HEAD atual e binário instalado são identidades diferentes.

## O que está realmente instalado

O app não implementa um emulador SNES próprio: carrega EmulatorJS **4.2.3**, fonte `e150dc0491ae747028919fb82d6598954976ede6`, e Snes9x dentro de **RetroArch/Emscripten**. Os pacotes são build **2.0.2**, mínimo EJS 4.2.2, relatório de compilação de 14/06/2025. `core.json` aponta para `EmulatorJS/snes9x`; não contém o SHA do core nem o comando completo de compilação. Não é correto atribuir a esses binários o HEAD atual do fork.

O desempacotamento dos dois `.data` locais confirmou WASM com ~6,32 MB, memória inicial **128 MiB**, limite virtual **2 GiB**, sem memória compartilhada. O limite não significa alocação física de 2 GiB. O glue contém Asyncify, OpenAL e o loop Emscripten. Não exporta medição isolada de `retro_run` ou de underruns. Os hashes do WASM estão em [binary-inventory](data/binary-inventory-2026-10-17.json). Os bytes dos cores foram preservados.

## Comparação arquitetural

Expectativas nesta tabela são hipóteses técnicas, salvo quando há resultado ligado no benchmark. Não há requisito mínimo de GHz/RAM para a QNED70 demonstrado pelos projetos; não inventamos esses valores.

| Candidato / versão consultada | CPU, RAM e vídeo | Áudio, controles, saves | webOS e custo |
|---|---|---|---|
| [RetroArch/Libretro](https://github.com/libretro/RetroArch), estável 1.22.2 | Frontend nativo escolhe drivers e core; SIMD nativo/dynarec dependem do core e ABI. Não equivalem a WASM SIMD. Memória varia por core | Drivers nativos de áudio/input; SRAM e estados dependem do core/build | Nativo exige pacote/ABI e instalação próprios. Comparar o mesmo core/região/configuração; experiência desktop não prova a TV. Integração alta; referência madura |
| [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS), estável 4.2.3 | JS + RetroArch WASM; GL1/GL2 são artefatos distintos. 128 MiB iniciais no SNES instalado, sem threads | OpenAL/Web Audio no pacote local; controles do produto e SRAM com ETag já integrados | Baseline preservada. Integração baixa. Carregamento/minificação não alteram custo da emulação |
| [Snes9x](https://github.com/snes9xgit/snes9x), estável 1.63; HEAD separado no inventário | Compatibilidade/precisão maiores podem custar mais CPU que versões antigas. Software PPU; GL é saída, não acelera automaticamente CPU/PPU | SRAM; estados específicos de versão. Chip adicional/hi-res muda carga | Core atual; manter até comparação física demonstrar vantagem e compatibilidade |
| [Snes9x 2005](https://docs.libretro.com/library/snes9x_2005/), HEAD `a79dfe9047e7…` | Família antiga, candidata a menos custo de CPU; trocas de precisão/APU/compatibilidade precisam de teste. Não foi instalada como substituta | SRAM pode exigir conversão/revisão por título; não compartilhar estados automaticamente | Boa próxima candidata controlada para ARM limitado. Não é uma opção oferecida pelo mapa SNES do EJS 4.2.3 instalado: exige build/integrador próprio |
| [Snes9x 2010](https://docs.libretro.com/library/snes9x_2010/), HEAD `fe690dd321fa…` | Compromisso entre geração antiga e atual; expectativa de performance exige comparação | Áudio/compatibilidade diferentes de 2005; mesmo cuidado com saves | Experimento posterior a 2005, sem troca silenciosa de core |
| [wasm-gaming/snes9x-wasm](https://github.com/wasm-gaming/snes9x-wasm), 0.1.1 | Snes9x + shim direto, sem RetroArch/SDL/Asyncify; Canvas2D, heap inicial 64 MiB, máximo 512 MiB no script consultado | AudioWorklet, fila alvo ~90 ms, pacing por áudio, fallback por relógio; controles próprios. SRAM/estado e persistência OPFS no SDK | Comparação desktop executável, `persist:null` no laboratório. **AudioWorklet exige contexto seguro**: HTTP LAN da TV é bloqueador real. Nenhuma adoção no produto |
| [PCSX ReARMed](https://docs.libretro.com/library/pcsx_rearmed/), HEAD `c8816799b503…`; pacote EJS 2.0.2 | PS1 mais adequado a ARM nativo que Beetle em princípio. Dynarec ARM não passa a executar ARM dentro de WASM; pacote precisa ser medido | BIOS legítima, formatos de disco e cards. PoC digital inclui L2/R2; analógicos/multidisco pendentes | PoC isolada implementada; sem prontidão física declarada. GL1 e GL2 pinados, sem threads |
| [Beetle PSX / HW](https://docs.libretro.com/library/beetle_psx_hw/), HEAD `cf936960d3de…` | Maior custo de precisão. HW é outro backend; suporte OpenGL/Vulkan nativo não garante WebGL/WASM eficiente | BIOS, cards, estados; não intercambiáveis automaticamente | Não priorizado para execução local nesta TV sem evidência. Integração/custo altos |
| [Moonlight TV](https://github.com/mariotaku/moonlight-tv), estável 1.6.36; HEAD separado | Cliente **nativo** usa decodificação da TV; emulação e encode no host. RAM/codec/resolução dependem da sessão | Retorno de input ao host; áudio e pacing do protocolo maduro; saves pertencem ao emulador no PC | Referência recomendada para modo remoto. Não é biblioteca JS para colocar no iframe |
| [Sunshine](https://github.com/LizardByte/Sunshine), 2026.914.233613 | Host: encode por GPU suportada ou software; CPU/RAM dependem do emulador e encode | Pairing, streaming, controle e sessão; saves mantidos pelo host | Usar LAN e pairing; não expor à internet. Sem implementação de protocolo concorrente |
| [Emscripten](https://emscripten.org/docs/optimizing/Optimizing-Code.html), release consultada 6.0.12 | Toolchain, não engine. `-O3`, LTO, SIMD e threads precisam de código compatível e benchmarks | Escolha de frontend/audio decide comportamento final | Não atualizar toolchain/binário vigente para “tentar acelerar” sem comparação e rollback |

PS2 está excluído desta revisão de implementação e do planejamento atual, por instrução expressa. Não há tarefa PCSX2 nesta entrega.

## Flags e experimento de build

**Atualização da continuação:** a ausência de toolchain descrita abaixo é histórica. Agora existe Emscripten 6.0.12 local, e Snes9x 2005 pinado foi compilado O3/64 MiB, LTO e heap32, com recompilação idêntica e equivalência de vídeo/PCM de boot em cinco ROMs. [Artefatos, limites e estado físico](performance-overhaul-execution.md). Não houve substituição do runtime atual, medição física válida nova, SIMD ou pthreads.

O `Makefile.emscripten` atual do fork RetroArch usa `-O3` em release e oferece `LTO=1`; o script da alternativa usa `SNES9X_OPT` com padrão `-O3`. Isso descreve as fontes consultadas, **não comprova as flags dos binários históricos**. Não há `emcc`/`wasm-opt` instalado nesta sessão; não se executou uma comparação compilada `O3` versus `Oz`/LTO. A comparação disponível é entre dois artefatos reais de engines diferentes.

| Variação futura | Hipótese e prova exigida |
|---|---|
| `-O3` | Baseline compilada reproduzível, com toolchain/core SHA e saída igual |
| `-Oz` | Pode reduzir transferência/compilação e também piorar execução. Medir bytes, boot e frame separadamente |
| `-flto` | Aplicar na compilação/link de todas as partes compatíveis; testar regressão. O próprio fork alerta que pode quebrar cores |
| `-msimd128` | Detectar suporte com `WebAssembly.validate`, emitir build fallback e confirmar uso efetivo nos hotspots. A flag isolada não transforma todo código em SIMD |
| Heap por core | Reduzir inicial de 128 MiB em build experimental; provar boot, hi-res, chips e estados sem OOM. Não editar bytes do WASM existente |
| Remoção de componentes | Shim direto elimina frontend amplo, mas transfere input/áudio/saves para outra implementação. Contabilizar esse custo |
| `-pthread` | Exige build próprio, contexto seguro, COOP/COEP e `SharedArrayBuffer`; HTTP LAN atual não atende. Threads não são um ganho automático para um core serial |
| AudioWorklet | Separa consumo de áudio do visual, mas exige transporte/buffer, política de áudio e HTTPS confiável na TV |

## Licenças e fronteira de adoção

EmulatorJS/RetroArch e Moonlight/Sunshine: GPL-3.0 conforme repositórios. PCSX ReARMed/Beetle: GPL-2.0, com revisão adicional dos componentes incorporados antes de redistribuir. Snes9x/2005/2010 têm licença própria com restrição comercial; **não são MIT/GPL só porque usam Libretro**. A alternativa declara MIT para o wrapper em `package.json`, mas seu core continua sujeito à licença Snes9x. Emscripten combina licenças permissivas e dependências que devem acompanhar o build.

Nenhuma dependência de produção foi acrescentada. Os downloads experimentais ficam ignorados pelo Git, separados, com SHA fixo e licença a revisar antes de redistribuição. [Licenças Libretro](https://docs.libretro.com/development/licenses/) e os `LICENSE`/`COPYING` dos repositórios são as fontes de referência; o campo `NOASSERTION` do GitHub não substitui leitura da licença.
