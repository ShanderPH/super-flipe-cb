# Build e validação da PoC nativa

Este documento registra a PoC SNES inicial. O código atual gera o app separado
`com.superflipcb.native`, com UI e PS1. Para instalação/configuração e os resultados
atuais, veja [produto nativo](native-product.md). A PoC `.native.poc` permanece
instalada como referência e não é substituída pelo novo pacote.

Data: 18/10/2026. Branch `codex/native-webos-poc`. Implementação aditiva.
Build instalado e iniciado na LG após autorização do usuário; detalhes e pacote
atual em [sessão física](../hardware/native-tv-session-20261018.md). Os resultados
locais abaixo documentam a etapa anterior à instalação. Sem migração de saves.

## Pré-requisitos e entradas

Host usado: Windows + WSL2 **SuperFlipNative**, Ubuntu Base **24.04.3**.
Rootfs oficial verificado:
`ubuntu-base-24.04.3-base-amd64.tar.gz`, SHA-256
`6bc2cde3930ad088b3bb46fa45279e96d25bc3810f209850ecbe4722711874f9`.
O arquivo e os SHA256SUMS consultados ficam em `artifacts/native/downloads`.
Não há exigência de root na TV; permissões administrativas dentro do Linux de
build são independentes do alvo.

No Ubuntu/WSL:

```sh
apt-get update
apt-get install -y --no-install-recommends build-essential cmake ninja-build pkg-config python3 ca-certificates patchelf libcurl4-openssl-dev libjson-c-dev libssl-dev libsdl2-dev libegl1-mesa-dev libgles2-mesa-dev
```

O script baixa somente fontes/toolchain/bibliotecas/packager fixados em
`apps/tv-native/runtime.lock.json`. Não baixa ROM, BIOS ou save. Verifica SHA-256
de entradas em cache e baixa para temporário antes de admitir. A toolchain fica
no Linux em caminho sem espaços; não ativa variáveis permanentemente no Windows.

## Compilar

```powershell
.\scripts\native\build.ps1 -Distro SuperFlipNative -Configuration Release -WorkDirectory /opt/superflip-native -OutputDirectory .\artifacts\native\Release
.\scripts\native\package.ps1 -Distro SuperFlipNative -BuildDirectory .\artifacts\native\Release
```

Alternativa no Linux:

```sh
python3 scripts/native/build.py --work /opt/superflip-native --output artifacts/native/Release --config Release
python3 scripts/native/package.py --build artifacts/native/Release
```

Para Debug, mudar `--config Debug`/`-Configuration Debug` e escolher outra pasta
de saída. Outputs existentes não são sobrescritos. Um diretório de fontes
preexistente sem o marcador do input verificado é recusado: usar outro `--work`.
Mudança de receita/perfil invalida objetos; lock exclui builds concorrentes no
mesmo worktree. A reprodução fixa entradas e receita; equivalência bit a bit
entre hosts/caminhos diferentes ainda não foi demonstrada.

O release RetroArch é compilado com `Makefile.webos`, ARMv7 softfp, GLES2, SDL2,
PulseAudio, `-O2`. GCC 16 exige `-std=gnu99` explícito para a semântica C do release
antigo. Snes9x usa target `armv7`, otimização upstream e **LTO desativado**.
Debug symbols são separados; executáveis/bibliotecas têm stack não executável e
busca relativa por bibliotecas. Nenhum algoritmo/core/driver upstream é alterado.

O empacotamento usa **ares-package Rust 0.7.0**, tar/ELF no Linux e permissões
explícitas. A primeira tentativa com o CLI Node/Windows gerou arquivos 0666 e
foi recusada pela verificação; não usar aquele pacote experimental. O verificador
inspeciona o IPK real: manifesto/ID/tipo, arquitetura do pacote, ELF32 ARM EABI5
sem hard-float, interpreter, stack NX, permissões, conjunto e hashes dos arquivos.
Recusa userdata extra, ROM/WASM e links. Isso comprova estrutura, não instalação.

