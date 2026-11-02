# Interface nativa, PS1 LAN e progresso

18/10/2026. Branch `codex/native-webos-poc`. App experimental
`com.superflipcb.native` / **Super Flip CB**. A PoC SNES
`com.superflipcb.native.poc`, o RetroArch baseline e o app web permanecem separados.

## Implementação

1. **PS1:** PCSX ReARMed `c8816799b50388e61cfe237fe2cdbb7d8175f20a`, ARMv7
   softfp, dynarec ari64 e GPU NEON. Resolução interna original. RetroArch webOS
   1.22.2 mantém vídeo, áudio, input, opções, menu de pausa, estados e discos.
2. **LAN:** API autenticada e manifesto com arquivos aprovados, tamanho,
   SHA-256 integral e hashes por bloco. VFS do PCSX decorado por `libsfcb-disc`;
   operações locais continuam no VFS original. Um worker HTTP persistente lê
   blocos de 128 KiB, com LRU de 16 MiB, deduplicação, prioridade crítica e no
   máximo um prefetch adjacente. Esperas necessárias ocorrem no leitor do core;
   a transferência não depende de navegador ou de cópias integrais de CDs.
3. **Interface:** SDL/GLES/FreeType C++, catálogo real, SNES/PlayStation,
   navegação espacial, detalhes, carregar, erros e retorno à biblioteca.
   Identidade existente: Archivo/Pixelify, fundo `#101321`, roxo `#A889F7`, foco
   amarelo `#F9DB6D`. Não há animação contínua ou capas inventadas. A coleção
   atual não fornece capas; a primeira interface usa cards com títulos reais.
4. **Persistência:** SRAM, cartões e estados nativos têm protocolo próprio;
   checksum, If-Match/CAS, envelopes atômicos e backups no servidor. Downloads
   restauram arquivos ausentes e conflitos preservam a cópia local. Exportações
   completas versionadas por SHA ficam em `data/native/archives`; o servidor
   armazena bytes opacos e nunca extrai caminhos enviados pela TV.

## Decisão a partir da referência técnica

O documento `docs/super-flip-cb-ps1-leitura-discos-lan.md` foi analisado como
proposta técnica. Foram adotados o caminho nativo, HTTP Range, versão estável,
validação de `206`/Content-Range/ETag/tamanho/checksum, cache limitado, fila de
I/O e manutenção da semântica de disco. Respostas `200` não viram download do CD.

A inspeção comprovou `USE_LIBRETRO_VFS` em `libpcsxcore/cdriso.c`, inicialização
VFS em `frontend/libretro.c` e o uso de VFS pelo libchdr empacotado. Assim, o core
existente continua responsável por trilhas, pregaps, XA/CD-DA e descompressão CHD
por hunk. Não foi criado um segundo interpretador de LBA/TOC no servidor nem
uma API de setores duplicando o core. Isso reduz integração e mantém a mesma
engine no gameplay. O custo de descompressão CHD continua na TV e precisa ser
comparado nos jogos reais; suporte documental não equivale a aceite de gameplay.

CUEs são reescritos em descritores temporários com nomes aprovados; conteúdo e
índices permanecem no core. Referências DOS antigas são resolvidas apenas pelo
basename ao lado do CUE. Travessia, links/junctions e arquivos fora da biblioteca
são recusados. M3U aceita até oito CUE/CHD. Descritores antigos são removidos
antes de preparar outro disco: um `file00.cue` antigo não pode interferir em
`file00.chd`. Nenhuma imagem grande é gravada no flash da TV.

O prefetch inicial é conservador. A janela adaptativa maior, API de setores no
servidor, subcanais e todos os formatos citados na referência não são anunciados
como implementados. Falha crítica de leitura encerra o jogo de forma controlada,
preserva o progresso local e mostra erro; não há retomada transparente de uma
imagem modificada durante a execução.

## Lifecycle e ownership

UI e RetroArch transferem **o mesmo PID** por `execv`. A UI destrói janela,
renderer, texturas, fontes, controles e sessão SDL antes do gameplay; seu heap
também desaparece ao executar o RetroArch. O runtime se registra normalmente
no webOS, como na PoC já validada, sem outro lançador concorrendo por foco.

