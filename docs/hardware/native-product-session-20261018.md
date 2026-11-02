# Interface nativa e PS1 LAN — sessão de 18/10/2026

App **Super Flip CB**, `com.superflipcb.native`, versão 0.1.0, na LG
55QNED70BSA / webOS SDK 11.2.0. Esta entrega é experimental; boot e testes
automáticos não constituem aceite de todos os jogos ou controles.

## Pacote

Instalado: `artifacts/native/native-product-20/ipk/com.superflipcb.native_0.1.0_arm.ipk`.
9.708.326 bytes, SHA-256:
`4cd74fe114c00542bc9d6aeb803fb94597c95b85005d491e8e5dd5d2bc5dcd91`.
Os diretórios `native-product-01` a `19` registram etapas anteriores.

Servidor nativo confirmado por HTTP autenticado:
`http://192.168.15.4:8798`, catálogo com 276 entradas nesta sessão. Token privado
não faz parte deste relatório. Não houve push, merge ou CI remota.

Ao encerrar, a abertura normal sem parâmetros foi confirmada no protocolo v2:
somente a UI nativa permaneceu ativa, sem core órfão. Último backup completo
verificado por SHA-256:
`d8559c6da2303e021962d2c536debffda7432639217978b7d34eb9f21f33e962`.

## Execução física observada

| Cenário | Build | Resultado |
| --- | --- | --- |
| Super Mario World, 600 frames solicitados | 18 | Runtime registrou 9 s de conteúdo; 12,107 s entre handoff/retorno; saída 0 e biblioteca restaurada |
| Super Mario World, 300 frames solicitados | 20 | Runtime registrou 4 s; 7,191 s entre handoff/retorno; saída 0 e biblioteca restaurada |
| Castlevania BIN/CUE, 3.600 frames solicitados | 17 | Tela de título capturada; runtime registrou 59 s; 65,263 s no handoff; saída 0 |
| Castlevania CHD, 3.600 frames solicitados, sem Home | 17 | Tela de título; runtime registrou 59 s; 64,534 s no handoff; saída 0 |
| Castlevania CHD, 2.100 frames solicitados, sem Home | 18 | Runtime registrou 34 s; 39,506 s no handoff; saída 0, biblioteca e backup restaurados |
| Castlevania CHD, 900 frames solicitados, sem Home | 20 | Runtime registrou 14 s; 18,510 s no handoff; saída 0, sem falha de I/O |
| CHD com Home e relançamento CLI | 18 | Background/pausa confirmados; relançamento não produziu foreground; retomada não aprovada |
| CHD com Home, protocolo nativo v2 | 20 | Mesma limitação: 4 s de conteúdo antes do background, sem foreground após relançamento CLI |

Os tempos incluem inicialização, I/O, pausa e encerramento; não são medições de
FPS de gameplay. O limite de frames do teste pode contar frames de vídeo durante
a pausa, portanto não deve ser usado como contagem de frames efetivamente emulados.

O build 20 conserva os mesmos binários de Snes9x e PCSX do build 17. A alteração
do runtime observa eventos SDL por `SDL_AddEventWatch`, com estado atômico,
sem modificar os algoritmos de emulação, renderização ou áudio.

CUE: 7.864.320 bytes transferidos (7,5 MiB), cache máximo 7,5 MiB,
60 requisições, sem falha de I/O. CHD sem Home: 4.718.725 bytes transferidos,
cache máximo 4.849.664 bytes, 37 requisições, sem falha. O limite do cache é
16.777.216 bytes em ambos; não é o limite de memória total do app.

Os logs reconhecem BIOS US real, ari64 ARMv7, NEON e as trilhas DATA/AUDIO do
CUE. Reconhecimento de uma trilha de áudio não comprova reprodução CD-DA audível.

Evidências com hashes verificados estão em
`artifacts/native/product-session-20261018`: `final-cue-*`,
`final-chd-uninterrupted-*`, `final18-snes-*`, `final18-chd-*`, `home-watch-chd-*`
`final20-snes-*`, `final20-chd-*` e `lifecycle-v2-chd-*`. O pacote final usa a interface de lifecycle nativo v2 e
normaliza seu envelope `parameters`, com validação e teste de não aceitar
overrides de servidor/caminhos pelo payload de lançamento.
Capturas pretas e sessões pausadas dos builds antigos não são usadas como
prova de gameplay. A captura `returned-ui` é da UI renderizada na própria LG.

## Analógico e persistência

Stick esquerdo integrado à navegação, com ativação em 18.000, liberação em
11.000, repetição inicial de 350 ms e intervalo de 120 ms. O runtime usa os eixos
canônicos SDL dos dois sticks, zona morta de 20% e conversão não forçada do
stick esquerdo para D-pad nos controles digitais. DualShock permanece disponível
no menu do core para títulos PS1 compatíveis.

O usuário informou **Gamepad X9 por Bluetooth** e confirmou em 18/10/2026 que
o stick esquerdo já funciona na nova versão. Esse aceite confirma o uso físico
do analógico informado; não especifica separadamente interface/gameplay nem
valida todos os botões, o stick direito ou o modo DualShock em jogos PS1.

SRAM, cartões e estados permanecem em namespaces nativos. Backup completo do
userdata, sincronização por checksum/CAS e restauração de arquivos ausentes foram
verificados com a API real e runtime fixture. Isso não substitui salvar um jogo
no memory card, reabri-lo e conferir o progresso na TV.

Após atualização, permissões de userdata `0775` impediram a abertura. A correção
restringe pastas/arquivos próprios a `0700`/`0600`, usando descritores e validação
de UID, sem adotar arquivos de outro usuário. Foi validada na LG e por regressão
que preserva os bytes de um save existente.

O envelope EmulatorJS original continua com SHA-256
`901d67df7eb74a19f510b41b1f67593e79c02f8ae26aafa408a251ab2c61be68`.
O core Snes9x continua com SHA-256
`ad302ce11d30d58cff566ecf418e410031abc602435e26b78738be9220c805c3`.
Os backups originais da PoC permanecem no PC. Na consulta final, os arquivos do
ID `.native.poc` não estavam presentes na TV; a causa não foi estabelecida e
este trabalho não removeu esse ID.

## Limites para o aceite

- Confirmar os demais controles do X9, áudio perceptivo e gameplay sustentado.
- Corrigir/homologar retorno após Home; usar o menu RetroArch para retornar à
  biblioteca nesta versão. Reabrir após fechamento recupera a sincronização
  pendente; não equivale a restaurar automaticamente o estado exato do jogo.
- Conferir gravação e leitura reais no memory card, reboot, jogos 3D,
  analógicos DualShock, CD-DA/XA, troca de disco e sessões de 30/60 minutos.

Contratos locais: 21 testes do lançador, seis de pacote, três de VFS HTTP,
28 testes de backend aprovados (um skip de symlink existente no Windows),
teste de navegação analógica e integração de handoff/backup/restauração com
runtime fixture. Fontes e hashes do pacote final foram conferidos.

Análise da referência e operação:
[Interface nativa, PS1 LAN e progresso](../development/native-product.md).
