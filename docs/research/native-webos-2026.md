# Reengenharia nativa: auditoria e pesquisa em 18/10/2026

## Estado da evidência

**Confirmado em fonte:** existe um port nativo funcional do RetroArch, com
`Makefile.webos`, SDL2, GLES, PulseAudio e cores dinâmicos. O usuário relata que
esse port tem desempenho muito superior nesta LG. Esse relato é a principal
evidência experimental, mas não contém ainda versão/core/configuração ou uma
série de medições comparáveis.

**Implementado:** PoC aditiva em `apps/tv-native`, usando o RetroArch lançado
1.22.2 sem alterações nos drivers/core host; preparação LAN em C++; build ARMv7,
diagnóstico nativo, empacotamento e testes. A escolha definitiva entre fork e
frontend próprio permanece sujeita ao custo de integração e ao desempenho físico.

**Testado localmente:** compilação ARMv7, contratos do lançador e pacote, e core
nativo de desktop com uma ROM diagnóstica original. Evidências e comandos estão
em [native-build.md](../development/native-build.md).

**Pendente físico:** funcionamento deste IPK específico na 55QNED70BSA, ABI das
bibliotecas do firmware, GL/EGL, PulseAudio, controles, lifecycle, LAN real,
SRAM após reboot e comparação sustentada. Nenhuma TV foi acessada nesta execução.

## Auditoria do sistema existente

Git inicial: `codex/performance-investigation`, com alterações rastreadas e
arquivos novos de outra investigação. Criada `codex/native-webos-poc` mantendo
esse estado. Nenhum arquivo preexistente foi editado para fazer a migração.

| Área auditada | Comportamento/invariante | Destino |
|---|---|---|
| `apps/webos-launcher` | `type: web`, configuração do endpoint e navegação HTTP; `cloudgame_active` não torna o runtime nativo | Preservar para rollback; o IPK novo tem outro ID |
| `apps/tv-client`, App/Player/adapter | Catálogo React; iframe recebe jogo e controla sessão por mensagens; não há emulação no PC | Reaproveitar experiência/contratos; não portar React obrigatoriamente |
| `public/player/bridge.js` | EmulatorJS 4.2.3, Snes9x/RetroArch WASM, threads desativadas; o browser participa de input/A/V/pacing | Retirar do caminho nativo, conservar no legado até aceite |
| `controls.js`, `navigation.ts`, `platform.js` | Há melhorias recentes de polling único, neutralização/foco e proteção de tela | Preservar; não reaplicar nem atribuir ganho nativo a elas |
| `server/app/catalog.py` | Somente SNES `.sfc/.smc`; ID `snes-<SHA256>`; deduplicação e confinamento de caminhos | Reutilizar sem alterar |
| `server/app/main.py` | Catálogo paginado, detalhe, ROM GET/HEAD/Range, integridade revalidada; API não emula | Reutilizar detalhe/ROM no P0; Range para pesquisa posterior de mídia óptica |
| `server/app/saves.py`, schemas/runtime | Envelope atômico, lock entre processos, checksum, backups e ETag; identidade amarrada a EmulatorJS/build | Preservar integralmente; não falsificar a identidade de saves nativos |
| `scripts/runtime`, benchmark, package/deploy/backup | Toolchains/experimentos web separados; empacotamento legado tem ID próprio | Conservar; novos scripts isolados em `scripts/native` |
| `docs`, tokens e licenças | Identidade escura/roxo/foco amarelo, fontes OFL; testes físicos anteriores têm limites expressos | Reutilizar o design no gate de UI, sem afirmar que já foi integrado |

O caminho atual é ROM no PC → HTTP → MEMFS/EmulatorJS → RetroArch/WASM →
core → WebGL/WebAudio/compositor. O novo caminho é uma ROM SNES por HTTP →
cache temporário verificado → RetroArch ELF → core `.so` → GLES/SDL/PulseAudio.
Depois de `execv`, o processo de preparação deixa de existir: não há polling,
rede ou cópia de framebuffer acrescentados pelo adaptador durante o jogo.

Inventário somente de metadados: um envelope SRAM existente, 2.048 bytes,
`coreId=snes9x`, `coreVersion=emulatorjs-4.2.3`,
`coreBuild=snes9x-eaa0bcfce676-7d427a575cef`. Não foi convertido, carregado no
core nativo ou regravado. A igualdade de tamanho não comprova compatibilidade.

