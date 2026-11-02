# Baseline físico reproduzível do RetroArch

Data: 18/10/2026. **Resultado atual:** desempenho superior relatado pelo usuário.
Não há ainda medições numéricas equivalentes para aprovar esta PoC.

## Identificar a referência antes de comparar

Na TV real, com sessão autorizada, registrar versão/build/SHA do RetroArch
instalado, core/nome/versão/SHA, ABI, config e opções, SDL/video/context/audio/input
drivers, saída gráfica e região da ROM. Conservar uma cópia exportada da
configuração sem editá-la. A versão 1.22.2 escolhida para build não deve ser
apresentada como a versão já testada pelo usuário sem essa identificação.

Não substituir o RetroArch baseline nem seus saves. Usar um jogo próprio/homebrew
ou mídia autorizada e um slot de laboratório; backup antes de qualquer cópia.
O diagnóstico gerado por `scripts/native/make-test-rom.py` é original, sem ROM
comercial/BIOS, com backdrop que muda por vblank e SRAM de 2 KiB. Ele valida
execução básica, não representa a carga de um jogo SNES exigente ou áudio audível.

## Protocolo A/B

1. Fixar TV/firmware, modo de imagem/jogo, energia, controle/conexão, rede,
   core/ROM SHA e região. Usar configuração equivalente: resolução interna,
   saída 1080p, aspect ratio, VSync, filtro, audio buffer e opções do core.
   Sem rewind, run-ahead, shader pesado ou frameskip novos.
2. Definir cena/input reproduzível e duração; separar boot/demo de gameplay
   humano. Não comparar títulos/cenas que avançaram quantidades diferentes.
3. Aquecer 60 s, executar três ensaios curtos equivalentes, alternando A/B.
   Depois validar 30 e 60 min de carga sustentada e mesmas condições térmicas.
4. Executar menu/retorno, Home/volta, suspensão/retomada, desconexão/reconexão
   de gamepad, queda LAN, salvar/reboot/recuperar. Registrar intervenção humana.
5. Preservar config, logs, dados brutos e resultado por sessão; não usar média
   entre ensaios com configurações distintas para esconder regressão.

## Fronteiras de medição

| Métrica | Fonte adequada | Limite/estado atual |
|---|---|---|
| Velocidade nominal | frames/tempo emulado no core ÷ taxa nominal da região | Pendente físico; não confundir com FPS do jogo PS1 |
| Frames emulados | contador confiável de `retro_run`/runtime | Harness desktop conta chamadas; não é apresentação na TV |
| Frames apresentados | feedback de apresentação/compositor, quando disponível | Pendente; swap ou FPS de menu não bastam |
| Frame time médio/P95/P99 | timestamps monotônicos por fronteira bem identificada | Se runtime não exportar série, registrar unavailable; não calcular a partir de média |
| Input→fóton | câmera de alta velocidade/LED ou instrumento externo | Pendente; tempo de polling não é a latência final |
| Áudio | escuta, underruns/buffer quando exportados, captura externa se necessária | Callback produzido não prova som estável ou ausência de estalos |
| Boot | monotônico até primeiro frame/áudio útil; preparo LAN separado | Lançador informa `preparationMs`; primeiro frame na TV ainda pendente |
| CPU/memória | `/proc/<pid>/stat,status,smaps_rollup` se permitido; amostras com tempo | CPU/RSS do processo separados de MemAvailable do SO e alocação do core |
| Sustentação | mesmas séries aos 30 e 60 min e eventos de lifecycle | Pendente físico |

Taxa NTSC/PAL é obtida do core e confrontada com a região do conteúdo. Não
usar 60.000 fixo para todo SNES. Para PS1, um jogo de 30 FPS pode ter emulação
em velocidade plena; contabilizar essas duas grandezas separadamente.

## Registro mínimo por ensaio

Guardar um JSON/CSV com: data UTC/fuso local, modelo/firmware, app/core SHA,
ROM SHA (sem distribuir a ROM), região/taxa nominal, cena, duração, controle,
drivers/config/opções, estado térmico conhecido, métricas com unidade/fronteira,
intervalos brutos, falhas e motivo de cada métrica indisponível.

Não há números preenchidos para o novo IPK. Meta inicial: pelo menos 95% da
velocidade nominal sustentada nos títulos em que o baseline já cumpre essa meta,
preferindo igualdade com o baseline. Queda superior a 5% frente ao baseline,
áudio degradado ou piora material de input bloqueiam promoção até explicação
e correção. Mesmo acima de 95%, uma diferença para o baseline exige análise.

**Confirmado:** referência experimental do usuário e protocolo.
**Implementado:** identidade/hash/preparação e diagnóstico básico.
**Testado:** contratos/core em desktop, sem alegação de desempenho.
**Pendente físico:** séries A/B e todos os percentis/latências/estabilidade.
