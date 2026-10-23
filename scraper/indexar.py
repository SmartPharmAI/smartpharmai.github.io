"""Índice de precios de parafarmacia por código de barras (EAN).

Recorre despacio las páginas de producto de varias parafarmacias online, siempre
dentro de lo que permite su robots.txt (nunca su buscador), y genera un índice
estático EAN -> precio más bajo que lee el comparador de la web.

Solo usa la librería estándar de Python. Pensado para ejecutarse cuatro veces al
día con GitHub Actions: cada ejecución recorre la parte que le toca de cada tienda
para dar una vuelta completa por semana, empezando donde se quedó la anterior.

Uso:
    py scraper/indexar.py                    # ejecución programada (cuota semanal)
    py scraper/indexar.py --arranque         # primer llenado: sin cuota, hasta --minutos
    py scraper/indexar.py --max-paginas 30   # prueba corta
"""

import argparse
import gzip
import json
import re
import threading
import time
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import date, datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESTADO = RAIZ / "scraper" / "estado"
DATOS = RAIZ / "scraper" / "datos"
SALIDA = RAIZ / "comparador" / "precios"

# Sin "robots.txt" en el texto: algún cortafuegos de tienda bloquea esa cadena
USER_AGENT = "SmartPharmaBot/1.0 (indice de precios de parafarmacia)"
PAUSA_MINIMA = 2.0          # segundos entre páginas de una misma tienda
DIAS_MAPA = 7               # cada cuánto se vuelve a leer el mapa del sitio
DIAS_VALIDEZ = 14           # un precio más antiguo deja de mostrarse
DIAS_SIN_PRODUCTO = 30      # una página sin código de barras o precio se salta este tiempo
EJECUCIONES_SEMANA = 28     # cuatro al día (ver .github/workflows/indexar-precios.yml)
GUARDAR_CADA = 200          # páginas entre guardados, por si la ejecución se corta

# Tiendas comprobadas: permiten sus páginas de producto en robots.txt y publican
# el código de barras y el precio en datos estructurados. La web no muestra sus nombres.
TIENDAS = [
    {"id": "t1", "base": "https://www.farmaciagt.com", "producto": r"\.html$", "pausa": 2},
    {"id": "t2", "base": "https://www.farmaciaencasaonline.es", "producto": r"/\d+-[^/]+\.html$", "pausa": 2},
    # Su robots.txt pide 10 s; se fija aquí también por si un día no se pudiera leer
    {"id": "t3", "base": "https://www.parafarmaciacampoamor.com", "producto": r"/es/\d+-[^/]+\.html$", "pausa": 10},
]


def descargar(url, timeout=20):
    peticion = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(peticion, timeout=timeout) as r:
        datos = r.read()
    if datos[:2] == b"\x1f\x8b":
        datos = gzip.decompress(datos)
    return datos.decode("utf-8", "replace")


def urls_del_mapa(xml):
    return re.findall(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)", xml)


def ean_valido(ean):
    if not re.fullmatch(r"\d{13}", ean or ""):
        return False
    suma = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(ean[:12]))
    return (10 - suma % 10) % 10 == int(ean[12])


PATRONES_EAN = [
    r'itemprop="gtin13"\s+content="(\d{13})"',
    r'"gtin13"\s*:\s*"?(\d{13})',
    r'"gtin"\s*:\s*"?(\d{13})',
    r'"ean13"\s*:\s*"?(\d{13})',
]
PATRONES_PRECIO = [
    r'property="product:price:amount"\s+content="(\d+(?:[.,]\d+)?)"',
    r'itemprop="price"\s+content="(\d+(?:[.,]\d+)?)"',
    r'"price"\s*:\s*"?(\d+(?:[.,]\d+)?)',
]


def leer_producto(html):
    """Devuelve (ean, precio, nombre) o None si la página no trae los dos primeros."""
    ean = next((m.group(1) for p in PATRONES_EAN for m in [re.search(p, html)] if m and ean_valido(m.group(1))), None)
    precio = None
    for p in PATRONES_PRECIO:
        for m in re.finditer(p, html):
            valor = float(m.group(1).replace(",", "."))
            if valor > 0:
                precio = valor
                break
        if precio:
            break
    if not ean or not precio:
        return None
    nombre = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.S) or re.search(r'property="og:title"\s+content="([^"]+)"', html)
    nombre = re.sub(r"<[^>]+>|\s+", " ", nombre.group(1)).strip() if nombre else ""
    nombre = re.split(r"\s+[|–]\s+", nombre)[0]
    nombre = re.sub(r"^(comprar|venta)\s+|\s+(online|al mejor precio)$", "", nombre, flags=re.I)
    return ean, round(precio, 2), nombre[:90]


