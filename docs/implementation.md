# Análise e execução do plano — 17/10/2026

> Registro da implementação inicial. As limitações de input, bundle, cache e ausência de autosync abaixo foram posteriormente tratadas em [audit-improvements.md](audit-improvements.md). Os gates de hardware permanecem pendentes.

Fonte: `planning.md`, fornecido pelo usuário. O original foi preservado em `docs/planning.md`. `researching.md` é citado pelo plano, mas não foi fornecido: seus resultados não foram tratados como evidência atual.

## Alteração de ordem autorizada

A instrução direta do usuário é iniciar a implementação integral e deixar proof of concept para depois. Ela prevalece sobre as seções 0, 10, 11 e 15 do documento que bloqueavam frontend/MVP antes dos spikes. Implementamos o caminho SNES e ferramentas de teste primeiro, **sem converter os gates pendentes em aprovação**. Não executamos benchmarks na TV nem instalamos apps/dispositivos nesta etapa.

## Invariantes mantidas

- Emulação WASM no cliente; servidor apenas entrega arquivos e persiste progresso.
- Origem LAN única; zero dependência obrigatória de nuvem e CSP do player restringindo rede externa.
- Conteúdo privado fora do Git/IPK. Nenhum conteúdo comercial, ROM ou BIOS baixado/distribuído.
- Paths resolvidos por ID, links/junctions rejeitados, Host explícito, escritas com Origin/Fetch Metadata/header próprio.
- Identidade por hash integral; ROM alterada depois da indexação é recusada até reiniciar.
- Save confirmado pelo servidor; overwrite exige versão atual, com backup e integridade.
- Retorno do player preserva foco e saída tem confirmação para evitar perda involuntária.

## Ajustes técnicos ao plano

1. **Runtime verificado no tag:** 4.2.3 expõe `EJS_disableDatabases`, não `EJS_cacheConfig`. A primeira usa dummy storage para ROM/BIOS/core (`loader.js` e `emulator.js`). Estados e SRAM podem continuar usando IndexedDB/IDBFS: a auditoria na TV permanece obrigatória. Não há Service Worker.
2. **Integração pequena:** `pause/play`, `getSaveFile`, `getSaveFilePath`, FS e `loadSaveFiles` foram lidos no tag fixado. Eles ficam encapsulados no iframe; não usamos `EJS_onSaveUpdate` de versões posteriores. APIs internas podem mudar: atualização exige rever adaptador e testes.
3. **Persistência:** envelope único atômico (binário base64 + metadados) evita transação inconsistente de arquivo `.srm` e sidecar. Custo: overhead de base64/JSON, aceitável com limite 2 MiB. Respostas HTTP continuam binárias. Mutex de arquivo funciona entre processos.
4. **Sem SQLite:** catálogo imutável durante o processo e saves em arquivos já têm donos claros. Reinício reindexa ROMs. Favoritos/recentes não foram adicionados antes do aceite SNES.
5. **Versões reais:** Node instalado 24.15.0; Python instalado 3.13.13. Pins documentais não foram confundidos com runtime existente. TypeScript 5.9.3 atende o gerador de contratos; não forçamos dependência peer incompatível com TS 6.
6. **Licenças e fonte:** runtime é instalado de commit fixo, cores com SHA-256. Licenças/fontes locais acompanham o repo. Licenciamento completo de redistribuição continua sendo revisão necessária se o produto sair do uso privado.
7. **CLI separado:** vulnerabilidades do CLI oficial não contaminam runtime/UI. Não houve fix forçado incompatível nem alteração de firewall, DHCP ou instalação na TV.

## Entregas por épico

| Épico | Implementação | Aceite pendente |
|---|---|---|
| E0 | Toolchains/locks, launcher, API, diagnóstico, engine SNES isolada | S0–S6 na TV; ROM legítima e gamepad físico |
| E1 | Repo, schemas/OpenAPI → TS, índice seguro, bridge, navegação espacial | CLI/firmware reais e comportamento de foco no webOS |
| E2 | Identidade geométrica original, fontes locais, tokens, Home/biblioteca/detalhes/player, erros | Legibilidade 2–3 m, overscan, remote/gamepad e contraste real na tela |
| E3 | Save explícito, conflito, backup, corrupção, export/import, pausa lifecycle, relatório técnico | SRAM real no core, suspend/retomada, backup/restore no ambiente doméstico |
| E4 | Build same-origin, scripts package/install/backup, CI, guias | DHCP/firewall pelo operador, instalação/renovação Developer Mode e release |
| E5 | Mantido pós-MVP | Atari/Mega/PS1, favoritos/recentes e NAS são expansões, não suporte implementado |

## Limites materiais

O hosted launcher exige validação do redirecionamento e do teclado virtual. Não há autosync ou proteção durável contra encerramento sem save explícito. Requisitos de segurança de contexto podem limitar Gamepad/Storage no HTTP webOS. Não há autenticação entre membros da rede doméstica. O adaptador depende de APIs verificadas no código da engine, ainda sem prova de jogabilidade na TV. O app permanece versão técnica 0.0.1, sem declaração de MVP aprovado.
