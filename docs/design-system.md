# Direção visual e decisões

Brief: biblioteca pessoal SNES em PT-BR na LG, uso a 2–3 m, controle remoto/gamepad. Caminho direto para código autorizado pelo usuário, usando a seção 9 do plano como alvo visual. Preservar canvas escuro, contraste, roxo SNES, amarelo exclusivamente para foco, tipografia pixel apenas em destaques e controles grandes.

Pesquisa Refero: quatro buscas de estilos (retro arcade, Steam, dark technical e gaming) retornaram `NO_RESULTS`. Não inventamos resultados de estilos. Foram pesquisadas telas e lidos detalhes de duas referências reais:

- [Xbox catálogo](https://refero.design/pages/b8835113-71e2-4829-a524-df041f94a323): superfície escura, grid regular, título próximo à mídia, hierarquia de navegação.
- [Epic catálogo](https://refero.design/pages/3e3ba1fd-e5eb-4299-94ae-9d2fbcf14f24): separação clara entre navegação, busca e cards, paginação explícita.
- Referência craft complementar: `refero-design/references/craft-details.md`: foco visível, controles sem remoção de outline, labels e alvos confortáveis.

Alvo principal: pixel arcade 16-bit do plano. Xbox só orienta grid/hierarquia e Epic só busca/paginação. Não são incorporados preços, promoções, imagens protegidas ou CTAs de assinatura. Não usamos um layout de loja para inventar acervo.

| Decisão | Fonte | Papel preservado |
|---|---|---|
| #101321 canvas / #1B2034 painel | Plano §9 | Base e superfícies |
| #A889F7 SNES / #F9DB6D foco | Plano §9 | Identidade e foco, respectivamente |
| Pixelify em logo/headlines / Archivo no corpo | Plano §9 | Pixel curto e corpo legível; fontes OFL locais |
| Grade com quatro cards em 1920 px | Xbox + contexto 10-foot | Leitura e navegação espacial com alvos grandes |
| Busca rotulada e paginação | Epic | Coleção maior sem navegação infinita |
| Monograma SF e número 16 geométrico | Brief 16-bit | Primitivas originais; sem personagens/logos de terceiros |
| Estado vazio sem capas falsas | Brief de conteúdo privado | Explicar como adicionar ROMs legítimas |
| Transições 120 ms e reduced-motion | Plano + craft | Feedback curto; nenhuma animação contínua durante jogo |

Tokens são definidos em `apps/tv-client/src/design-system/tokens.css`. Controles usam HTML nativo e o foco espacial tem escopo do modal durante pausa. CSS global não carrega CDN. Layouts menores são suportados como ferramentas de diagnóstico, sem afirmar que substituem aceite na TV.

Evidência visual local é produzida com `node scripts/diagnose/capture-ui.mjs` após subir o servidor. Capturas ficam em `artifacts/screenshots/`, fora do Git. Validar 1920×1080, viewport reduzida e estado vazio; 200% de zoom real e distância da TV continuam no checklist de hardware.

Auditoria de 17/10: calibração/experimentos ficam no Diagnóstico, em fieldsets nativos, seguindo a hierarquia existente. O menu do player mantém os controles de progresso e mostra confirmação/erro sem fechar antes do ACK. Referências mantidas: alvo existente deste documento e `craft-details.md` (labels, foco visível e controles nativos). Select recebe os mesmos tokens/foco e preserva teclas nativas; durante calibração, polling da UI não consome os botões capturados. Capturas `audit-*` foram revisadas em 1920 e 960 px, incluindo scroll do modal.