Saída: `app/`, `symbols/`, `logs/`, `build.json`, `ipk/*.ipk` e
`*.verified.json`. `build.json` registra fonte/SDK/SDL/core, compiler, flags,
hashes e bibliotecas que precisam existir no firmware. Os símbolos ficam fora
do IPK. As licenças acompanham o payload; fontes exatas permanecem nos downloads
para auditoria e obrigações de eventual distribuição.

## Testes locais reproduzíveis

```sh
python3 scripts/native/ci-smoke.py --work /tmp/superflip-native-smoke
```

Esse comando compila o C++ no host, executa 19 testes de LAN/cache/concorrência,
6 testes de pacote/ABI, compila o Snes9x nativo para desktop e executa uma ROM
diagnóstica original. O harness libretro de teste não é um frontend de produção.
O teste confirma dois ciclos load/unload, callbacks, alteração de SRAM por código
65c816 e roundtrip de serialize/unserialize; não toca em ROMs/saves do usuário.

Integração adicional com FastAPI real em loopback, com uv Linux **0.11.9** e
venv separada da instalação Windows:

```sh
UV_PROJECT_ENVIRONMENT=/tmp/superflip-native-server-venv uv run --project server python tests/native/test_api_integration.py --binary /tmp/superflip-native-smoke/host/superflip-native
```

Esse teste passou com dados descartáveis, ROM íntegra e envelope legado da
fixture byte a byte preservado. A inicialização do app ASGI padrão também é
isolada em pasta temporária. Isso não comprova a LAN entre PC e televisão.

No Windows, checks do backend existente e scripts novos:

```powershell
uv run --directory server pytest -q
uv run --project server ruff check scripts/native tests/native
uv run --project server ruff format --check scripts/native tests/native
uv run --project server python -m unittest discover -s tests/native -p test_package.py -v
```

CI `.github/workflows/native.yml`: testes desktop nas alterações nativas; build
ARM/IPK por dispatch explícito `cross_build=true`. Não instala/lança no dispositivo.
Configuração de CI não equivale a uma execução remota já concluída.

## Executar depois de autorização física

O pacote tem ID próprio `com.superflipcb.native.poc` e inicialmente abre RGUI.
Instalação não faz parte dos scripts nativos. O operador poderá usar o CLI
Developer Mode já configurado, somente depois de conferir hash e autorizar a
sessão. Preservar o app RetroArch baseline e `com.superflipcb.app`.

Gerar ROM original de diagnóstico, escolhendo uma saída nova:

```powershell
uv run --project server python scripts/native/make-test-rom.py artifacts/native/superflip-native-test.sfc
```

O arquivo não é incluído no IPK. Para testar LAN, o operador pode adicionar uma
cópia autorizada à pasta SNES do servidor e reiniciar seu índice. Obter `gameId`
pela API, criar `session.json` a partir de `session.json.example` e enviar esse
pequeno arquivo ao diretório do app experimental pelo mecanismo Developer Mode
autorizado. Não editar o IPK depois de verificado nem misturar saves legados.

O app usa `<app>/userdata` para progresso experimental e `/dev/shm` para uma ROM.
O `session.json` enviado por SSH deve ser legível pelo UID nativo do app (0644);
isso não altera a privacidade de `userdata` (0700). As bibliotecas empacotadas
usam RPATH relativo, inclusive dependências transitivas, para não misturar SSL
do sistema com crypto do pacote por causa do `LD_LIBRARY_PATH` da TV.
Antes de reinstalar/remover/atualizar o app, exportar `userdata` e conferir hashes.
Executar `capabilities.sh`, `native-probe` e o protocolo de benchmark/aceite.
Para apagar o experimento, remover apenas o ID experimental após backup; nenhum
script apaga o projeto, firmware, dados legados ou RetroArch do usuário.

## Resultado e pendências

