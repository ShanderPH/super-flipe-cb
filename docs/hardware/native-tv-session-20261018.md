# Sessão física nativa — 18/10/2026

Este relatório registra a PoC SNES original. O app posterior
`com.superflipcb.native`, com interface e PS1, está descrito em
[Interface nativa, PS1 LAN e progresso](../development/native-product.md).

Instalação e lançamento autorizados pelo usuário na LG 55QNED70BSA.BWZDLJZ,
webOS SDK 11.2.0, firmware 43.21.41, dispositivo `superflip-tv` (192.168.15.11).
Somente o ID experimental `com.superflipcb.native.poc` foi instalado.

## Pacote instalado

Release: `artifacts/native/tv-test-shm-20261018/ipk/com.superflipcb.native.poc_0.1.0_arm.ipk`,
8.711.726 bytes, SHA-256
`c1c173b78af75e35e43e2e77c3344b889027ec8454581a6606f9d8e954dcd766`.
Build e verificação do IPK aprovados; 19 testes do lançador passaram novamente.
Os seis testes de pacote incluem rejeição de DT_RUNPATH.

Dois pacotes anteriores desta sessão foram substituídos: `tv-test-release-20261018`
(`095185e4dd33cc8fd47d7669b6a215868854b462c4f0276d666d86710255e04a`)
e `tv-test-rpath-20261018`
(`199bc810fc30bd5a9d3fb1a60fbf9b6ab87135ac6e4c4e7afdf5e7c5a24006d5`).

## Correções observadas no firmware

O `LD_LIBRARY_PATH` da LG prioriza `/lib`. DT_RUNPATH nas dependências permitia
misturar `libssl.so.3` do sistema com `libcrypto.so.3` do app, causando erro
`ENGINE_init`. RPATH relativo em cada biblioteca corrigiu a resolução sem mudar
o ambiente global; launcher e RetroArch executaram sem override de ambiente.

`/tmp` é somente executável pelos usuários comuns (`0111`), impedindo criar o
cache. `/dev/shm` é tmpfs gravável, agora usado com subdiretório privado por UID,
mantendo o limite de uma ROM pronta e 32 MiB no pico de substituição. A configuração
`session.json` precisa de modo 0644, pois o usuário SSH é UID 5990 e o app é UID
6676. Os dados experimentais continuam privados (0700).

## Evidência de execução

Servidor existente mantido em `http://192.168.15.4:8797`, PID Windows 30536.
API de detalhe responde HTTP 200. A preparação nativa obteve a ROM de 1 MiB,
validou seu SHA-256 e executou RetroArch 1.22.2 com Snes9x nativo e Super Mario
World (`snes-d728815c92e7e38de86f6fdc1742ad73db124bbdf91d366bc7392f6d4cb5291a`).

O gerenciador oficial lista o app ativo; processo `retroarch` PID 19268, UID
6676, com argumentos do core e ROM corretos. O surface-manager registrou a janela
visível às 04:55:51 UTC e PulseAudio abriu stream estéreo de 48 kHz para esse PID.
Esses registros comprovam inicialização e sessão ativa, sem medir FPS, qualidade
da imagem, som audível ou resposta do controle. Select+Start abre o menu RGUI.

SRAM/estados nativos usam namespace próprio; o hash do envelope legado real
foi conferido novamente e permanece igual. Não houve migração, acesso root,
alteração de firmware ou substituição do RetroArch baseline/app legado.

Após esta sessão, o usuário informou que os testes na TV com Super Mario foram
bem-sucedidos e que o desempenho foi excelente. Isso registra aceite funcional
inicial do SNES e avaliação qualitativa de desempenho. Não foram informados
duração, modelos de controle, ensaios de persistência ou medições de FPS/latência.

Continuam pendentes: save/reload/reboot, matriz de controles/lifecycle
e benchmark comparativo sustentado de 30/60 minutos. A interface atual é a PoC
técnica RGUI; catálogo visual e design system ainda não foram integrados.
