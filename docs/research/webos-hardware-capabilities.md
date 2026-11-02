# LG 55QNED70BSA: capacidades observadas

Data: 17/10/2026, America/Sao_Paulo. Base do app auditado: `a69e2f70bc69aaeb98549b9611e9c6a0abaa2e38`.

As leituras deste relatório são históricas. [Continuação local](performance-overhaul-execution.md): ensaios físicos adicionais não foram concluídos e ficaram bloqueados por autorização específica do usuário; nenhum acesso/teste na TV deve ocorrer sem ela. O descarte do proprietário de proteção foi endurecido/testado localmente; eficácia física continua pendente.

## Identidade e limites da evidência

O usuário informou **55QNED70BSA**, webOS26/**11.2.0-2909**, e lentidão em Super Mario desde o primeiro frame. Consulta física `ares-device -i` confirmou:

| Dado | Leitura física |
|---|---|
| Modelo | 55QNED70BSA.BWZDLJZ |
| SDK | 11.2.0 |
| Firmware | 43.21.41 |
| Board | K25LPN_ATSC_BR |
| Arquitetura kernel | aarch64 |
| CPUs | 4; `/proc/cpuinfo`: arquitetura 8, parte 0xd09 |
| Frequência CPU0 atual/máxima exposta | 1.235.600 kHz nas duas leituras |
| Memória visível ao monitor do sistema | 1.748.816 KiB (~1,67 GiB) |
| Available naquele instante | 414.968 KiB; leitura pontual, não orçamento garantido ao app |
| Swap | 921.592 KiB total, 419.824 KiB usados naquele instante |

Não inferir frequência de todas as CPUs, throttling sustentado, RAM física comercial ou memória livre do app a partir dessas leituras. Os quatro cores não tornam um core WASM serial quatro vezes mais rápido. A página comercial [LG do modelo exato](https://www.lg.com/br/tvs-e-soundbars/qned/55qned70bsa/) descreve alpha 7 AI Gen9: processamento de imagem/IA não é capacidade automaticamente acessível a JavaScript/WASM.

## Navegador real

O inspector do **app com.superflipcb.app** retornou Chromium **132.0.6834.207**, quatro processadores lógicos, viewport/tela gráfica **1920×1080**, DPR 1. Isso corresponde à [tabela LG de web engines](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine), que associa webOS TV 26 a Chromium 132. Não presumir saída gráfica 4K por ser um painel 4K.

[Snapshot físico](data/tv-device-2026-10-17.json): no launcher `file:` o contexto era seguro, Wake Lock/AudioWorklet/PalmServiceBridge existiam; `crossOriginIsolated=false` e `SharedArrayBuffer` ausente. **Essas capacidades precisam ser medidas novamente depois de navegar para HTTP LAN.** Contexto seguro da página empacotada não torna `http://IP-privado` seguro. Os relatórios de gameplay registram o contexto efetivo.

Um [probe físico](data/tv-feature-probe-2026-10-17.json) validou um módulo mínimo com `i8x16.splat`: **WASM SIMD aceito pelo navegador**. Isso não demonstra que o core instalado foi compilado com SIMD ou que seus hotspots o aproveitam. `SharedArrayBuffer` continuou ausente. RAM do sistema, heap linear WASM, JS heap e quota de armazenamento são medidas distintas.

## Protetor de tela

A [política oficial LG](https://webostv.developer.lge.com/develop/guides/screensaver) usa inatividade; a exceção documentada é vídeo em tela cheia. Uma animação Canvas não é esse vídeo. Os tipos 2/3 destinam-se aos casos documentados de OLED e não são uma chave geral para desativar o protetor de uma QNED durante jogo. `cloudgame_active` trata eventos de controle, não garante prevenção do protetor.

O glue WASM local já tenta `navigator.wakeLock.request('screen')`, mas guarda a Promise sem tratar sua rejeição. A recusa foi reproduzida no desktop. Em HTTP LAN a API pode nem existir. A implementação agora:

1. Centraliza a proteção em `public/player/platform.js`, no documento principal da sessão.
2. Solicita Screen Wake Lock durante execução; libera ao pausar, ocultar ou sair; trata recusa e aquisição tardia.
3. Usa fallback Luna **não documentado como API pública LG**: registra requisições de protetor e responde `ack:false` somente enquanto há gameplay visível. Pausa/menu/ocultação permitem `ack:true`. Um nome de cliente por lifecycle evita colisão com registro ainda encerrando após navegação; isso corrige a recusa `power is busy` observada numa janela invalidada. Não altera timeout global, brilho, energia ou manifesto de permissões.
4. Desativa a tentativa concorrente de RetroArch com `suspend_screensaver_enable=false` somente na integração Super Flip. Não desativa o protetor global do sistema.
5. Exporta status de API, registro/recusa, razão e contagens de pedidos/vetos/respostas aceitas. “registered” não significa que o bloqueio foi comprovado durante 30 min.

A semântica Luna foi pesquisada em [código aberto de integração webOS](https://github.com/CheerChen/webos-tv-kit/blob/main/js/webos-platform.js), não copiada como dependência. Ela pode ser recusada por ACL/firmware em hosted apps. Não foi solicitado root nem ampliada permissão do IPK. Se o fallback for recusado, registrar a limitação e avaliar shell empacotado com integração aprovada; não simular teclas ou reproduzir vídeo oculto.

O ensaio prolongado desta rodada terminou oculto e pausado; o usuário confirmou que usou Home/standby/outro aplicativo no intervalo. Essa intervenção invalida o teste de inatividade: não se atribui a ocultação ao protetor. O registro estava ativo, mas não recebeu pedidos. [Dados](data/tv-inactivity-2026-10-17.json). A eficácia física da proteção permanece pendente.

## Perfil recomendado para este modelo

Manter 1080p/DPR 1, resolução interna original do core, sem filtros extras, sem rewind/runahead/netplay, input em um ciclo por display tick e saída GL1 como baseline. Comparar 720p e GL2 **somente com medidas físicas**, preservando saves. Medir frame CPU e saída separadamente antes de reduzir resolução: resolução de saída não corrige CPU/PPU cara.

Para sessões longas: três repetições, 60 s de aquecimento, 30 min de jogo; 60 min para estabilidade, além de menu/retomada/standby e tempo suficiente para o protetor. Os ensaios curtos desta investigação não substituem esse aceite.
