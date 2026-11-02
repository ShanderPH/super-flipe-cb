# ADR: baseline nativo antes da decisão de fork

Status: aceito para PoC; decisão de runtime final condicionada aos gates.
Data: 18/10/2026.

## Contexto

O usuário comparou RetroArch nativo com o Super Flip CB na mesma LG e observou
grande superioridade do primeiro. O projeto atual já contém RetroArch em WASM;
substituir apenas o nome do loader não elimina o navegador. O Makefile webOS
upstream reúne os drivers, build ARM e empacotamento nativos necessários.

## Decisão

Reutilizar RetroArch webOS **1.22.2**, source release verificado por SHA-256,
como runtime de referência executável. Um processo C++ pequeno prepara conteúdo
SNES da API LAN e chama `execv` no runtime. Não copiar drivers, não reimplementar
o contrato libretro e não alterar algoritmos de emulação nesta fase.

ARMv7 softfp é o primeiro alvo. Kernel AArch64 não prova userspace, carregador,
bibliotecas e ACG adequados a AArch64. Não instalar bridge 64/32 ou mudar firmware
para satisfazer o experimento. A PoC usa outro app ID e outro espaço de saves.

## Consequências e comparação

Preserva-se a arquitetura de emulação já comprovada pelo usuário, reduzindo o
risco de scheduler, áudio e input novos. Acrescentam-se libcurl/json-c/OpenSSL
somente ao processo de preparação. As bibliotecas runtime são auditadas e
empacotadas, sem embarcar os stubs gráficos do SDK.

O custo é carregar um frontend maior e lidar com GPL/upstream e limites dos
menus existentes. Um frontend próprio pode facilitar a identidade visual, mas
passa a possuir todo o contrato libretro, drivers, pacing, opções, VFS e
persistência. Não se escolhe B com base em uma janela vazia ou um único jogo.

## Condições para a decisão definitiva

1. Identificar e registrar a versão/core/configuração do RetroArch que já roda
   bem na TV. Comparar este candidato com a mesma carga e hardware.
2. Medir uma fatia de catálogo + detalhes + início/retorno com a identidade
   existente. Registrar alterações upstream necessárias, testes e conflitos.
3. Demonstrar backup, compatibilidade SRAM e protocolo nativo de saves sem
   alterar os dados legados. Estados de builds diferentes não são migrados.
4. Preferir manter os drivers upstream se a integração for pequena e isolável.
   Escolher B somente se a integração obstruir ownership/manutenção e a nova
   implementação cumprir os mesmos gates de A/V/input/performance.

## Evidência

**Confirmado:** fontes/flags e comparação física relatada pelo usuário.
**Implementado:** runtime reutilizado, lançador, scripts e pacote isolados.
**Testado:** build ARMv7, contratos locais, core real no desktop e execução do
IPK na LG com Super Mario World. O usuário aprovou os testes e relatou desempenho
excelente; a observação é qualitativa, sem FPS/latência ou duração informados.
**Ainda não aprovado:** fork de produto; PS1/PS2; sync e migração de saves;
benchmark A/B sustentado e recuperação após reboot. Ver a
[sessão física](../hardware/native-tv-session-20261018.md) e os
[próximos incrementos](../planning/native-next-steps.md).
