# Super Flip CB

Biblioteca SNES doméstica para LG webOS: React/TypeScript na TV, EmulatorJS/WASM **na TV**, FastAPI e arquivos no PC. UI, API, ROM e core são servidos na mesma origem LAN. Não há emulação no servidor nem serviço de nuvem obrigatório.

**Estado: implementação inicial v0.0.1, sem aceite de hardware.** Por orientação do usuário em 17/10/2026, implementação precede a PoC. A etapa de validação na LG está em [docs/hardware-tests.md](docs/hardware-tests.md). Áudio, gamepad, cache, retomada e desempenho na TV ainda não foram comprovados. Atari, Mega Drive e PS1 não estão habilitados.

## Executar no Windows

Requisitos: Node **24.15.0** (ou compatível 24 LTS), npm e uv **0.11.9**. Python **3.13.13** é instalado/selecionado pelo uv; dependências estão em lockfiles.

```powershell
uv python install 3.13.13
.\scripts\build\build.ps1
uv run --project server python scripts/runtime/install-runtime.py
.\scripts\dev\start-server.ps1
```

Abra `http://127.0.0.1:8797/`. O runtime é opcional para explorar a biblioteca vazia; é necessário para jogar. Seu instalador baixa apenas EmulatorJS 4.2.3 e dois builds SNES com SHA-256 fixos. Reinicie o servidor depois da instalação do runtime ou alteração do catálogo.

A porta padrão é **8797**. A porta 8787 foi descartada como padrão porque já é usada pelo Caveman Proxy neste ambiente. Para escolher outra porta, use `start-server.ps1 -Port 8800`. O script testa o bind real antes de iniciar, sem confundir conexões em encerramento com uma porta ocupada; ajuste também o endpoint do launcher e o proxy do Vite se mudar a porta.

Os dados ficam em `data/`, ignorado pelo Git. Adicione arquivos `.sfc`/`.smc` obtidos legitimamente a `data/roms/snes/`. Nada acompanha a biblioteca. Subpastas são aceitas; arquivos duplicados por conteúdo produzem um único jogo. IDs usam `snes-<sha256 integral>`; alterar a ROM produz outro ID e não migra saves automaticamente.

Opcional: `data/catalog.json` pode mapear cada ID para `{ "title": "Título escolhido" }`. Sem isso, o nome do arquivo vira um rótulo, sem inferência de metadados. Capas locais opcionais: `data/covers/<id>.png`. Não há download automático de capas.

## Usar na LAN e empacotar

Descubra o IPv4 real do PC e configure uma reserva DHCP. Exemplo de comando **com o IP real substituído**:

```powershell
.\scripts\dev\start-server.ps1 -BindAddress 0.0.0.0 -AllowedHosts @('localhost','127.0.0.1','192.168.1.20') -DataPath 'D:\SuperFlipData'
```

Permita a porta escolhida apenas no perfil **Privado** do Windows Firewall e, preferencialmente, apenas para a TV/sub-rede. Os scripts não alteram firewall, roteador, DHCP ou a TV. Não configure port-forward/túnel público. A API não autentica usuários da LAN; hosts permitidos e proteção de origem reduzem outros ataques, mas não substituem autenticação numa rede não confiável.

O launcher permite informar o endereço pelo teclado virtual da LG e guarda somente essa configuração local. Ele verifica alcance antes do redirecionamento e exibe falha de conexão. Comportamento `file:` → HTTP, teclado virtual e redirecionamento dependem da validação na LG. Após navegar para o servidor, o fallback local do launcher não acompanha uma queda posterior; a UI trata erros de API quando permanece carregada.

CLI webOS é **opcional e isolado** em `tools/webos`. Consulte [docs/security.md](docs/security.md) antes de instalá-lo: o pacote oficial inclui dependências vulneráveis, sem correção completa disponível nesta versão.

```powershell
.\scripts\package\package.ps1 -InstallTools
# Com Developer Mode ativo e dispositivo já cadastrado no CLI:
.\scripts\deploy\install-tv.ps1 -Device 'nome-da-lg' -Ipk '.\artifacts\ipk\1920x1080\com.superflipcb.app_0.0.2_all.ipk'
```

`com.superflipcb.app` é ID provisório para uso privado. O IPK contém somente o launcher/ícones, sem dados, UI compilada ou engine. Nenhuma instalação é automática. Renove a sessão do Developer Mode pela ferramenta oficial LG; não há promessa de instalação permanente. Atualize build/runtime com o servidor parado e preserve dados/backup. Reinstalação do launcher exige redigitar o endpoint se o armazenamento de configuração for apagado.

## Jogar e preservar progresso

Navegue com setas/OK/Voltar ou D-pad/A/B. Dentro do player, Voltar ou **Select + Start** abre o menu. O jogo aparece em área 4:3; use o botão “Iniciar jogo” para iniciar áudio por ação explícita. Reconhecimento do gamepad no HTTP LAN depende do webOS e do modo `cloudgame_active`, ainda pendentes de teste.

