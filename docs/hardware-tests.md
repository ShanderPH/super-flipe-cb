# Validação física — parcial, sem aceite de release

**Autorização obrigatória:** por instrução expressa do usuário, nenhum novo acesso/teste na TV, inspector, lançamento, túnel, instalação ou restauração de tela sem autorização específica para a sessão. A tentativa desta continuação foi interrompida sem resultado físico novo. [Correções locais e pendências verificáveis](research/performance-overhaul-execution.md).

Posteriormente, o usuário autorizou **atualizar o IPK e iniciar o servidor**. Essas duas ações foram concluídas: launcher 0.0.2/1080p confirmado pelos metadados de instalação; servidor em `http://192.168.15.4:8797/` conferido pelo PC. A instalação não incluiu abrir o app ou executar jogos. Os gates físicos abaixo continuam sem novo aceite; [registro operacional](validation.md).

Atualização de 17/10/2026: 55QNED70BSA.BWZDLJZ, SDK 11.2.0, firmware 43.21.41, Chromium WAM 132.0.6834.207, viewport 1920×1080/DPR1. Relato do usuário: webOS26 / 11.2.0-2909, Super Mario lento desde o primeiro frame; controles corrigidos funcionando.

Foram executados ensaios reais via inspector no app já instalado, usando cópia temporária da ROM local, sem saves reais. A confirmação A/V on/profiler off após 60 s de aquecimento mediu 34,454/37,367 core frames/s em janelas de 30 s: **NO-GO de desempenho para esse cenário**. GL2 e ensaio de inatividade estão discriminados no [benchmark](research/benchmark-results.md); nenhum resultado desktop preenche esses gates. Não houve reinstalação de IPK, prova SRAM real ou aceite PS1.

O texto abaixo é o checklist de aceite; os campos pendentes continuam pendentes apesar da execução parcial. A antiga orientação de deixar toda PoC para depois foi superada pelo pedido atual de investigação/benchmark.

Não há GO técnico nem aprovação do MVP.

Antes de testar, preencher: data, LG/modelo real, firmware/webOS, endereço LAN reservado, Wi-Fi/Ethernet, CLI, versão/commit da engine, hashes dos cores, controle/modelo/conexão e identificador da ROM legítima. Não publicar ROMs nem dados pessoais no relatório.

| Gate | Procedimento | Estado / evidência |
|---|---|---|
| S0 | Empacotar/instalar launcher, Home, endpoint, servidor desligado, IP errado e timeout | Pendente |
| S1 | Diagnóstico, resolução/DPR, teclas Back/OK, gamepad USB/Bluetooth, `cloudgame_active` false/true em builds comparativas | Pendente |
| S2 | SNES legítimo, engine local sem internet, início explícito do áudio | Boot real de Super Mario World medido; áudio perceptivo/offline ainda pendentes |
| S3 | 30 min nominal NTSC/PAL, áudio, latência; 60 min antes de uso prolongado | Pendente |
| S4 | 5 ROMs, IndexedDB/Cache Storage antes/depois e após reabrir; distinguir ROM/core de SRAM/estados | Pendente |
| S5 | Gravar jogo + servidor, sair/fechar/reabrir, checksum, restauração, conflito e backup | Pendente |
| S6 | Home/standby, desconectar/reconectar gamepad, servidor offline/retorno sem perda silenciosa | Pendente |
| S7 | Comparar webЯcade apenas se existir bloqueador relevante | Condicional |
| S8 | PS1, BIOS/RAM/áudio/cards/multidisco | PoC real desktop chegou à tela de título de Castlevania; BIOS/disco e bytes de card conferidos. Sem execução LG ou aceite de save/áudio/estabilidade; CHD/multidisco pendentes |

UI: todas as telas acessíveis por setas/OK/Back, foco restaurado, legibilidade a 2–3 m, overscan, contraste, reduced-motion e zoom real de 200%. Export/import na TV depende de acesso real a arquivos/download; não declarar operacional com base no browser desktop.

Não inferir RAM pelo espaço livre do filesystem ou por quota da origem. Se a medição de memória não existir, registrar crashes/reloads e a limitação. Frames de `requestAnimationFrame` não comprovam FPS do core.

Decisão de release: **NO-GO enquanto o SNES medido estiver abaixo do aceite**. Continuam pendentes cache/SRAM/input ampliado e sessões longas. Hospedagem remota de arquivos não acelera WASM local; processamento remoto é outra arquitetura, avaliada separadamente no relatório híbrido.

## Preparação após auditoria

O launcher 0.0.2 já é empacotado com `cloudgame_active=true`; o JSON `.verified.json` registra o manifesto extraído e o hash. O pacote de 720p é comparativo, não vencedor presumido. Procedimento detalhado e cobertura por prioridade: [audit-improvements.md](audit-improvements.md).

Aceites permanecem abertos: 100 pressões Start/A/B; 20 reconexões físicas; 20 ciclos SRAM real; 60 s de aquecimento, três execuções por configuração, 30 min sustentados e 60 min antes de uso prolongado. Marcar ruídos de áudio, formato USB/Bluetooth, tela efetiva e acesso ao arquivo exportado. Só habilitar sincronização após comprovar restauração no jogo. Não usar os testes sintéticos como aceite desses gates.