Um pequeno bridge no encerramento normal do RetroArch executa novamente a UI.
Sinais de fechamento e eventos de fechar janela encerram o app; não reabrem
a biblioteca contra a intenção do usuário. Falha crítica do VFS pede saída
controlada por SIGUSR1, com cleanup do core antes de retornar ao catálogo.
O bridge mantém os algoritmos de emulação e os drivers de vídeo/áudio/input.

Neste firmware a SDL recebe `DIDENTERFOREGROUND` sem `INPUT_FOCUS` de teclado.
Para o app nativo, o runtime usa os eventos de foreground/background e a janela
visível/não minimizada como condição de pausa. `pause_nonactive` continua ativo;
não se força foco de teclado nem se reabre o app continuamente. O comportamento
original permanece para chamadas do runtime sem o contexto deste launcher.
O app declara `nativeLifeCycleInterfaceVersion: 2`; os parâmetros iniciais desse
protocolo são lidos do objeto `parameters`. As duas formas de payload são
validadas e nenhuma permite mudar caminhos, servidor ou core pelo relançamento.
O estado é observado por `SDL_AddEventWatch`, com valor atômico e remoção do
observer antes de destruir o contexto. A pausa em Home foi observada na LG;
a retomada via relançamento CLI permaneceu sem evento de foreground e ainda
não está homologada. Não usar o teste de Home como prova de retomada concluída.

Um contexto privado `pending.json` registra a sessão antes do handoff. Ao
retornar, o app sincroniza os arquivos e exporta backup; após fechamento externo,
faz isso no próximo início. Falhas preservam o contexto para tentar novamente.
O mesmo descritor de lock é herdado/reutilizado durante todo o percurso.

A tentativa anterior com dois processos foi rejeitada: disputa de registro/foco,
capturas pretas, reinitialização da SDL webOS e core órfão mostraram custo maior
de integração. Mantém-se somente recuperação de órfãos das versões anteriores,
limitada ao executável e UID deste app, sem root ou sinais a outros aplicativos.

## Armazenamento e compatibilidade

- ROM SNES: um arquivo íntegro em tmpfs `/dev/shm`, limite de 16 MiB por ROM,
  até 32 MiB durante substituição. O caminho SNES anterior continua disponível.
- PS1: somente descritores/manifesto em tmpfs; dados de blocos ficam no processo
  do VFS. O teto de 16 MiB é do cache, não da memória total do app/core.
- Progresso: `<app>/userdata/s/<SHA-binário-core>/<SHA-conteúdo>`. Os hashes
  completos e a identidade legível são preservados; caminhos curtos evitam o
  buffer de 256 bytes do PCSX. As opções de ordenação extra do RetroArch são
  desabilitadas, pois o namespace já separa core/jogo.
- O formato antigo da própria PoC de produto é copiado para o caminho curto
  somente quando o destino não existe. Fontes antigas não são apagadas.
- Saves EmulatorJS não são enviados como nativos. A SRAM nativa de Super Mario
  foi exportada da PoC, verificada e admitida no namespace compatível, mantendo
  intacto o envelope legado do servidor. Estados de builds diferentes não são
  convertidos. CUE e CHD possuem IDs próprios e não compartilham cartões por
  inferência de título.

O instalador do webOS pode reaplicar `0775` aos dados preservados. Na abertura,
o app verifica ownership pelo descritor, rejeita links e arquivos de outro UID,
e restaura `0700` nas pastas e `0600` nos arquivos próprios. Essa recuperação
não altera o conteúdo dos saves nem usa chown, root ou permissões mais abertas.

## Executar e atualizar

Servidor nativo nesta sessão: `http://192.168.15.4:8798`. A instância antiga
na porta 8797 não foi encerrada. Para iniciar novamente no Windows:

```powershell
.\scripts\native\start-lan.ps1
```

A API nativa exige o token gerado em `data/native/pairing-token`. A configuração
inicial enviada por Developer Mode contém `{server, token}`; no primeiro início
ela é movida para `userdata/session.json` (0600, pasta 0700). Não publicar esse
arquivo ou token. A origem continua limitada a HTTP com IPv4 privado/loopback;
isso oferece pareamento na LAN, não TLS ou proteção contra captura de tráfego.

Build/package usam a mesma toolchain WSL `SuperFlipNative`:

