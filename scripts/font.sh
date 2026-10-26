#!/bin/sh
# Подмножество вариативного Manrope для сайта (docs/meat-auto/fonts.md).
# Исходник: source/fonts/Manrope[wght].ttf — google/fonts, ofl/manrope (v4.505, OFL 1.1).
# Нужен fontTools с brotli: pip install fonttools brotli. Запуск: npm run font
set -e
cd "$(dirname "$0")/.."
pyftsubset "source/fonts/Manrope[wght].ttf" \
  --output-file=dist/assets/fonts/manrope-vf.woff2 --flavor=woff2 \
  --unicodes='U+0020-007E,U+00A0-00FF,U+0400-045F,U+2010-2027,U+2030-203A,U+2116,U+20BD,U+2190-2193,U+2212' \
  --layout-features='kern,liga,calt,tnum,pnum,case' \
  --name-IDs='*' --name-legacy --name-languages='*' --notdef-outline --no-hinting --desubroutinize
ls -l dist/assets/fonts/manrope-vf.woff2
