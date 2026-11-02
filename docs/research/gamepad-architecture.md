# Input: preservar o que o usuário confirmou

O usuário confirmou nesta rodada que os controles corrigidos funcionam normalmente. Base `a69e2f7`, EmulatorJS 4.2.3, patch de input/SRAM original 1. Não foi reaberto o mapeamento Xbox por suposição.

## Caminho auditado

Menu React → `src/input/navigation.ts` → foco/ações da UI. Gameplay → `public/player/bridge.js` → `GamepadHandler` → `EmulatorJS.gamepadEvent` → `GameManager.simulateInput` → função WASM `simulate_input`. Teclas e Gamepad API são caminhos diferentes; os eventos convertidos pelo webOS dependem do manifesto `cloudgame_active` realmente instalado.

O código original tinha polling EmulatorJS por `setTimeout(...,10)`, polling rAF do iframe e polling rAF da UI. `allowInput` também relia todos os controles em cada encaminhamento. Isso é trabalho redundante confirmado, não prova de que esses milissegundos expliquem toda a lentidão.

## Alteração implementada

- O iframe lê **um snapshot por rAF**. O timer do `GamepadHandler` é encerrado e seu mapper existente é atualizado com esse snapshot, preservando os labels e tratamento de índices físicos corrigidos.
- `allowInput` e os handlers consultam o snapshot, sem novas chamadas nativas por botão.
- A UI pula leitura de gamepad e busca de DOM durante gameplay. Continua dona de menu/calibração, e rearma somente depois de neutro na transição.
- Registro de estado do controle ocorre no máximo a cada 250 ms quando o profiler está ativo; sem serialização de todo gamepad por frame no modo normal.
- Diagnóstico mostra botões pressionados/valores e eixos a cada 500 ms fora do jogo.

O rAF passa a limitar a leitura ao ritmo de apresentação. O tradeoff é poder observar uma mudança até um display tick depois; reduzir polling não é prova de menor latência. A medição software evento→próxima iteração não é input→fóton e não mede tempo do rádio USB/Bluetooth.

## Invariantes preservadas

1. Índice físico esparso não é posição de array compacto; ausência/permissão negada não derruba o loop.
2. SNES usa posições físicas: inferior=B SNES, direito=A SNES. Menu mantém inferior=confirmar/direito=voltar.
3. Troca/reconexão, pausa, blur e ocultação bloqueiam input, liberam todos os botões e exigem neutro para rearmar.
4. Select+Start pertence ao iframe; UI não consome o combo durante gameplay. Start individual não recebe atraso artificial.
5. Hotkeys ocultas continuam bloqueadas na fronteira do core. O menu não aceita ações de um botão ainda mantido do jogo.
6. O botão Menu/Voltar deixa de ficar visível sobre o gameplay; pode aparecer com hover/foco para acesso por mouse/teclado. Voltar/Select+Start continuam disponíveis.

## Evolução verificável do Gamepad Manager

O proprietário atual é `controls.js` + bridge. Não foi criado um serviço paralelo para a mesma responsabilidade. Próxima extração, somente com necessidade demonstrada:

| Etapa | Comportamento / aceite |
|---|---|
| Perfis por dispositivo | Migrar o único perfil atual para mapa versionado por ID; importar o perfil antigo sem apagá-lo. UI de remover somente o dispositivo escolhido |
| Xbox/DualShock/DualSense/8BitDo | Preferir `mapping=standard`; testar cada modo de conexão/firmware. Nome do dispositivo sozinho não prova ordenação. Não adivinhar layout não padrão |
| Eixos/deadzones | Configurar uma deadzone por perfil; D-pad como botões ou eixos explícitos. Testar diagonais, drift, alternância e releases |
| Multiplayer | Slots estáveis por conexão até quatro **apenas se core/jogo oferecerem suporte**. SNES pode exigir Multitap; quatro entradas na estrutura EJS não comprovam quatro jogadores |
| Reconexão | Mesmo dispositivo mantém slot/perfil; substituição pede neutro; 20 ciclos USB/Bluetooth e índice 1/2 sem botões presos |
| Foco | Uma autoridade por contexto; menu modal com foco preso/restaurado; perda de foco pausa, sem retomar automaticamente |

`Gamepad API` não revela de forma portátil se o transporte é USB ou Bluetooth: registrar manualmente. Home/Power e gestos reservados podem ser consumidos pelo SO antes do app; não prometer bloqueá-los com `preventDefault`. Fontes: [appinfo LG](https://webostv.developer.lge.com/develop/references/appinfo-json), [guia de controles LG](https://webostv.developer.lge.com/develop/guides/remote-control).

Prova local: testes de input existentes, reconexões sintéticas, correlação de pausa, hold-through e hotkeys continuam obrigatórios. Isso não substitui a confirmação física já relatada pelo usuário nem amplia essa confirmação para multiplayer/novos dispositivos.
