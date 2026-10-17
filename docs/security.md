# Fronteiras e dependências

Uso previsto: rede doméstica confiável, sem exposição pública. Host é allowlist exata configurada pelo operador; IP público é recusado. Escritas exigem header próprio, Origin same-origin quando enviado e não aceitam `Sec-Fetch-Site: cross-site`. Não há CORS aberto, autenticação de LAN, port-forward ou mudança de firewall automática. Outro cliente autorizado da LAN ainda pode acessar conteúdo/saves: não tratar Host/CORS como login.

ROMs são somente leitura no servidor, resolvidas por ID. Caminhos de armazenamento rejeitam links e junctions. Não existe upload, delete ou move de ROM por HTTP. A API de saves valida jogo/slot/tamanho/core/versão. Rename atômico e backup preservam a gravação anterior, conflitos não sobrescrevem o slot.

O iframe valida origem, janela remetente, gameId, requestId e tipo de mensagens; pai e bridge verificam ambas as direções. CSP bloqueia conexão externa e assets de terceiros, permitindo blob/WASM necessários à engine. O patch fixado remove a consulta de atualização e o fallback de core à CDN. ROMs recebem no-store; bancos de ROM/BIOS/core estão desativados. SRAM usa FS volátil; bancos antigos não são apagados. Nenhum Service Worker instalado pelo produto. Runtime/UI podem usar cache HTTP revalidado; assets com hash no nome usam cache imutável.

Não há logs de bytes de saves/ROMs, caminhos absolutos em API ou telemetria. Uvicorn registra rotas e IDs no access log local. Diagnóstico básico omite identificadores; registro de sessão opt-in inclui ID do controle, teclas/botões/eixos, foco e estado da pausa. Mantém no máximo 300 eventos de entrada e 360 amostras de 10 s. Não inclui ROM, SRAM ou caminho do PC e só é exportado por ação explícita. Trate o arquivo como privado.

## CLI oficial opcional

`@webos-tools/cli@3.2.6` é isolado em `tools/webos` e não faz parte da UI, backend, build normal ou IPK. `npm audit` nesse lockfile reporta **10 vulnerabilidades: 1 crítica, 7 altas e 2 moderadas**, incluindo proxy-addr, shelljs/micromatch/braces, sprintf-js e dependências transitivas. `npm audit fix --package-lock-only` não corrigiu o conjunto. Nenhum override incompatível foi aplicado.

O CLI não foi usado para abrir inspector/servidor de debug nem comunicar com dispositivos. O empacotamento local é a operação prevista; trate inputs desse CLI como arquivos locais confiáveis. A dívida de atualização upstream permanece; reavalie o audit antes de usar ferramentas de rede do CLI. A ausência de vulnerabilidades no cliente não significa ausência de riscos no CLI/runtime de terceiros.
