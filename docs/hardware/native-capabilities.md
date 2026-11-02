# Capacidades nativas: 55QNED70BSA

Data: 18/10/2026. A matriz abaixo registra o gate inicial local. A sessão física
posterior confirmou carga do runtime/core, ROM da LAN, janela visível e stream
PulseAudio; veja [evidências e limites](native-tv-session-20261018.md).

## Separação de evidências

Informação do usuário: LG 55QNED70BSA, webOS 26, versão 11.2.0-2909 e RetroArch
nativo já testado com bom desempenho. O relatório histórico
`docs/research/webos-hardware-capabilities.md` registra kernel AArch64, quatro
CPUs e cerca de 1,67 GiB visíveis ao SO em 17/10; são leituras anteriores, não
uma medição nova nem orçamento de memória para o app. Não inferir userspace/ABI
de aplicativo a partir do kernel ou do nome comercial.

| Capacidade | Como verificar no contexto correto | Resultado desta rodada |
|---|---|---|
| Kernel/ISA/CPU | uname, cpuinfo e, quando exposto, frequências | Não medido na TV |
| ABI/userspace | classe/machine/interpreter do ELF do aplicativo e libs reais, LONG_BIT quando disponível | Candidato compilado ARM32 EABI5 softfp; firmware ainda não verificado |
| Loader/core `.so` | `native-probe` tenta dlopen no sandbox do app e log do runtime | Pendente TV |
| EGL/GLES/renderer | contexto SDL nativo, glGetString e eglQueryString | Probe implementado; pendente TV |
| SDL drivers | enumeração e driver inicializado, versão compilada e carregada | Headers SDK 2.32.10, biblioteca webOS 2.30.12-webos.5; símbolos/uso físico pendentes |
| Áudio | driver aberto e depois PulseAudio no RetroArch com som audível | Probe silencioso implementado; pendente TV |
| Memória | limits/status/smaps do processo e MemAvailable do SO separados | Pendente; sem teto inventado |
| Armazenamento | statvfs/df para app e /tmp; testar escrita apenas na pasta experimental | Pendente TV; cache projetado para ≤32 MiB de ROMs no pico |
| Execução de código/JIT | mmap RW→mprotect RX no app, depois dynarec real do core | Probe só verifica mapeamento, não executa código gerado; PS1 pendente |
| Input/permissões | enumeração SDL + abrir/testar controles, hotplug e reconexão | Pendente TV; listar /dev não comprova acesso |
| Flutter | doctor/build SDK oficial, instalar/testar modelo real e superfície nativa | Suporte documental a 26 Re:New; modelo exato sem teste |
| ACG/Luna | log das chamadas reais e permissões disponíveis no firmware comercial | Não se concederam privilégios ou ACGs especulativos |

## Ferramentas entregues

`scripts/native/capabilities.sh`: leitura de kernel, ELF de userspace, processo,
memória, filesystem, presença de bibliotecas e devices. Deve ser executado pelo
usuário/operador somente numa sessão autorizada de Developer Mode. Não altera
firmware, serviços, ACL, firewall ou políticas de energia.

`native-probe [--seconds 0..60]`: roda no mesmo pacote/sandbox nativo, informa
ABI do processo, stack/limites, espaço, dlopen do core, SDL/GL/EGL, dispositivo
de áudio e enumeração/hotplug/foco. Abre uma janela e áudio silencioso; não mede
qualidade, input→fóton, apresentação ou performance de emulação. JSON em stdout
e código não zero indicam capacidades obrigatórias ausentes.

O probe e o RetroArch dependem de bibliotecas de plataforma listadas em
`build.json`; EGL/GLES/PulseAudio/fontconfig/FreeType/libc não são substituídas
pelos stubs do SDK. O pacote inclui as bibliotecas reais adicionais de curl,
crypto/SSL, json-c, zlib, SDL, stdc++, gcc_s e atomic, com origem/licenças.

## Bloqueios locais observados

Docker Desktop não iniciou por erro de socket do Inference manager. Foi criado
o WSL2 isolado **SuperFlipNative**, Ubuntu Base 24.04.3, dentro de
`artifacts/native/wsl`; o distro padrão e a TV não foram alterados.

Uma tentativa de executar os ELF ARM com qemu-user e o sysroot do SDK sofreu
SIGSEGV antes de `main`, tanto no lançador quanto no RetroArch. A causa não foi
fechada. Esse sysroot é um ambiente de link para o firmware, não uma imagem
completa da TV; não se apresenta QEMU como validação do firmware nem se conclui
que a TV falhará. Logs foram preservados em evidência local. A compatibilidade
de carga e execução dos ELF ARM segue obrigatoriamente para o gate físico.

**Confirmado:** fontes/documentação e ABI dos artefatos.
**Implementado:** dois diagnósticos e build isolado.
**Testado:** compilação, contratos e core desktop; sem nova medida da LG.
**Pendente físico:** toda a matriz de capacidades no sandbox comercial real.
