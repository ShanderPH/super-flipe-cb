# Implementação da auditoria — 17/10/2026

Relatório de origem: `analise-super-flip-cb.md`, diretório externo `analysis-output/super-flip-cb-2026-10-17`. A arquitetura continua React → iframe → EmulatorJS/RetroArch/Snes9x na TV e FastAPI/SaveStore no PC. Não foram baixados jogos/BIOS, alterados saves reais, trocados cores, publicados serviços ou instalados pacotes na TV.

## Entregas e limites

| Prioridade do relatório | Implementação | Prova restante |
|---|---|---|
| P0.1 | Launcher 0.0.2 com entrada direta; IPKs 1080p/720p com manifesto extraído e SHA-256; registro opcional de teclas/gamepad/foco/pausa | Instalar na LG e executar 100 pressões de Start/A/B, USB/Bluetooth |
| P0.2 | Busca pelo índice físico no runtime, ausência tolerada, Gamepad API bloqueada tratada, liberação de inputs e barreira neutra em troca/reconexão | 20 reconexões físicas, incluindo índices 1/2 |
| P0.3 | Perfil físico SNES explícito, calibração por ID, hotkeys removidas e bloqueadas na entrada do core; combo pertence ao iframe; confirmação correlacionada de pausa/resume | Verificar foco, combos, botões mantidos e consumo exclusivo na LG |
| P0.4 | Diagnóstico de sessão limitado: build/hash, artefato selecionado, GL efetivo quando acessível, boot, contador do core em janelas de 10 s, rAF, eventos e capacidades | Taxa nominal, tempo ativo, áudio, memória e 30 min reais ainda não medidos |
| P1.1 | WebGL1 continua referência; WebGL2 opt-in em Diagnóstico; pacotes de resolução separados | Três execuções por configuração e decisão baseada em ganho/estabilidade reais |
| P1.2 | SRAM validada pelo tamanho informado pelo jogo/core, pausa na restauração, cópia anterior exportável e rollback em falha; build do core no envelope; IDBFS antigo não sobrepõe servidor | 20 ciclos com jogo real, reboot/standby e reconhecimento de Continuar |
| P1.3 | Bundle compacto local, debug desligado, cache revalidado para runtime/fontes e imutável para assets com hash; removidos HEAD redundante, consulta e fallback CDN; catálogo não atualiza durante partida | Meta de 30% de melhora do boot aquecido não medida |
| P1.4 | Sincronização opt-in a cada 15 s, somente bytes alterados, snapshot copiado, uma requisição, ETag, limite de três falhas e bloqueio em conflito | Ativar após aceite SRAM real; desligamento ainda pode perder bytes não confirmados |
| P2.1 | Diagnóstico informa contexto seguro, isolamento e SharedArrayBuffer; fallback atual sem threads preservado | Só experimentar offload/threads ou nativo se o perfil identificar gargalo; exige build apropriado |
| P2.2 | Mantido gate PS1: estabilizar SNES, BIOS legítima, RAM/mídia, cinco títulos e multidisco/card | Não há core PS1 instalado ou suporte declarado |
| P3 | Mantida prova PS2 independente conforme relatório | ABI/renderer/CPU/memória nativos precisam de teste antes de integração |

## Escolhas técnicas

