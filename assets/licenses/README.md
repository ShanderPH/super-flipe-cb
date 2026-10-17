# Origem dos assets

- Ícones `icon.png` 80×80 e `largeIcon.png` 130×130: monograma geométrico SF original, gerado por `scripts/build/icons.py`. Não imita marcas, personagens ou sprites de jogos.
- Favicon SVG, ICO (16/32/48 px) e PNG de 32 px: derivados do mesmo monograma original pelo mesmo gerador, incluídos no cliente e launcher.
- Fontes Archivo e Pixelify Sans: pacotes Fontsource fixados no lockfile. Arquivos WOFF2 self-hosted e licenças SIL OFL nas cópias deste diretório.
- EmulatorJS: GPL-3.0, fonte fixada no commit `e150dc0491ae747028919fb82d6598954976ede6` do tag v4.2.3. Licença copiada para este diretório; runtime baixado fica ignorado pelo Git. Fonte: https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3.
- Snes9x/WASM: ver `vendor/emulatorjs/data/cores/core-README.md`, relatório fixado e licenças do Snes9x/libretro. A licença GPL do loader não substitui as condições do core e dependências: https://github.com/snes9xgit/snes9x e https://github.com/libretro/snes9x. Uso comercial/redistribuição requer revisão específica. O produto não declara todos os componentes como estando sob uma única licença.
- Não há ROM, BIOS, capa comercial ou áudio de jogo incluído. Placeholders de catálogo são números/texto, não capas inventadas.

O código original deste projeto ainda não recebeu licença pública escolhida pelo proprietário. Não considerar ausência de licença como autorização de redistribuição. Manter avisos/fontes/licenças dos componentes ao preparar qualquer redistribuição autorizada.