def cargar(ruta, defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return defecto


def guardar(ruta, obj):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def recorrer_tienda(tienda, fin, max_paginas, arranque, informe):
    tid = tienda["id"]
    estado = cargar(ESTADO / f"{tid}.json", {"urls": [], "pos": 0, "mapa": None})
    estado.setdefault("sin", {})
    datos = cargar(DATOS / f"{tid}.json", {})

    # robots.txt se lee con nuestro identificador: con el de Python, algún cortafuegos
    # devuelve una página de bloqueo que se tomaría por un robots.txt vacío
    robots = urllib.robotparser.RobotFileParser(tienda["base"] + "/robots.txt")
    try:
        texto = descargar(tienda["base"] + "/robots.txt")
    except (urllib.error.URLError, TimeoutError, ValueError):
        texto = ""
    if not re.search(r"^\s*user-agent\s*:", texto, re.I | re.M):
        informe[tid] = "robots.txt no legible: tienda saltada en esta ejecución"
        return
    robots.parse(texto.splitlines())
    pausa = max(PAUSA_MINIMA, tienda["pausa"], float(robots.crawl_delay(USER_AGENT) or 0))

    caducado = not estado["mapa"] or date.fromisoformat(estado["mapa"]) < date.today() - timedelta(days=DIAS_MAPA)
    if caducado or not estado["urls"]:
        urls = []
        for mapa in robots.site_maps() or [tienda["base"] + "/sitemap.xml"]:
            try:
                xml = descargar(mapa)
                hijos = urls_del_mapa(xml)
                if "<sitemapindex" in xml:
                    for hijo in hijos:
                        urls += urls_del_mapa(descargar(hijo))
                        time.sleep(pausa)
                else:
                    urls += hijos
            except (urllib.error.URLError, TimeoutError, ValueError):
                continue
        urls = sorted({u for u in urls if re.search(tienda["producto"], u)})
        if urls:
            estado.update(urls=urls, pos=estado["pos"] % len(urls), mapa=date.today().isoformat())

    # Cuota para dar una vuelta completa por semana; en el arranque solo manda el tiempo
    total = len(estado["urls"])
    cuota = max_paginas if arranque else min(max_paginas, -(-total // EJECUCIONES_SEMANA) + 20)

    leidas = vistas = nuevas = errores = 0
    hoy = date.today().isoformat()
    limite_sin = (date.today() - timedelta(days=DIAS_SIN_PRODUCTO)).isoformat()
    while total and time.time() < fin and leidas < cuota and vistas < total:
        url = estado["urls"][estado["pos"] % total]
        estado["pos"] = (estado["pos"] + 1) % total
        vistas += 1
        if estado["sin"].get(url, "") > limite_sin or not robots.can_fetch(USER_AGENT, url):
            continue
        try:
            producto = leer_producto(descargar(url))
            errores = 0
        except urllib.error.HTTPError as e:
            producto = None
            if e.code in (429, 503):
                errores += 1
                pausa *= 2          # la tienda pide calma: bajamos el ritmo
                if errores >= 3:
                    break
        except (urllib.error.URLError, TimeoutError, ValueError):
            producto = None
        leidas += 1
        if producto:
            ean, precio, nombre = producto
            nuevas += ean not in datos
            datos[ean] = [precio, nombre, hoy]
            estado["sin"].pop(url, None)
        else:
            estado["sin"][url] = hoy
        if leidas % GUARDAR_CADA == 0:
            guardar(ESTADO / f"{tid}.json", estado)
            guardar(DATOS / f"{tid}.json", datos)
        time.sleep(pausa)

    guardar(ESTADO / f"{tid}.json", estado)
    guardar(DATOS / f"{tid}.json", datos)
    informe[tid] = (f"{leidas} páginas leídas (cuota {cuota if cuota < 10**8 else 'sin límite'}), "
                    f"{len(datos)} productos ({nuevas} nuevos), pausa {pausa:.0f} s")


def unir_indice():
    """Junta las tiendas en un índice repartido en 100 ficheros por los dos últimos dígitos del EAN."""
    limite = (date.today() - timedelta(days=DIAS_VALIDEZ)).isoformat()
    indice = {}
    for tienda in TIENDAS:
        for ean, (precio, nombre, fecha) in cargar(DATOS / f"{tienda['id']}.json", {}).items():
            if fecha < limite:
                continue
            actual = indice.get(ean)
            if not actual:
                indice[ean] = {"n": nombre, "p": precio, "t": 1, "f": fecha}
            else:
                actual["t"] += 1
                if precio < actual["p"]:
                    actual.update(p=precio, f=fecha)
                if not actual["n"]:
                    actual["n"] = nombre

    trozos = {f"{i:02d}": {} for i in range(100)}
    for ean, registro in indice.items():
        trozos[ean[-2:]][ean] = registro
    for clave, contenido in trozos.items():
        guardar(SALIDA / f"{clave}.json", contenido)
    guardar(SALIDA / "info.json", {"actualizado": datetime.now().isoformat(timespec="minutes"),
                                   "productos": len(indice), "tiendas": len(TIENDAS)})
    return len(indice)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--minutos", type=float, default=300, help="tiempo máximo de la ejecución")
    parser.add_argument("--max-paginas", type=int, default=10**9, help="páginas máximas por tienda (pruebas)")
    parser.add_argument("--arranque", action="store_true", help="primer llenado del índice, sin cuota semanal")
    args = parser.parse_args()

    fin = time.time() + args.minutos * 60
    informe = {}
    hilos = [threading.Thread(target=recorrer_tienda, args=(t, fin, args.max_paginas, args.arranque, informe))
             for t in TIENDAS]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()

    for tid, linea in sorted(informe.items()):
        print(f"{tid}: {linea}")
    print(f"Índice: {unir_indice()} productos")


if __name__ == "__main__":
    main()