- O patch atua no commit auditado e recusa fontes inesperadas. Foram verificados hashes da fonte original baixada novamente e do resultado; reaplicação é idempotente. Não há atualização ampla de engine ou WASM. Os mesmos artefatos GL1/GL2 pertencem à identidade `snes9x-eaa0bcfce676-7d427a575cef`.
- Controle padrão usa posições físicas: botão inferior → B SNES, direito → A SNES. A UI mantém inferior=confirmar/direito=voltar. Um controle por vez. Perfis customizados cobrem 12 botões; D-pad reportado só como eixo, sem botões, ainda requer adaptação específica. Teclado/remote permanecem alternativa.
- O iframe é dono do combo e da entrada de gameplay. Soltar todos os botões/eixos é necessário para rearmar. Ao perceber Select+Start simultâneos, o core recebe releases e o menu abre uma vez. A primeira tecla de um combo pressionado sequencialmente pode já ter chegado ao jogo; não foi introduzido atraso no Start individual para ocultar isso.
- Pausa confirma o estado exposto pela API síncrona do runtime, não um contador independente do loop WASM. Essa integração e a semântica de `refresh_save_files` continuam exigindo prova no hardware.
- Importação com tamanho igual não verifica assinatura/conteúdo específico de cada título. A cópia anterior vive apenas na sessão, não é backup durável. O servidor mantém suas proteções existentes: hash, lock, ETag, envelope atômico e backup anterior.
- Envelopes antigos sem `coreBuild` são aceitos somente como o único conjunto SNES historicamente suportado, sem reescrita na leitura. Versões/builds divergentes são recusados. Uma futura atualização deve rever explicitamente essa compatibilidade.
- O hashing integral por GET/Range da ROM foi preservado. Remover a verificação com base só em mtime/tamanho enfraqueceria a identidade existente; a remoção do HEAD elimina a leitura redundante do boot sem esse risco. Ingestão imutável para mídias grandes fica para a prova PS1.
- Cache de runtime usa `no-cache` (pode armazenar, exige revalidação), não `no-store`; os nomes não versionados não recebem cache imutável. ROMs/saves/API continuam `no-store`.
- O launcher aceita HTTP e HTTPS de IP privado. HTTPS depende de certificado confiável e configuração real do servidor; não foi criado certificado nem afrouxada validação TLS. O health `no-cors` mede apenas alcance, explicitado no texto; identidade funcional é conferida pela UI após navegar. Não abrimos CORS para transformar resposta opaca em falsa confirmação.
- O instalador monta e verifica uma árvore temporária antes de renomear, preserva a árvore anterior e tenta rollback em falha. Exige servidor parado; não promete atomicidade através de queda de energia entre dois renomes. O build usual não instala dependências opcionais do CLI webOS.

## Como medir na LG

1. Com servidor parado, gerar UI/runtime e iniciar servidor novamente. Instalar explicitamente o IPK 0.0.2 de `artifacts/ipk/1920x1080/`; conferir seu `.verified.json`. Instalação não foi executada nesta entrega.
2. Em Diagnóstico, conferir índice/mapping, calibrar se necessário e ativar registro da sessão. Usar WebGL1/1080p como referência inicial. Registrar modelo/firmware/webOS, USB/Bluetooth, modo de imagem e rede em nota junto ao JSON.
3. Iniciar um jogo legítimo. Aquecer 60 s; medir por 30 min (60 min antes de uso prolongado). Pausar e usar **Exportar diagnóstico da sessão**; conferir que o arquivo existe. O relatório contém até 360 janelas de 10 s e os últimos 300 eventos de entrada. Eventos antigos são descartados para limitar memória.
4. Repetir três vezes variando somente WebGL1/2; depois somente 1080p/720p. Pacotes de resolução têm mesmo ID/versão; reinstalar um por vez. Registrar hashes para não confundir variantes. Não inferir 60 FPS de um jogo de 30 nem RAM por quota de armazenamento.
5. Verificar salvar no jogo → salvar no servidor → fechar/reabrir → Continuar, depois reboot, standby, offline e conflito. Ativar sincronização somente após esse aceite por jogo/core.

`coreFramesPerSecond` é progresso do contador do core; `browserRafMs` é intervalo de callbacks do navegador. Janelas com pausa/ocultação e aquecimento são marcadas. Taxa nominal, percentual de velocidade, trabalho ativo do core, apresentação real de frames, underruns/buffer de áudio e RAM ficam `null` quando não disponíveis. Não há alegação de ganho de FPS ou áudio perfeito.

## Evidência local

- Testes de regressão foram primeiro executados contra o runtime original: índice esparso, input durante pausa e Gamepad API negada falharam. Após patch, passam; também são testados bloqueio de hotkeys e SRAM volátil.
- Testes unitários cobrem perfil/neutro, snapshot copiado, exclusão de uploads concorrentes, ETag, conflito, três falhas e tamanho de SRAM.
- Playwright inclui loader/bundle reais sem fallback, 20 ciclos sintéticos de reconexão, correlação pausa/resume, erro fatal preservado e A segurado sem clique herdado. Os testes SRAM usam engine de memória: comprovam o bridge, não interpretação pelo SNES.
- Backend cobre persistência/conflito/backup, limite/path/origem, troca de jogo/slot, build antigo/novo, cache e exigência de runtime verificado. Symlink sem privilégio no Windows continua marcado como ignorado; teste de junction roda.
- Capturas revisadas: `artifacts/screenshots/audit-player-{1920,960}.png` e `audit-diagnostics-{1920,960}.png`. São fixtures sintéticas e navegação desktop; não evidência de jogo ou TV.
- Resultados consolidados de comandos ficam em `docs/validation.md`. CI remota não executada: esta cópia não tem remoto nem commit inicial. Mudanças ficaram em `codex/audit-improvements`, preservando os arquivos preexistentes.
