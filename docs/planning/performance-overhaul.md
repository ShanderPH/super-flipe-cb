# Plano de desempenho verificável

Base: investigação de 17/10/2026, LG 55QNED70BSA/webOS26. [Causa e evidências](../research/performance-root-cause.md), [resultados](../research/benchmark-results.md). **PS2 não faz parte deste plano.** Controles existentes foram confirmados pelo usuário; sua regressão é impedimento para promoção.

**Restrição expressa do usuário nesta continuação:** nenhum acesso/teste na TV sem autorização específica para a sessão. Instalação/pareamento Sunshine/Moonlight ficam pendentes; autorizado apenas preparar este PC. [Execução local, correções, dados e estado de todos os gates](../research/performance-overhaul-execution.md). Há novos builds O3/LTO/heap32 e prova de equivalência desktop; não há novo desempenho físico nem promoção de core.

## Decisão e estado atual

O core atual permanece abaixo da velocidade nominal na TV. Não promover esta branch como solução completa de desempenho. Preservar a arquitetura de saves e o runtime vigente como rollback. Comparar execução local mais econômica em namespace experimental; para cargas que não cumprirem o aceite, priorizar Sunshine/Moonlight TV em modo remoto explícito. O FastAPI atual continua servidor de dados.

## Entregas desta rodada

| Item | Prova | Limite |
|---|---|---|
| Auditoria, versões/hashes, engenharia reversa de glue/WASM | Relatórios e inventários anexados | SHA/toolchain exatos dos binários históricos não publicados no pacote |
| Profiler opt-in, métricas delimitadas e `unavailable` | Testes de hooks/distribuição/desligamento + JSON físico | Sem tempo isolado de core/GPU/underrun/input→fóton |
| Um snapshot de input por rAF; UI cede gameplay | Regressões de input/pausa/reconexão e E2E | Novos modelos/multiplayer exigem prova física |
| Proteção de tela com lifecycle e diagnóstico | Unitários; registro Luna observado na LG | Ensaio longo interrompido manualmente pelo usuário; eficácia ainda não comprovada |
| Matriz A/V/profiler e engine independente | 30 ensaios desktop, matriz física e confirmação aquecida | Desktop não prova TV; falta comparação independente em contexto seguro |
| PoC PS1 isolada | BIOS/disco reconhecidos; Castlevania chegou à tela de título no desktop, 59,897 core/s; card volátil de 128 KiB idêntico após importação | Sem gameplay prolongado, áudio perceptivo, save reconhecido no jogo ou execução física LG; BIN de 583 MB exige orçamento de memória |

## Trabalho seguinte, em ordem