## Fontes fixadas e versões

Consulta via Context7 para RetroArch, SDL, webOS comercial, libcurl e OpenSSL;
verificação direta de fontes/releases para flags, APIs e bibliotecas. Context7
não encontrou json-c: consultados seus headers oficiais, commit
`9e99c1cfe77573496e9ea6da5153e4fd7e2cbde0`.

| Fonte | Referência consultada | Resultado relevante |
|---|---|---|
| [libretro/RetroArch](https://github.com/libretro/RetroArch/tree/cb311c274d06bbc115fe522e89b18deea5f7a452) | HEAD `cb311c274d06bbc115fe522e89b18deea5f7a452` | Makefile atual já prevê SDL2/3, ARM32/64 e alternativas Wayland; isso não valida todas as variantes na TV |
| [webosbrew/RetroArch](https://github.com/webosbrew/RetroArch/tree/4c4953bf331348263cd68df0b654cf00583b437a) | release **1.22.2**, tag commit `4c4953bf331348263cd68df0b654cf00583b437a`; branch webos consultada `91430b9faa881e9ec2e35095de1c678eccc2aedb` | Base estável escolhida para a PoC, não HEAD móvel |
| [retroarch-cores](https://github.com/webosbrew/retroarch-cores/tree/78071a5c295720023e9326742c4e951501ede1c7) | `78071a5c295720023e9326742c4e951501ede1c7` | ARMv7 recomendado; AArch64 descrito como experimental e dependente de bridge |
| [native-toolchain](https://github.com/webosbrew/native-toolchain/tree/730dbd680cc319935655b1b04c2d80fcb62fdb22) | `730dbd680cc319935655b1b04c2d80fcb62fdb22` | SDK relocável, integração CMake; Linux/WSL apropriado |
| [Buildroot NDK](https://github.com/openlgtv/buildroot-nc4/releases/tag/2026.08-webos) | **2026.08-webos**, GCC **16.2.0**, ARM EABI softfp | SDK e arquivo verificados por SHA-256; sysroot não substitui o firmware da TV |
| [SDL-webOS](https://github.com/webosbrew/SDL-webOS/tree/ba4c86af391d1524d3ff0cb61dc3b10035933239) | fonte `ba4c86af391d1524d3ff0cb61dc3b10035933239`; runtime **2.30.12-webos.5 ABI** | Port Wayland/webOS, integração Luna, HID/joystick e hotplug; sem migrar implicitamente para SDL3 |
| [template-native-gui-app](https://github.com/webosbrew/template-native-gui-app/tree/b211c67c648f37e9c9a76bfa212178aef75357e0) | `b211c67c648f37e9c9a76bfa212178aef75357e0` | Exemplo CMake + SDL/LVGL; é antigo e não prova suporte físico atual |
| [ares-cli-rs](https://github.com/webosbrew/ares-cli-rs/tree/ed48a05897e1b646d2b86f473a2c2d5280daae61) | `ed48a05897e1b646d2b86f473a2c2d5280daae61`, packager **0.7.0** | Empacotamento Linux sem instalar ferramentas na TV |
| [Flutter webOS](https://github.com/lg-flutter-webos/flutter-webos/tree/950398131830e9bd5dc91e588c3db8f5c42322be) | `950398131830e9bd5dc91e588c3db8f5c42322be` | SDK oficial, Flutter 3.38.10; documentação declara webOS **26 Re:New** e Ubuntu/WSL/Docker |
| [Plugins Flutter](https://github.com/lg-flutter-webos/plugins/tree/3a742bb86b04e261044f0864f9b1f71acf0bbad3) | `3a742bb86b04e261044f0864f9b1f71acf0bbad3` | `webos_image_texture` usa PixelBufferTexture e memcpy; não é prova de compartilhamento GPU eficiente para libretro |
| [NDK Flutter](https://github.com/lg-flutter-webos/ndk/releases/tag/11.2.0) | repo `bbae5dc23e131dc8f47e03a353efe8906b382f3b`, NDK **11.2.0 ca9v1** | Toolchain de userspace ARM32; firmware/kernel AArch64 não implica aplicativo AArch64 |
| [Snes9x](https://github.com/libretro/snes9x/tree/fae2fea08f74180759ef540ee94259213f503480) | `fae2fea08f74180759ef540ee94259213f503480` | P0 compilado da fonte; LTO explicitamente opt-in e desativado por histórico de miscompilação |
| [PCSX ReARMed](https://github.com/libretro/pcsx_rearmed/tree/c8816799b50388e61cfe237fe2cdbb7d8175f20a) | `c8816799b50388e61cfe237fe2cdbb7d8175f20a` | Candidato P1; dynarec/NEON, BIOS, discos e formatos exigem validação por build/ABI |
| [Moonlight TV](https://github.com/mariotaku/moonlight-tv/tree/cf96ecc72cdab3aae7ba0698f463b89065ae7e3b) | `cf96ecc72cdab3aae7ba0698f463b89065ae7e3b` | Caminho maduro opcional com Sunshine; não integrado ou instalado nesta execução |

Hashes completos de downloads e URLs: `apps/tv-native/runtime.lock.json`.
Notices e licenças: `apps/tv-native/THIRD-PARTY.md` e `licenses/sources.json`.
RetroArch é GPLv3+, libretro API MIT, SDL Zlib; cores têm licenças individuais.
Uso pessoal não elimina obrigações ao redistribuir. Alguns plugins oficiais
Flutter têm cabeçalhos `LicenseRef-LGE-Proprietary`: não presumir licença BSD
para todo o conjunto nem copiar código sem revisão.

## O que o port efetivamente faz

No release escolhido, `HAVE_DYNAMIC/HAVE_DYLIB=1` preserva o host completo:
`dlopen/dlsym`, callbacks libretro, opções, pixel formats/geometria, VFS,
hardware contexts, SRAM e serialize/unserialize. Não implementamos uma API
libretro parcial como runtime de produção. `-L <core.so> <arquivo>` recebe um
caminho local; uma URL HTTP não é passada ao core.

`gfx/drivers_context/sdl_gl_ctx.c` usa o contexto **gl_sdl**, SDL_GL e GLES,
consulta foco de teclado no webOS e trata quit/resize. SDL webOS integra a
superfície com Wayland; `HAVE_EGL=0` no Makefile não significa ausência de EGL
abaixo de SDL. `input/drivers/sdl_input.c` e
`input/drivers_joypad/sdl_joypad.c` são os drivers SDL2 do release; o último
processa adição/remoção e alimenta autoconfig/múltiplos jogadores do RetroArch.
O driver PulseAudio gerencia a saída de áudio nativa. No release, ALSA está
desabilitado por observação upstream de congelamento ao voltar do menu.

O Makefile usa `-mcpu=cortex-a9 -mtune=cortex-a53 -mfloat-abi=softfp`, NEON
no frontend ARM32, `-O2` Release, threads disponíveis e pacote `type: native`.
Não se deve transformar essas flags em uma identificação da CPU física, nem
assumir que todo core usa NEON ou multithreading. O Snes9x P0 usa o target
ARMv7 portable do upstream e sua otimização normal, sem alterar algoritmos.

Lifecycle reutiliza o runloop e liberação do RetroArch/SDL: pausa por foco,
menu, unload/deinit e escrita de SRAM no encerramento normal. Isso não garante
que o firmware entregue tempo para salvar antes de matar o processo. Standby,
Home, retorno, protetor de tela e encerramento abrupto são gates físicos.

Developer Mode é a premissa, sem root. Acesso a dispositivos/bibliotecas e
serviços Luna não é garantido pelo modelo/versão. ACG no webOS 26 Re:New é
opt-in quando `requiredACG` é declarado e obrigatório a partir do webOS 27,
conforme [guia LG](https://webostv.developer.lge.com/develop/guides/acg-guide).
Mantido o manifesto nativo comunitário sem inventar ACGs ou ampliar privilégios.
O eventual endurecimento deve enumerar as chamadas reais do SDL e as permissões
disponíveis no firmware comercial. O [simulador LG](https://webostv.developer.lge.com/develop/tools/simulator-introduction)
não valida apps nativos.

## Comparação das quatro arquiteturas

`Pendente` significa sem medida física comparável, nunca valor zero. A coluna A
inclui a PoC baseada no runtime sem fork funcional dos drivers.

| Critério | A: RetroArch nativo | B: frontend C++ próprio | C: Flutter + engine nativa | D: local + streaming opcional |
|---|---|---|---|---|
| Velocidade/FPS SNES | Relato físico favorável do usuário; candidato novo pendente | Pendente; host/driver novo pode regredir | Pendente, inclusive custo de superfície | Local igual à escolha A/B; remoto pendente |
| CPU/GPU | Stack existente; medir mesmo core/config | Controle maior, mas trabalho de pacing/render novo | UI/engine podem competir; sem prova de textura adequada | Emulação/encode PC + decode TV no remoto |
| Latência de input | Drivers nativos existentes; medição pendente | Todo o caminho a implementar/medir | Arbitragem Flutter/engine a provar | Acrescenta LAN/encode/decode; medir externamente |
| Áudio | PulseAudio maduro no port; teste deste pacote pendente | Buffers/resample/sync/underrun por implementar | Integração e ownership ainda por provar | Sincronização do protocolo maduro; teste pendente |
| Memória | Medir por processo/core | Potencial controle, sem número medido | Dois runtimes; orçamento não medido | TV decoder + cliente; PC emula |
| Inicialização | Preparação limitada + exec, boot medido no dispositivo ainda pendente | Pendente | Pendente | Depende de pairing, host e sessão |
| webOS 26 | RetroArch do usuário funciona; este build ainda não aceito | SDL fornece caminho plausível, não validado | Suporte declarado oficialmente para 26 Re:New; modelo exato pendente | Moonlight precisa aceite próprio |
| Controles | SDL/autoconfig/remap/hotplug existentes | Responsabilidade integral do projeto | Plugins não resolvem sozinhos input exclusivo | Clientes maduros; mapear e medir |
| Identidade visual | Skin de RGUI limitada; novo menu exige integração GPL | Maior liberdade; custo de UI/render próprio | UI expressiva; textura/libretro ainda gate bloqueante | Catálogo pode escolher cliente separado |
| LAN | Preparação C++ P0 reutiliza API atual; catálogo completo ainda não | Mesmo contrato possível | Mesmo backend possível | Local independente; streaming usa Sunshine/Moonlight |
| Saves | Host maduro; migração/sync Super Flip separados | API/persistência toda por implementar | Engine ainda precisa do mesmo save manager | Namespaces local/PC separados |
| Manutenção/risco | Menor risco inicial de emulação; fork profundo tem custo de upstream | Maior responsabilidade por contrato libretro e drivers | SDK/embedder/plugin/superfície e licenças adicionais | Mais infraestrutura somente quando modo remoto usado |
| Instalação | IPK ARMv7 estruturalmente verificável, Developer Mode pendente físico | Mesmas restrições nativas | SDK/NDK oficiais e Developer Mode | Instalação/pareamento separados e autorizados |
| PS1 | PCSX ReARMed candidato já existe; não validado neste app | VFS/discos/dynarec/hw APIs ampliam escopo | Mesmo engine + risco de textura | Alternativa para títulos inviáveis localmente |

## Decisão e limites por sistema

Adotar A como **baseline executável de engenharia**, com um adaptador pequeno e
fora do frame loop. Não abrir um fork profundo nem construir B antes de provar
que o catálogo, saves e um protótipo do design system cabem com manutenção
aceitável. Ver ADRs. Flutter fica condicional: suporte oficial é relevante,
mas não prova zero-copy ou latência. Não construir a UI inteira para avaliar isso.

P0 SNES primeiro. P1 PCSX ReARMed exige identificar ABI/dynarec, legalidade de
BIOS, cartão, troca de disco e formatos efetivamente compilados; CHD/PBP não são
prometidos por haver uma opção no código. P2 Mega Drive/Atari reutilizará o host,
com licenças e aceite individual. O inventário de cores webOS registra PS2 sem
JIT ARM32; presença de `pcsx2` experimental AArch64 não demonstra viabilidade
nesta TV. Requisitos de CPU/ISA/JIT e GPU de PS2 excedem o caminho ARMv7/GLES2
adotado e não há benchmark local comprobatório. PS2 fica no modo remoto opcional,
usando [Sunshine](https://docs.lizardbyte.dev/projects/sunshine/latest/) e Moonlight,
sem desenvolver protocolo e sem exigir PC emulando no modo local.