```powershell
.\scripts\native\build.ps1 -Distro SuperFlipNative -WorkDirectory /opt/superflip -OutputDirectory .\artifacts\native\uma-saida-nova
.\scripts\native\package.ps1 -BuildDirectory .\artifacts\native\uma-saida-nova
```

Antes de atualizar, fechar o jogo pelo menu e exportar um backup. O parâmetro
Developer Mode `{"backupOnly":true}` no novo app exporta os dados privados sob
seu próprio UID, sem enfraquecer permissões de saves. Conferir o novo arquivo
SHA em `data/native/archives`. O utilitário `device-file.cjs` usa o transporte
SSH configurado, limita caminhos aos dois apps nativos e não imprime credenciais.

Na interface: stick esquerdo, D-pad/setas selecionam, A/OK abre e inicia, B/Voltar retorna;
LB/RB alterna sistema. No controle remoto, subir da primeira linha seleciona as
abas; esquerda/direita escolhe sistema e baixo volta à grade. Durante gameplay,
Select+Start abre RGUI; **Quit RetroArch** retorna à biblioteca e inicia backup.

O stick esquerdo navega com zona morta/histerese e repetição ao segurar; ruído
perto do centro não movimenta a seleção. No gameplay, os eixos SDL canônicos
dos dois sticks estão mapeados e o esquerdo controla também o direcional dos
pads digitais de SNES/PS1. A zona morta do gameplay é 20%. Para jogos PS1 com
suporte analógico real, selecionar **DualShock** em Quick Menu → Controls →
Port 1 Controls → Device Type. O modo não forçado do RetroArch preserva os eixos
analógicos quando solicitados pelo core; não se impõe DualShock a jogos antigos
que só aceitam o controle digital. Em 18/10/2026, o usuário confirmou que o
stick esquerdo do Gamepad X9 por Bluetooth funciona na nova versão. Os demais
botões/eixos e o modo DualShock ainda exigem testes específicos.

## Provas e limites

Pacote e resultados físicos atuais:
[sessão de interface/PS1 na LG](../hardware/native-product-session-20261018.md).

Contratos locais: 21 testes do lançador, seis de IPK/ABI, três do VFS real sobre
HTTP e oito da API nativa, além da suíte legada. O teste integrado de produto
percorre a UI compilada, handoff, retorno, backup, restauração de SRAM/estado e
encerramento normal/forçado sem core órfão e identidade do PID no handoff. Seu runtime de emulação é uma
fixture explícita; esse teste não comprova desempenho ou compatibilidade PS1.

O teste de navegação analógica cobre zona morta, histerese, repetição ao segurar,
inversão de direção, diagonais e reset de desconexão. Ele valida o comportamento
de navegação local, não a conexão física do X9 informado pelo usuário.

Na LG foram confirmados dynarec executável, NEON, BIOS real reconhecida,
leitura CUE por Range, cartão de 128 KiB salvo e tela de seleção de arquivos de
Castlevania. Um teste CUE de 3.600 frames solicitados leu 8 MiB do BIN de cerca
de 556 MiB, sem falha de I/O. Tempos de boot/pausa/encerramento não são FPS de
gameplay. Os resultados finais de CHD, SNES e lifecycle ficam no relatório
`artifacts/native/product-session-20261018`; não presumir aceite de títulos 3D,
CD-DA, troca real de CD, reboot ou sessões sustentadas de 30/60 minutos.

A conversão para `Castlevania (CHD).chd` foi feita uma vez no PC com chdman,
preservando BIN/CUE originais. Ela serve à validação e não ocorre ao iniciar
o jogo. Gameplay, áudio perceptivo e gravação reconhecida dentro do jogo ainda
exigem aceite humano na TV.

Referências: [PCSX](https://docs.libretro.com/library/pcsx_rearmed/),
[imagens de disco](https://docs.libretro.com/guides/disc-images/),
[SDL webOS](https://github.com/webosbrew/SDL-webOS/tree/release-2.30.12-webos.5),
[Xbox catálogo](https://refero.design/pages/b8835113-71e2-4829-a524-df041f94a323),
[Epic paginação](https://refero.design/pages/3e3ba1fd-e5eb-4299-94ae-9d2fbcf14f24).
