# Gate de aceite nativo na LG

Data: 18/10/2026. Status: **não aprovado para substituir o produto atual**.
Build e IPK verificados no PC não equivalem a aceite físico. Atualização:
instalação, ROM da LAN e execução nativa na LG foram verificadas. O usuário
aprovou os testes com Super Mario e relatou desempenho excelente. Esse aceite
inicial de SNES não aprova PS1, persistência/reboot ou métricas não medidas.
A tabela abaixo preserva o checklist inicial; evidências posteriores em
[sessão física](../hardware/native-tv-session-20261018.md).

| Gate | Prova/critério | Estado |
|---|---|---|
| Fontes e build | Entradas/SHA fixados, Debug/Release, ABI do ELF/core/deps e símbolos separados | Scripts implementados; resultados locais no relatório de build |
| Pacote | IPK contém `type=native`, ID próprio, executáveis com permissão, core ARM32 e hashes corretos | Verificação estrutural local; instalação ainda não testada |
| Core real | Init/load/run/unload/deinit, callbacks A/V/input, SRAM e serialize | Core desktop real com ROM original; ARM na TV pendente |
| Sem browser no jogo | Processo RetroArch ELF com core `.so`; sem iframe/EmulatorJS/WASM | Arquitetura/payload confirmados; execução física pendente |
| Vídeo | GLES/EGL/SDL disponíveis, imagem/aspect ratio/filtro corretos, pacing | Pendente TV |
| Áudio | PulseAudio, taxa/buffer apropriados, 30/60 min sem defeitos relevantes | Pendente TV; teste silencioso não aprova áudio audível |
| Input | Xbox, PlayStation e genéricos disponíveis; USB/Bluetooth; hotplug/reconexão; jogadores | SDL/RetroArch reutilizados; todos os modelos físicos pendentes |
| Menu/foco | Só comando mapeado abre menu; jogo pausado não aciona UI; retorno neutro; sem overlay permanente | Configuração implementada; físico pendente |
| LAN | API real, ROM íntegra, limite de cache/erro/queda e execução independente de tráfego por frame | Contratos locais; LAN PC↔TV pendente |
| Saves | Legado intacto; backup/compatibilidade aprovados; persistência depois de reboot e sem conflito silencioso | Legado isolado; migração/sync/restore físico pendentes |
| Performance | Protocolo A/B, ≥95% nominal onde baseline cumpre, sem regressão inexplicada | Pendente TV; nenhum FPS desktop é usado para aprovação |
| Lifecycle | menu, Home, standby/retorno, encerramento e recuperação | Pendente TV |
| PS1 | BIOS legal, dynarec permitido/funcional, formatos/discos, controles/cartões/estados e sustentação | Não implementado/aceito neste app |
| Produto/identidade | Catálogo, capas/metadados reais, detalhes/histórico, perfis, LAN/save UX | Fase 3 pendente; RGUI é apenas diagnóstico |

## Roteiro físico seguro

Após autorização específica da sessão e backup: instalar somente o IPK
verificado sob `com.superflipcb.native.poc`, deixando baseline/legado instalados.
Executar `capabilities.sh` e `native-probe`, guardar JSON/logs. O probe abre
janela e um dispositivo de áudio silencioso por até 60 s e tenta carregar o
core; não inicia jogo nem mede latência de áudio. Depois executar a ROM diagnóstica
original e então um jogo autorizado com a mesma configuração do baseline.

Validar botões individualmente antes de gameplay, controle remoto como secundário,
deadzones e neutralização no retorno, dois jogadores e troca/reconexão. Registrar
botões reservados pelo SO; não prometer capturá-los. Verificar de onde vêm os
perfis e se são persistidos; a PoC não implementa o gerenciador de perfis Super Flip.

Gerar progresso somente em namespace de laboratório. Encerrar normalmente,
copiar/hashar os arquivos, desligar/reiniciar e validar recuperação dentro do jogo.
Depois testar falha controlada com backup; nunca usar o único save real nesse
ensaio. Não considerar a existência de um `.srm` como prova de continuidade.

Aplicar o [protocolo de baseline](retroarch-baseline.md), 30/60 min e métricas
separadas por fronteira. Ausência de ferramenta/permissão gera `unavailable`
com motivo, nunca número inventado. Falha em qualquer gate preserva o legado e
o RetroArch baseline; sem promoção automática, root ou alteração de firmware.

**Confirmado:** critérios e limites. **Implementado:** infraestrutura de PoC.
**Testado:** somente os gates locais identificados no relatório.
**Ainda exige hardware:** todos os itens marcados pendentes acima.