**Confirmado/implementado:** pipeline ARMv7 real com runtime/core nativos, cache
LAN, empacotamento, símbolos, diagnóstico e isolamento dos dados.
**Testado:** 19 contratos do lançador, 5 contratos de IPK/ABI e core desktop real
(380 frames, 202.436 sample frames de callbacks, SRAM 2.048 bytes, dois ciclos e
roundtrip de estado). Contagens de callbacks não são frames apresentados ou áudio
audível. Evidências locais ficam em `artifacts/native`.
**Pendente físico:** carregar os ELF/bibliotecas no firmware, janela/A/V/input,
LAN real, lifecycle, persistência/reboot, performance A/B 30/60 min.
**Pendente de produto:** design system, catálogo visual, perfis próprios, sync
e migração de saves, PS1/outros cores e streaming opcional. Não há aceite nativo
completo, Flutter aprovado ou resultado de FPS na LG produzido nesta rodada.

## Artefatos e relatório desta execução

| Artefato local | Resultado |
|---|---|
| `artifacts/native/Release-2026-10-18/ipk/com.superflipcb.native.poc_0.1.0_arm.ipk` | Release, 8.711.772 bytes, verificação estrutural aprovada |
| `artifacts/native/Debug-2026-10-18/ipk/com.superflipcb.native.poc_0.1.0_arm.ipk` | Debug, 18.378.564 bytes, verificação estrutural aprovada; não usar para benchmark |
| `build.json`, `logs/`, `symbols/` dentro de cada build | Compiler/inputs/flags, fontes e arquivos do payload verificados, símbolos DWARF separados |
| `artifacts/native/validation/summary.json` e logs | 19 testes do lançador + 5 do pacote; core real e API real em loopback; nenhuma execução na TV |
| `artifacts/native/sdl-symbols.json` | 97 símbolos SDL importados pelo RetroArch e 29 pelo probe existem na SDL webOS empacotada; compatibilidade física continua pendente |

SHA-256 do IPK **Release**:
`d5e47a4414b6a1c63c4053725071832240aacb9b1c614411409e8de7fa8eefb3`.

SHA-256 do IPK **Debug**:
`602f07ad9b02108ba9d49fd0ea147534ec739ee082c819fd6fa2aa62b64e1579`.

Ambos são o mesmo ID/versão e se substituem entre si; nenhum substitui o
launcher legado ou o RetroArch baseline. Escolher somente um por instalação.
O build verificou novamente 5.045 arquivos de fonte originais do RetroArch e
177 do core contra os arquivos de origem. Não houve patch nos drivers/core host.
Pastas de tentativas anteriores em `artifacts/native` não são a entrega indicada.

Backend existente: **20 passaram, 1 skip preexistente** porque criar symlink no
Windows exige Developer Mode/privilégio; não foi adicionado skip ou retry.
Ruff e formatação dos scripts/testes novos passaram. Checksums de **48 arquivos
preexistentes** inventariados continuam iguais. Dados reais não foram migrados
nem gravados pelo caminho nativo. CI remoto está configurado, sem execução/push.

Também houve uma tentativa auxiliar de build desktop headless do RetroArch com
networking desativado; encontrou referências upstream a variáveis de netplay e
não foi usada como prova de execução. O teste do core usa um harness explícito,
com callbacks de laboratório. A tentativa ARM/QEMU antes de `main` permanece
inconclusiva, detalhada em [capacidades](../hardware/native-capabilities.md).
Não atribuir aprovação física a nenhum desses ensaios.

Arquivos novos principais: `apps/tv-native` (C++/CMake/config/manifest/lock e
licenças), `scripts/native` (build/package/verify/diagnóstico/ROM original),
`tests/native`, workflow nativo e os nove documentos de pesquisa/arquitetura/
migração/benchmark/hardware/build. O próximo gate é executar este pacote na LG
em sessão autorizada, identificar o baseline instalado e medir A/B antes de
integrar o produto ou decidir por um fork profundo/frontend próprio.