| ID / prioridade / custo | Tarefa e dependências | Aceite verificável | Risco e rollback |
|---|---|---|---|
| P0-A / médio | Obter/reproduzir build exato ou novo baseline identificável; registrar core SHA, Emscripten, flags, licenças e símbolos. Depende dos pacotes/fontes upstream | Build repetível; timers separados `retro_run`, conversão/vídeo e áudio; mesmas configurações/cena; artefato e log completos | Mudança de código pode alterar saves. Experimento fora do runtime atual, sem copiar estados/SRAM reais |
| P0-B / médio | Traçar pacing/Asyncify/OpenAL e deadlines com profiler off/on; três repetições alternadas, ≥60 s warmup/30 s janela. Depende P0-A para atribuição interna | Explicar frames perdidos e custo por componente; ganho repetível fora da variabilidade, sem alterar relógio emulado/áudio | Desligar vsync pode acelerar ou desregular jogo; nunca promover hacks de velocidade sem equivalência A/V |
| P0-C / baixo | Validar protetor em gameplay inativo por tempo superior ao timeout real, depois menu/pausa/exit/Home/standby | Jogo visível sem protetor; pedidos/vetos e aceitação exportados; pausa/saída permitem política normal; nenhuma alteração global de energia | API Luna pode ser negada ou mudar. Remover fallback/configuração do patch se falhar e avaliar integração nativa documentada |
| P0-D / baixo | Repetir Start/A/B/Back, combo, hold-through e reconexão USB/Bluetooth com um único polling | 100 pressões corretas, 20 reconexões sem entrada presa; mesmas posições físicas já aprovadas | Reverter somente consolidação de polling se houver regressão; preservar correções anteriores/mapeamento |
| P1-A / médio | Comparar shim direto em **HTTPS confiável ou contexto empacotado apropriado** e core 2005; depois 2010 se útil. Depende P0-A/B e revisão de licença | Três repetições da mesma cena, A/V on, velocidade nominal; cinco títulos incluindo chips/cenas exigentes; áudio/controles corretos | Não há garantia de compatibilidade. Sem troca automática; manter runtime antigo e namespaces separados |
| P1-B / médio | Matriz compilada `-O3`, LTO, heap ajustado e componentes removidos, um fator por vez. `-Oz` só se boot/tamanho for objetivo | SHA/toolchain/flags, bytes/boot/frame separados, sem OOM/regressão. SIMD somente com detecção e hotspot beneficiado | LTO/heap podem quebrar core. Artefatos versionados por build, fallback intacto |
| P1-C / baixo | GL1/GL2 e 1080p/720p no mesmo core, três repetições; medir submissão/GPU quando possível | Ganho repetível com imagem/áudio corretos, sem confundir composição e resolução do SNES | GL2 pode piorar. Continuar GL1/1080p se evidência não justificar alteração |
| P1-D / médio | Aceite sustentado do candidato vencedor local e SRAM | 30 min, três execuções; 60 min estabilidade; taxa nominal por região, sem quedas/ruído perceptível; 20 save→reabrir→continuar, offline/conflito/standby | Sem aceite, não trocar core nem identidade de save. Backup/export antes de qualquer migração |
| P2-A / médio | PoC madura Sunshine/Moonlight TV com host escolhido, encoder compatível e pairing. Depende de disponibilidade do host e instalação explícita | Mesmo SNES e PS1 legítimos, codec/resolução/bitrate/rede fixos; três sessões de 30 min; input→fóton externo, áudio e reconexão; saves no host reconhecidos | Latência/rede/decoder podem impedir uso. Encerrar remoto, voltar local; sem sobrescrever SRAM local |
| P2-B / médio | Prosseguir da PoC desktop com Castlevania/BIOS já fornecidos: estabelecer pico de memória/formato viável antes da LG; depois cinco títulos, cards/áudio/controles | Boot BIOS real confirmado, velocidade e 60 min estáveis no modo escolhido; export/import e continuação reais; nenhum save SNES tocado | BIN de 583 MB e cópias podem causar OOM na TV; WASM não recebe dynarec ARM nativo. Se insuficiente, usar remoto; não habilitar PS1 local no catálogo |
| P3-A / médio | Perfis versionados por dispositivo, D-pad por eixos/deadzones, slots multiplayer. Depende do aceite do core e testes dos controles | Xbox/DualShock/DualSense/8BitDo por modo real; diagonais/releases, migração do perfil único preservada; até quatro somente se jogo/core suportarem | Nome comercial não prova layout; manter `mapping=standard`/calibração e fallback remoto/teclado |

Threads não são tarefa imediata: o HTTP LAN atual não oferece contexto seguro/isolation/SAB. Não introduzir pthreads sem requisito, core paralelizável e comparação. WebRTC só entra se Moonlight nativo falhar por requisito concreto; não criar protocolo próprio.

## Estratégia de promoção e rollback

1. Parar servidor antes de atualizar UI/runtime; preservar diretório antigo, manifestos, hashes e backup/export dos saves.
2. O patch 2 altera somente integração JS. Os arquivos `snes9x-*.data`, `coreBuild`, formato e política ETag não mudam. [Prova do patch](../research/data/runtime-patch-proof-2026-10-17.json) inclui fonte pristine, idempotência e recusa a tamper.
3. Candidatos de core/build usam outro diretório e identidade de save. Importação é cópia explícita, com teste de reconhecimento pelo jogo; save states nunca migram por pressuposição.
4. Falha em FPS/áudio/input/SRAM/protetor interrompe promoção. Restaurar árvore anterior e rebuild correspondente, sem reverter dados pessoais ou apagar saves.
5. Merge, release, instalação permanente ou publicação dependem da revisão/autorização correspondente. Testes locais e sessões curtas via inspector não são aprovação de release.
