# Validação pós-implementação — NÃO EXECUTADA

Por orientação do usuário, PoC e testes de viabilidade na LG ficam depois da implementação. Não há GO técnico nem aprovação do MVP.

Antes de testar, preencher: data, LG/modelo real, firmware/webOS, endereço LAN reservado, Wi-Fi/Ethernet, CLI, versão/commit da engine, hashes dos cores, controle/modelo/conexão e identificador da ROM legítima. Não publicar ROMs nem dados pessoais no relatório.

| Gate | Procedimento | Estado / evidência |
|---|---|---|
| S0 | Empacotar/instalar launcher, Home, endpoint, servidor desligado, IP errado e timeout | Pendente |
| S1 | Diagnóstico, resolução/DPR, teclas Back/OK, gamepad USB/Bluetooth, `cloudgame_active` false/true em builds comparativas | Pendente |
| S2 | SNES legítimo, engine local sem internet, início explícito do áudio | Pendente |
| S3 | 30 min nominal NTSC/PAL, áudio, latência; 60 min antes de uso prolongado | Pendente |
| S4 | 5 ROMs, IndexedDB/Cache Storage antes/depois e após reabrir; distinguir ROM/core de SRAM/estados | Pendente |
| S5 | Gravar jogo + servidor, sair/fechar/reabrir, checksum, restauração, conflito e backup | Pendente |
| S6 | Home/standby, desconectar/reconectar gamepad, servidor offline/retorno sem perda silenciosa | Pendente |
| S7 | Comparar webЯcade apenas se existir bloqueador relevante | Condicional |
| S8 | PS1, BIOS/CHD/RAM/áudio/multidisco | Fora do MVP |

UI: todas as telas acessíveis por setas/OK/Back, foco restaurado, legibilidade a 2–3 m, overscan, contraste, reduced-motion e zoom real de 200%. Export/import na TV depende de acesso real a arquivos/download; não declarar operacional com base no browser desktop.

Não inferir RAM pelo espaço livre do filesystem ou por quota da origem. Se a medição de memória não existir, registrar crashes/reloads e a limitação. Frames de `requestAnimationFrame` não comprovam FPS do core.

Decisão final: **PENDENTE**. Se cache de ROM persistir sem controle, SRAM não recuperar ou SNES não for jogável, registrar NO-GO antes da release v0.1.0 e avaliar correções/engine alternativa. Não mudar para cloud para tentar corrigir desempenho da CPU/GPU da TV.

## Preparação após auditoria

O launcher 0.0.2 já é empacotado com `cloudgame_active=true`; o JSON `.verified.json` registra o manifesto extraído e o hash. O pacote de 720p é comparativo, não vencedor presumido. Procedimento detalhado e cobertura por prioridade: [audit-improvements.md](audit-improvements.md).

Aceites permanecem abertos: 100 pressões Start/A/B; 20 reconexões físicas; 20 ciclos SRAM real; 60 s de aquecimento, três execuções por configuração, 30 min sustentados e 60 min antes de uso prolongado. Marcar ruídos de áudio, formato USB/Bluetooth, tela efetiva e acesso ao arquivo exportado. Só habilitar sincronização após comprovar restauração no jogo. Não usar os testes sintéticos como aceite desses gates.
