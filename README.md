# SmartPharma

Web de SmartPharma: gestión de stock y compras para farmacias.

- La web se publica con GitHub Pages desde esta rama.
- `scraper/indexar.py` genera el índice de precios del comparador (`comparador/precios/`)
  a partir de páginas de producto públicas, respetando el robots.txt de cada tienda.
  Lo ejecuta `.github/workflows/indexar-precios.yml` cuatro veces al día.

© Miguel Ángel Leo Acedo. Todos los derechos reservados, salvo el lector de códigos de
barras ZXing (`assets/vendor/zxing/`), con licencia Apache 2.0.
