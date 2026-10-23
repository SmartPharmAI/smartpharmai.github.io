// Comparador de precios de parafarmacia (a partir del albarán)
//
// Todo se calcula en el navegador. Vista previa:
// - CSV: se lee de verdad (columnas, medicamentos, datos personales, categorías).
// - Foto y PDF: lectura simulada con el albarán de ejemplo.
// - Precios online: inventados en el ejemplo; para ficheros reales, pendientes del servicio de precios.

(function () {
  // Albarán de ejemplo. Productos genéricos, códigos y precios inventados.
  var DEMO_ALBARAN = [
    { cn: "900001", descripcion: "Protector solar facial SPF50+ 50 ml", unidades: 6, coste: 11.20, pvp: 19.95, online: 15.49 },
    { cn: "900002", descripcion: "Protector solar corporal spray SPF30 200 ml", unidades: 6, coste: 9.80, pvp: 17.50, online: 13.90 },
    { cn: "900003", descripcion: "Champú anticaída 200 ml", unidades: 4, coste: 8.90, pvp: 15.90, online: 13.20 },
    { cn: "900004", descripcion: "Crema hidratante facial 50 ml", unidades: 3, coste: 12.40, pvp: 22.90, online: 18.99 },
    { cn: "900005", descripcion: "Sérum vitamina C 30 ml", unidades: 2, coste: 17.60, pvp: 32.00, online: 24.50 },
    { cn: "900006", descripcion: "Crema de manos reparadora 75 ml", unidades: 8, coste: 3.10, pvp: 6.50, online: 6.95 },
    { cn: "900007", descripcion: "Leche infantil de continuación 800 g", unidades: 12, coste: 14.30, pvp: 21.90, online: 19.80 },
    { cn: "900008", descripcion: "Crema pañal infantil 100 ml", unidades: 6, coste: 4.20, pvp: 8.40, online: 8.90 },
    { cn: "900009", descripcion: "Colutorio sin alcohol 500 ml", unidades: 6, coste: 3.90, pvp: 7.95, online: 5.99 },
    { cn: "900010", descripcion: "Cepillo dental suave", unidades: 12, coste: 1.60, pvp: 3.90, online: 3.95 },
    { cn: "900011", descripcion: "Complemento magnesio 60 comprimidos", unidades: 4, coste: 6.10, pvp: 12.90, online: 5.95 },
    { cn: "900012", descripcion: "Ibuprofeno 600 mg 40 comprimidos", unidades: 10, coste: 1.90, pvp: 2.97, online: null },
    { cn: "900013", descripcion: "Paracetamol 1 g 40 comprimidos", unidades: 10, coste: 1.20, pvp: 1.97, online: null }
  ];

  // Palabras que identifican medicamentos. En la versión final se comprobará cada código en CIMA (AEMPS).
  var MED_WORDS = ["mg", "comprimidos", "comp.", "cápsulas", "capsulas", "sobres", "jarabe", "efg", "inyectable",
    "colirio", "supositorios", "suspensión oral", "solución oral", "granulado", "parches transdérmicos"];
  // Excepciones: parafarmacia aunque contenga alguna de las palabras anteriores
  var PARA_OVERRIDE = ["complemento", "suplemento", "vitamina", "colágeno", "colageno", "probiótico", "probiotico", "magnesio"];

  var CATEGORIES = [
    { name: "Solares", words: ["solar", "spf", "fotoprotector", "after sun", "aftersun"] },
    { name: "Capilar", words: ["champú", "champu", "capilar", "cabello", "anticaída", "anticaida", "acondicionador"] },
    { name: "Infantil", words: ["infantil", "bebé", "bebe", "pañal", "panal", "biberón", "biberon", "continuación", "continuacion"] },
    { name: "Higiene bucal", words: ["dental", "colutorio", "dentífrico", "dentifrico", "cepillo", "encías", "encias"] },
    // Antes que nutrición, para que un "sérum de vitamina C" cuente como dermocosmética
    { name: "Dermocosmética", words: ["crema", "sérum", "serum", "facial", "hidratante", "contorno", "loción", "locion", "gel"] },
    { name: "Nutrición y complementos", words: ["complemento", "suplemento", "vitamina", "magnesio", "colágeno", "colageno", "probiótico", "probiotico"] }
  ];

  // Cabeceras aceptadas para cada columna
  var COLUMN_ALIASES = {
    cn: ["cn", "codigo", "código", "codigo nacional", "código nacional", "ean", "cod", "cod.", "referencia", "ref"],
    descripcion: ["descripcion", "descripción", "articulo", "artículo", "producto", "nombre", "denominacion", "denominación"],
    unidades: ["unidades", "uds", "uds.", "cantidad", "cant", "cant.", "unid"],
    coste: ["coste", "pvl", "precio coste", "precio neto", "neto", "precio", "p. neto", "coste unitario", "pmc"],
    pvp: ["pvp", "p.v.p.", "precio venta", "precio de venta", "pvp iva"]
  };

  // Señales de datos personales que no deben estar en el fichero
  var PERSONAL_HEADERS = ["paciente", "cliente", "dni", "nif", "telefono", "teléfono", "email", "correo", "direccion", "dirección", "receta"];
  var DNI_RE = /\b\d{8}[A-HJ-NP-TV-Z]\b/i;
  var EMAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

  var $ = function (sel) { return document.querySelector(sel); };
  var steps = document.querySelectorAll(".rx-steps li");
  var errorBox = $(".js-rx-error");
  var noticeBox = $(".js-rx-notice");
  var resultBox = $(".js-rx-result");

  function showStep(n) {
    [1, 2, 3].forEach(function (i) { $("#rx-step-" + i).hidden = i !== n; });
    steps.forEach(function (li) {
      var s = Number(li.dataset.step);
      li.classList.toggle("is-active", s === n);
      li.classList.toggle("is-done", s < n);
    });
    window.scrollTo({ top: $("#rx-step-1").closest(".rx").offsetTop - 90, behavior: "smooth" });
  }

  function showError(message) {
    errorBox.innerHTML = "";
    if (!message) return;
    var div = document.createElement("div");
    div.className = "alert alert--error";
    div.textContent = message;
    errorBox.appendChild(div);
  }

  function setNotice(message) {
    noticeBox.innerHTML = "";
    if (!message) return;
    var div = document.createElement("div");
    div.className = "alert alert--warn";
    div.textContent = message;
    noticeBox.appendChild(div);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  function money(n) { return eur.format(n); }

  function normalize(s) { return String(s || "").trim().toLowerCase(); }

  function isMedicine(desc) {
    var d = " " + normalize(desc) + " ";
    if (PARA_OVERRIDE.some(function (w) { return d.indexOf(w) !== -1; })) return false;
    return MED_WORDS.some(function (w) {
      return w === "mg" ? /\d\s*mg\b/.test(d) : d.indexOf(w) !== -1;
    });
  }

  function categoryOf(desc) {
    var d = normalize(desc);
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].words.some(function (w) { return d.indexOf(w) !== -1; })) return CATEGORIES[i].name;
    }
    return "Otros";
  }

  // Números con coma decimal, símbolo de euro o separador de miles
  function parseNumber(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).replace(/[€\s]/g, "");
    if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(",", ".");
    return parseFloat(s);
  }

  // CSV con separador ; o , y comillas
  function parseCsv(text) {
    var firstLine = text.split(/\r?\n/)[0] || "";
    var sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
    var rows = [], row = [], cell = "", quoted = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ""; }); });
  }

  function mapColumns(header) {
    var map = {};
    header.forEach(function (h, idx) {
      var n = normalize(h);
      Object.keys(COLUMN_ALIASES).forEach(function (key) {
        if (map[key] === undefined && COLUMN_ALIASES[key].indexOf(n) !== -1) map[key] = idx;
      });
    });
    return map;
  }

  function findPersonalData(header, rows) {
    var badHeader = header.find(function (h) {
      var n = normalize(h);
      return PERSONAL_HEADERS.some(function (w) { return n.indexOf(w) !== -1; });
    });
    if (badHeader) return 'la columna "' + badHeader + '"';
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (EMAIL_RE.test(rows[r][c])) return "una dirección de correo (fila " + (r + 2) + ")";
        if (DNI_RE.test(rows[r][c])) return "un DNI o NIF (fila " + (r + 2) + ")";
      }
    }
    return null;
  }

  function linesFromCsv(text) {
    var rows = parseCsv(text);
    if (rows.length < 2) throw new Error("El fichero está vacío o solo tiene la cabecera.");
    var header = rows[0], body = rows.slice(1);

    var personal = findPersonalData(header, body);
    if (personal) {
      throw new Error("Parece que el fichero incluye datos personales: " + personal +
        ". Quítalos y vuelve a subirlo. Solo necesitamos datos de productos.");
    }

    var map = mapColumns(header);
    var missing = ["descripcion", "unidades", "coste"].filter(function (k) { return map[k] === undefined; });
    if (missing.length) {
      var names = { descripcion: "descripción", unidades: "unidades", coste: "coste o PVL" };
      throw new Error("No encontramos la columna de " + missing.map(function (k) { return names[k]; }).join(", ") +
        ". Revisa que la primera fila tenga los nombres de las columnas.");
    }

    var lines = [], skipped = 0;
    body.forEach(function (r) {
      var desc = (r[map.descripcion] || "").trim();
      var uds = parseNumber(r[map.unidades]);
      var coste = parseNumber(r[map.coste]);
      if (!desc || !(uds > 0) || !(coste >= 0)) { skipped++; return; }
      lines.push({
        // El código nacional se trata como texto para no perder los ceros iniciales
        cn: map.cn !== undefined ? String(r[map.cn]).trim() : "",
        descripcion: desc,
        unidades: uds,
        coste: coste,
        pvp: map.pvp !== undefined ? parseNumber(r[map.pvp]) : NaN,
        online: null
      });
    });
    if (!lines.length) throw new Error("No hemos podido leer ningún producto. Revisa que unidades y coste sean números.");
    return { lines: lines, skipped: skipped };
  }

  function analyze(lines) {
    var para = [], meds = [];
    lines.forEach(function (l) { (isMedicine(l.descripcion) ? meds : para).push(l); });
    para.forEach(function (l) { l.categoria = categoryOf(l.descripcion); l.valor = l.unidades * l.coste; });

    var withOnline = para.filter(function (l) { return l.online !== null && l.online !== undefined; });
    var belowPvp = withOnline.filter(function (l) { return l.pvp > 0 && l.online < l.pvp; });
    var belowCost = withOnline.filter(function (l) { return l.online < l.coste; });
    var avgDiff = belowPvp.length
      ? belowPvp.reduce(function (s, l) { return s + (l.pvp - l.online) / l.pvp; }, 0) / belowPvp.length
      : 0;

    var byCat = {};
    para.forEach(function (l) { byCat[l.categoria] = (byCat[l.categoria] || 0) + l.valor; });
    var cats = Object.keys(byCat).map(function (k) { return { name: k, value: byCat[k] }; })
      .sort(function (a, b) { return b.value - a.value; });

    return {
      para: para, meds: meds, withOnline: withOnline, belowPvp: belowPvp, belowCost: belowCost, avgDiff: avgDiff, cats: cats,
      total: para.reduce(function (s, l) { return s + l.valor; }, 0)
    };
  }

  function renderResult(a, opts) {
    var html = "";
    var hasPrices = a.withOnline.length > 0;

    if (opts.demo) {
      html += '<div class="alert alert--warn"><b>Albarán de ejemplo.</b> Productos genéricos y precios inventados para enseñarte cómo es el resultado.</div>';
    }

    if (hasPrices) {
      html += '<div class="result-hero">' +
        '<p class="result-hero__big">En ' + a.belowPvp.length + " de tus " + a.withOnline.length +
        " productos de parafarmacia, el precio online más bajo está por debajo de tu PVP.</p>" +
        (a.belowCost.length
          ? "<p>En " + a.belowCost.length + (a.belowCost.length === 1 ? " producto" : " productos") +
            ", incluso por debajo de lo que tú lo pagaste.</p>"
          : "<p>En ninguno está por debajo de lo que tú lo pagaste.</p>") +
        "</div>";
    } else {
      html += '<div class="result-hero">' +
        '<p class="result-hero__big">' + a.para.length + " productos de parafarmacia por valor de " + money(a.total) + ".</p>" +
        "<p>Hemos leído tu fichero. La comparación con precios online se activará en la versión final de la herramienta.</p>" +
        "</div>";
    }

    html += '<div class="kpis">' +
      kpi("Parafarmacia en el albarán", money(a.total)) +
      kpi("Productos comparados", String(a.para.length) + (a.meds.length ? " <span class='small'>(" + a.meds.length + " medicamentos descartados)</span>" : "")) +
      (hasPrices ? kpi("Diferencia media con tu PVP", "−" + Math.round(a.avgDiff * 100) + " %") : kpi("Precio online", "Pendiente")) +
      "</div>";

    if (opts.skipped) {
      html += '<div class="alert alert--warn">' + (opts.skipped === 1
        ? "1 fila sin descripción, unidades o coste se ha excluido."
        : opts.skipped + " filas sin descripción, unidades o coste se han excluido.") + "</div>";
    }

    // Reparto por categoría
    html += '<h3>Dónde está el dinero de este albarán</h3><div class="bars">';
    var max = a.cats.length ? a.cats[0].value : 1;
    a.cats.forEach(function (c) {
      html += '<div class="bar"><span>' + escapeHtml(c.name) + '</span>' +
        '<span class="bar__track"><span class="bar__fill" style="width:' + Math.max(4, c.value / max * 100) + '%"></span></span>' +
        '<span class="bar__value">' + money(c.value) + "</span></div>";
    });
    html += "</div>";

    // Tabla de productos, ordenada por diferencia con el PVP
    var rows = a.para.slice().sort(function (x, y) { return diffPct(y) - diffPct(x); });
    html += "<h3>Producto a producto</h3>" +
      '<div class="table-wrap"><table class="table-cards"><thead><tr>' +
      '<th>Producto</th><th class="num">Uds.</th><th class="num">Tu coste</th><th class="num">Tu PVP</th>' +
      (hasPrices ? '<th class="num">Online más bajo</th><th class="num">Frente a tu PVP</th>' : "") +
      "</tr></thead><tbody>";
    rows.forEach(function (l) {
      html += "<tr><td>" + escapeHtml(l.descripcion) + "</td>" +
        '<td class="num" data-label="Unidades">' + l.unidades + "</td>" +
        '<td class="num" data-label="Tu coste">' + money(l.coste) + "</td>" +
        '<td class="num" data-label="Tu PVP">' + (l.pvp > 0 ? money(l.pvp) : "—") + "</td>";
      if (hasPrices) {
        html += '<td class="num" data-label="Online más bajo">' + (l.online !== null ? money(l.online) : "—") + "</td>" +
          '<td class="num" data-label="Frente a tu PVP">' + diffLabel(l) + "</td>";
      }
      html += "</tr>";
    });
    html += "</tbody></table></div>";

    if (a.meds.length) {
      html += '<p class="small" style="margin-top:12px">Medicamentos descartados: ' +
        a.meds.map(function (m) { return escapeHtml(m.descripcion); }).join(" · ") + "</p>";
    }

    html += '<p class="small" style="margin-top:12px">' +
      (opts.demo
        ? "Precios inventados para el ejemplo."
        : "Los precios online son orientativos, se consultan en el momento y pueden no coincidir exactamente con tu producto.") +
      " Tu albarán no se ha guardado en ningún sitio.</p>";

    resultBox.innerHTML = html;
  }

  function kpi(label, value) {
    return '<div class="kpi"><div class="kpi__label">' + label + '</div><div class="kpi__value">' + value + "</div></div>";
  }

  function diffPct(l) {
    if (l.online === null || l.online === undefined || !(l.pvp > 0)) return -Infinity;
    return (l.pvp - l.online) / l.pvp;
  }

  function diffLabel(l) {
    if (l.online === null || l.online === undefined || !(l.pvp > 0)) return "—";
    if (l.online < l.coste) return '<span class="diff-up">−' + Math.round(diffPct(l) * 100) + " % · bajo tu coste</span>";
    if (l.online < l.pvp) return '<span class="diff-up">−' + Math.round(diffPct(l) * 100) + " %</span>";
    return '<span class="diff-ok">Tu precio, mejor</span>';
  }

  // Animación de los tres pasos de lectura
  function runProgress(done) {
    var tasks = document.querySelectorAll(".progress li");
    tasks.forEach(function (t) { t.classList.remove("is-running", "is-done"); });
    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var delay = reduced ? 150 : 900;
    var i = 0;
    (function next() {
      if (i > 0) { tasks[i - 1].classList.remove("is-running"); tasks[i - 1].classList.add("is-done"); }
      if (i === tasks.length) { setTimeout(done, reduced ? 0 : 300); return; }
      tasks[i].classList.add("is-running");
      i++;
      setTimeout(next, delay);
    })();
  }

  function runDemo(notice) {
    showError("");
    setNotice(notice || "");
    showStep(2);
    var lines = DEMO_ALBARAN.map(function (l) { return Object.assign({}, l); });
    runProgress(function () {
      renderResult(analyze(lines), { demo: true });
      showStep(3);
    });
  }

  function handleFile(file) {
    if (!file) return;
    showError("");
    var name = file.name.toLowerCase();

    if (/\.(xls|xlsx)$/.test(name)) {
      showError("En esta vista previa todavía no leemos Excel. Guárdalo como CSV desde Excel (Archivo → Guardar como → CSV).");
      return;
    }

    if (/\.(csv|txt)$/.test(name) || file.type === "text/csv") {
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try {
          parsed = linesFromCsv(String(reader.result));
        } catch (err) {
          showError(err.message);
          return;
        }
        setNotice("");
        showStep(2);
        runProgress(function () {
          renderResult(analyze(parsed.lines), { demo: false, skipped: parsed.skipped });
          showStep(3);
        });
      };
      reader.onerror = function () { showError("No hemos podido abrir el fichero. Prueba de nuevo."); };
      reader.readAsText(file, "utf-8");
      return;
    }

    showError("Este tipo de archivo no lo reconocemos. Usa un CSV, o escanea los productos uno a uno con la cámara.");
  }

  $("#rx-file").addEventListener("change", function (e) { handleFile(e.target.files[0]); e.target.value = ""; });
  $("#rx-demo").addEventListener("click", function () { runDemo(""); });
  $("#rx-restart").addEventListener("click", function () { showError(""); showStep(1); });

  var drop = $(".js-dropzone");
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-drag"); });
  });
  drop.addEventListener("drop", function (e) { handleFile(e.dataTransfer.files[0]); });
})();
