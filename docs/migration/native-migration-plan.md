# Migração incremental sem perda de dados

Data: 18/10/2026. O legado permanece disponível; a migração não foi promovida.

## Situação atual

**Confirmado:** API de catálogo/ROM e SaveStore atuais são reutilizáveis, mas o
protocolo de saves aceita somente a identidade EmulatorJS existente.
**Implementado:** branch `codex/native-webos-poc`, aplicação nativa com outro ID,
preparação LAN SNES, runtime upstream, diagnóstico e build/package/testes.
**Testado localmente:** ver [build](../development/native-build.md).
**Pendente:** todos os gates físicos e a integração de produto descrita abaixo.

## Gates de execução

| Fase | Trabalho e evidência necessária | Estado/rollback |
|---|---|---|
| 0 — auditoria | Fontes/versões/licenças, matriz A–D, ADRs, protocolo de baseline e inventário de saves | Documentado; nenhuma migração de dados |
| 1 — PoC | ELF/core ARMv7, janela/áudio/input por RetroArch, ROM diagnóstica autorizada, cache LAN limitado, teardown e IPK | Compilação/testes locais; dispositivo ainda pendente. Remover somente o app experimental se autorizado |
| 2 — UI/Flutter | Medir uma fatia de design/catalogo/saves; Flutter somente se textura eficiente for viável | Pendente; sem portar toda a UI antecipadamente |
| 3 — produto nativo | Catálogo/capas/detalhes/histórico, perfis e jogadores, lifecycle, erros e save sync durável | Pendente; runtime baseline permanece comparável |
| 4 — sistemas | PCSX ReARMed/PS1 e depois Mega Drive/Atari, cada core com mídia legal, formatos e testes próprios | Pendente; não habilitar por simples compilação |
| 5 — estabilidade | 30/60 min, input externo, áudio, foco/standby/reboot, falha LAN e recuperação | Pendente; só então aprovar substituição do player web |
| 6 — remoto | Sunshine/Moonlight opcionais, pairing/saves próprios, PS2 se justificado | Pesquisa; instalação/pareamento não executados |

Não renomear/mover `tv-client` para "legacy" antes dos gates: isso só criaria
churn e risco na entrega ainda funcional. Não manter o EmulatorJS como fallback
definitivo após o aceite completo; planejar sua retirada com rollback de dados
documentado e autorizado, sem apagar backups.

## Saves: regras obrigatórias antes de migrar

O inventário encontrou um envelope SRAM de 2 KiB. O core WASM antigo e o core
nativo têm identidade diferente. Não comparar apenas extensões ou tamanho.

1. Parar sessões/gravações, usar os scripts atuais de backup e validar o ZIP e
   restauração numa pasta temporária. Conservar o envelope original e checksum.
2. Classificar SRAM/battery, memory card e state. Zero bytes de save memory do
   core significa ausência de SRAM, não falha de upload. Falha de extração/I/O
   tem status e ação diferentes.
3. Para SRAM, comparar mapeamento/layout e comportamento no mesmo jogo/revisão
   de ROM. Testar uma cópia importada, continuar dentro do jogo, salvar, encerrar,
   reboot e reabrir. Manter cópia anterior e checksum. Sem equivalência, não converter.
4. Save states recebem core/versão/SHA do binário e região/opções relevantes.
   Não converter ou compartilhar states entre WASM/nativo, versões ou ABIs por
   pressuposição. P0 já separa o namespace pelo hash do core nativo.
5. Evoluir o backend no responsável `SaveStore`: namespace nativo distinto,
   identidade explícita, envelope único atômico, lock, backup, checksum e ETag.
   Não relaxar a validação atual nem enviar `X-Core-Version: emulatorjs-4.2.3`
   para bytes nativos. Versionar o contrato antes de conectar o cliente.
6. A fila de sync deve persistir localmente antes de enviar; uma operação por
   slot, If-Match, conflito sem overwrite silencioso, recuperação após queda de
   rede e restart. Só confirmar "salvo no servidor" após resposta validada.

Esta rodada não altera a API, envelopes, backups ou dados atuais. O autosave do
RetroArch escreve somente no namespace experimental; ele não comprova atomicidade
e durabilidade equivalentes ao SaveStore, nem backup LAN automático.

## Segurança, atualização e reversão

Uso por Developer Mode e LAN privada; sem root, jailbreak, serviço interno,
firewall/roteador ou instalação automática. O app de referência permanece no
seu ID e não recebe configurações do experimento. Atualização do pacote nativo
deve ser precedida de export dos dados experimentais; reinstalação e expiração
da sessão Developer Mode não oferecem garantia de persistência.

Artefatos carregam hashes de entrada e saída, versão de compiler, perfil e
dependências de plataforma. Antes de novo core/SDK: novo build, testes locais,
backup e gate físico. AArch64 só entra com loader/ABI/permissões e ganho medidos,
sem tornar uma bridge ou modificação de firmware requisito do modo local.
