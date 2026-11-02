# Próximos incrementos nativos

Plano original de 18/10/2026. O estado implementado e os limites de validação
estão em [Interface nativa, PS1 LAN e progresso](../development/native-product.md).
As descrições abaixo registram o ponto de partida anterior à implementação.

Direção do usuário: interface ao abrir o aplicativo e,
com maior prioridade, PlayStation 1 nativo. Super Mario na LG foi aprovado
pelo usuário, com desempenho descrito como excelente. Não há medição numérica
ou duração de teste informada. A implementação destes incrementos está pendente.

## Referência preservada

Manter RetroArch webOS 1.22.2, os drivers nativos já funcionais e o Snes9x atual.
O pacote de referência é o Release `tv-test-shm-20261018`, SHA-256
`c1c173b78af75e35e43e2e77c3344b889027ec8454581a6606f9d8e954dcd766`.
O novo progresso produzido pelo teste na TV exige backup antes da próxima
reinstalação. Não confundir esse progresso com o envelope legado no servidor.

## 1. PS1 jogável antes da interface completa

Integrar PCSX ReARMed como segundo core, com versão/commit e licenças fixados,
usando a mesma ABI ARMv7 e o host RetroArch. Verificar no build e na TV o dynarec
ARM e as otimizações compatíveis com a CPU; não basta o core compilar. Começar
com resolução interna original e sem novos efeitos ou overclock.

O backend e o lançador atuais aceitam somente SNES. Precisam de um contrato de
mídia PS1 que represente os arquivos de um disco, integridade e BIOS reconhecida,
sem aceitar caminhos arbitrários nem misturar os namespaces de saves. A BIOS
legítima deve ser validada e sua seleção diagnosticável; HLE não será usado
silenciosamente como substituto da validação de BIOS.

O cache SNES de 16 MiB por ROM não serve para discos PS1. Provar acesso aleatório
ao conteúdo, suporte real do build a CHD/BIN+CUE e orçamento de armazenamento
antes de escolher a estratégia. CHD reduz tamanho e organiza faixas, mas não
transforma automaticamente o core em cliente HTTP. Não carregar um CD completo
em RAM nem gravar imagens grandes no flash da TV sem consentimento. Caso seja
necessário um VFS/cache de leitura LAN, validar sua compatibilidade com os caminhos
de I/O efetivamente usados pelo core antes de integrá-lo ao produto.

Aceite inicial: um jogo autorizado em gameplay na LG, som e controles funcionais,
memory card salvo e reconhecido depois de reabrir, consumo de memória limitado
e desempenho sustentado. Depois ampliar a títulos 2D/3D, analógicos, estados e
troca de disco/M3U. Não declarar todos os formatos ou títulos aprovados pelo
sucesso de um único jogo.

## 2. Interface nativa ao abrir

Entregar o fluxo mínimo real: início → catálogo LAN → sistema SNES/PS1 →
seleção/detalhe → carregar → jogar → voltar ao catálogo. Remover a dependência
de um gameId fixado manualmente na configuração para o uso cotidiano.

Usar a identidade existente em `docs/design-system.md`: fundo escuro, roxo SNES,
amarelo exclusivo de foco, tipografia legível e navegação por gamepad/controle
remoto. Pesquisa e validação visual seguem Refero antes da implementação.
Incluir estados reais de servidor indisponível, catálogo vazio, BIOS ausente e
erro de mídia; não inventar capas, metadados ou ações sem implementação.

Provar primeiro uma pequena fatia de launcher/menu nativo integrado ao runtime.
A UI deve liberar seus recursos de renderização e input durante gameplay.
O retorno do jogo ao catálogo e o lifecycle webOS precisam funcionar na TV;
o `execv` atual substitui o launcher e, sozinho, não implementa esse retorno.
Comparar integração ao menu RetroArch com launcher C++ antes de escolher um fork
profundo. Nenhum novo host libretro ou migração Flutter é necessário neste gate.

## 3. Persistência e fechamento do incremento

Separar memory cards PS1, SRAM SNES e save states por jogo/core/build conforme
compatibilidade real. Validar backup/exportação antes de sync LAN. Preservar os
saves existentes e não enviar estados nativos como envelopes EmulatorJS.

Reexecutar Super Mario para detectar regressão após integrar PS1/UI; testar
menu/retorno, foco, controle, Home/standby, rede indisponível e save/reload.
Realizar sessões de 30/60 minutos sem atribuir FPS/latência a observações visuais.
A entrega só muda de experimental para funcional quando esses resultados forem
registrados; a tela inicial, isoladamente, não comprova PS1.

## Fontes

- [PCSX ReARMed: ARM, BIOS e memory cards](https://docs.libretro.com/library/pcsx_rearmed/), consultado via Context7 em 18/10/2026.
- [Imagens de disco: CUE/CHD/M3U](https://docs.libretro.com/guides/disc-images/), consultado via Context7 em 18/10/2026.
- [Arquitetura atual](../architecture/native-architecture.md), [decisão de runtime](../architecture/ADR-native-runtime.md) e [interface](../architecture/ADR-ui-framework.md).
