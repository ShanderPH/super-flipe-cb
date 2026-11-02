# ADR: UI final condicionada à integração e ao custo no gameplay

Status: UI C++/SDL adotada para a primeira fatia funcional; aceite visual e de
controles do produto continua separado do aceite da engine SNES.
Data: 18/10/2026.

## Decisão

Atualização de 18/10: catálogo nativo com os tokens existentes, navegação,
detalhes, preparo e retorno foi implementado. UI e RetroArch fazem handoff via
exec no mesmo PID. A tentativa de supervisor/filho encontrou problemas reais de
registro/foco no webOS e foi descartada. A solução atual mantém o gameplay no
runtime comprovado e acrescenta um bridge pequeno de encerramento. Detalhes e
limites em [produto nativo](../development/native-product.md). A análise de
Flutter e as decisões originais abaixo permanecem como histórico.

Não portar React para Flutter nem implementar um design system nativo inteiro
na PoC. Usar RGUI como ferramenta diagnóstica do RetroArch. A identidade visual
continua definida pelos tokens e por `docs/design-system.md`; ainda não está
integrada ao app nativo. Não foi produzido um novo design ou uma interface mock.

Comparar primeiro customização/menu nativo do RetroArch com uma pequena UI C++
própria. Registrar o custo real para catálogo LAN, seleção por gamepad, detalhes,
início do jogo, menu de pausa e retorno, sem trabalho de UI durante gameplay.

## Flutter

O SDK oficial consultado declara suporte a **webOS 26 Re:New**, NDK 11.2.0 e
host Ubuntu/WSL/Docker. Isso supera a hipótese antiga de ausência de suporte
oficial, mas não confirma funcionamento no modelo e firmware específicos.

FFI/Platform Channels resolvem chamadas, não compartilhamento de superfícies.
O plugin `webos_image_texture` examinado usa `PixelBufferTexture` e `memcpy`.
Não é evidência de uma textura de core reutilizada pela GPU sem cópias custosas.
Alguns arquivos do plugin têm aviso proprietário LG, exigindo revisão antes de
qualquer reutilização. Nenhuma PoC Flutter foi apresentada como concluída.

Para justificar uma PoC Flutter: doctor/build no SDK fixado, app na TV real,
superfície EGL/textura com ownership e sincronização demonstrados, foco exclusivo,
transição UI/jogo e medição A/B de memória, frame time e áudio. Sem isso, o
caminho C/C++/RetroArch mantém preferência. Emulação nunca seria executada em Dart.

## Registro de evidência

**Confirmado:** documentação oficial e implementação dos plugins consultados.
**Implementado:** nenhuma migração visual; configuração diagnóstica RGUI.
**Testado:** nenhuma superfície Flutter/libretro nem nova UI no dispositivo.
**Pendente físico:** textura/sincronização, input/foco, memória e custo sustentado.
Uma futura implementação visual deve pesquisar referências conforme a metodologia
do projeto e preservar os estados acessíveis e a navegação de sofá existentes.