1. Grave pelo menu **do jogo** para produzir SRAM.
2. Abra o menu Super Flip e selecione **Salvar no servidor**; aguarde confirmação.
3. Na próxima abertura, o player tenta recuperar o SRAM do slot 1. A restauração após boot pode exigir reinício/seleção de continuar dentro do jogo.
4. Em conflito/falha, exporte o SRAM antes de sair. O save do servidor nunca é substituído por uma sessão com ETag antigo. Reabra/restaure somente depois de preservar a cópia da sessão.

A sincronização opcional da sessão verifica SRAM a cada 15 s, envia somente mudanças, mantém uma requisição por vez e para após conflito ou três falhas consecutivas. Ative-a pelo menu somente depois de validar salvar/reabrir/continuar nesse jogo na TV. Não há fila durável offline: standby/encerramento abrupto pode perder progresso ainda não confirmado. SRAM usa filesystem volátil na sessão; saves antigos em IndexedDB não são apagados nem carregados por cima do servidor. Download/importação funcionam nos testes desktop, mas **não foram comprovados na LG**. Importar/restaurar exige tamanho igual ao informado pelo jogo/core, mantém uma cópia anterior exportável enquanto a sessão existir e desativa autosync. Tamanho compatível não comprova conteúdo válido. Save states continuam experimentais, sem hotkeys ou comandos na UI.

## Correções da auditoria de 17/10/2026

Detalhamento, provas e pendências: [docs/audit-improvements.md](docs/audit-improvements.md). O launcher 0.0.2 usa `cloudgame_active=true`; instalar somente o frontend no PC não altera o manifesto do app já instalado na TV. `package.ps1` verifica o manifesto dentro do IPK e gera um JSON com hash. Para comparação de composição: `package.ps1 -Resolution 1280x720`; os pacotes usam o mesmo ID/versão e pastas separadas, instalando apenas um por vez. Não há instalação automática.

Em Diagnóstico, calibre controles sem `mapping=standard`, selecione WebGL 1/2 e ative o registro antes da partida. O menu permite exportar a sessão: build/hash, renderer efetivo quando acessível, boot, frames do core, intervalos rAF e eventos de entrada. Sem taxa nominal confiável não calculamos percentual de velocidade; áudio e memória indisponíveis são `null`. As opções de medição duram a sessão do navegador; só o perfil de controle e o endpoint do launcher têm armazenamento persistente intencional.

O runtime é produzido localmente pelo toolchain instalado, sem debug e sem consulta/fallback à CDN. O patch verifica SHA-256 antes/depois; o servidor verifica cores e bundle ao iniciar. Com servidor parado, execute `scripts/build/build.ps1` para atualizar uma instalação existente ou o instalador para obter a árvore completa. O instalador prepara tudo antes da troca de diretório e conserva `vendor/emulatorjs-backup-*` para rollback. Em caso de falha física entre renomes, recoloque o backup manualmente com o servidor parado. UI/runtime permitem cache com revalidação (assets com hash, cache imutável); ROMs, saves e API mantêm `no-store`.

Cada save no PC é um envelope JSON com bytes em base64 e metadados: a gravação atômica desse único arquivo evita desencontro entre dois arquivos. O servidor usa lock entre processos, checksum, `If-Match`, temporário na mesma pasta, `fsync`, rename atômico e backup do envelope anterior. Não há garantia contra falha física do disco ou desligamento no instante de persistência do hardware.

Com o servidor parado:

```powershell
.\scripts\backup\backup.ps1 -DataPath 'D:\SuperFlipData' -Destination 'E:\BackupsSuperFlip'
# Extraia um envelope do ZIP. A restauração recusa sobrescrever um slot existente:
uv run --project server python scripts/backup/restore.py 'E:\Recuperacao\envelope.json' 'D:\SuperFlipData'
```

Mova a cópia danificada para fora da pasta `saves` antes de restaurar, preservando-a para recuperação. Backups automáticos anteriores ficam em `data/backups`; o ZIP manual captura os slots atuais. Faça retenção/cópia externa periodicamente e valide um restore. ROMs não são incluídas nesses backups.

## Verificação local

```powershell
uv run --project server ruff check server/app server/tests
uv run --directory server pytest -q
uv run --project server python scripts/diagnose/export-openapi.py --check
cd apps/tv-client
npm ci
npm run contracts
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e
```

O E2E usa servidor temporário isolado, bytes sintéticos **não executáveis** e engine/iframe stub conforme o teste. Não utiliza dados privados nem demonstra jogabilidade. CI executa os testes fora da TV; não publica nem instala nada. Para desenvolvimento com HMR, execute o backend e `npm run dev` no cliente; use build servido pelo backend para testar saves/same-origin, pois origem e proxy de desenvolvimento não representam o ambiente da LG.

Mais detalhes: [análise do plano](docs/implementation.md), [design](docs/design-system.md), [versões](docs/decisions/ADR-versions.md), [protocolo](docs/player-contract.md) e [licenças](assets/licenses/README.md).
