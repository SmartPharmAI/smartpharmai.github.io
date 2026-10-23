// Escáner de código de barras del comparador de precios
//
// Lee el código con la cámara (BarcodeDetector del navegador o, si no existe, ZXing),
// descarta medicamentos con el registro público de la AEMPS (CIMA) y busca el precio
// en el índice estático comparador/precios/, que genera scraper/indexar.py.
// Solo sale del móvil el código de barras; el PVP se queda en el navegador.

(function () {
  var ZXING_SRC = "../assets/vendor/zxing/zxing-library-0.21.3.min.js";
  var CIMA = "https://cima.aemps.es/cima/rest/medicamento?cn=";

  var $ = function (sel) { return document.querySelector(sel); };
  var startBtn = $(".js-sc-start");
  var stopBtn = $(".js-sc-stop");
  var cameraBox = $(".sc__camera");
  var video = $(".sc__video");
  var cameraMsg = $(".js-sc-camera-msg");
  var form = $(".js-sc-form");
  var eanInput = $("#sc-ean");
  var pvpInput = $("#sc-pvp");
  var resultBox = $(".js-sc-result");
  var listBox = $(".js-sc-list");
  var infoBox = $(".js-sc-info");
  if (!startBtn || !form) return;

  var eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
  var shards = {};
  var history = [];
  var stream = null;
  var zxingReader = null;
  var scanning = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // EAN-8 y UPC-A se rellenan con ceros a 13 cifras, como en el índice
  function normalizeEan(raw) {
    var d = String(raw || "").replace(/\D/g, "");
    if (d.length === 8 || d.length === 12) d = ("0000000000000" + d).slice(-13);
    if (d.length === 14 && d[0] === "0") d = d.slice(1);
    return d;
  }

  function eanValid(ean) {
    if (!/^\d{13}$/.test(ean)) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += Number(ean[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(ean[12]);
  }

  function parsePrice(v) {
    var n = parseFloat(String(v || "").replace(/[€\s]/g, "").replace(",", "."));
    return n > 0 ? n : null;
  }

  function formatDate(iso) {
    var p = String(iso || "").split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : "";
  }

  // Los códigos 847000 son de productos con código nacional: medicamento o parafarmacia
  function checkMedicine(ean) {
    if (ean.indexOf("847000") !== 0) return Promise.resolve(false);
    return fetch(CIMA + ean.slice(6, 12))
      .then(function (r) { return r.status === 200; })
      .catch(function () { return false; });
  }

  function loadShard(ean) {
    var key = ean.slice(-2);
    if (!shards[key]) {
      shards[key] = fetch("precios/" + key + ".json", { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      });
    }
    return shards[key];
  }

  function message(kind, html) {
    resultBox.innerHTML = '<div class="alert alert--' + kind + '" style="margin-top:16px">' + html + "</div>";
  }

  function lookup(raw) {
    var ean = normalizeEan(raw);
    if (!eanValid(ean)) {
      message("error", "Este código no parece un código de barras válido. Revisa las cifras o vuelve a escanearlo.");
      return;
    }
    var pvp = parsePrice(pvpInput.value);
    resultBox.innerHTML = '<p class="small" style="margin-top:16px">Buscando ' + ean + "…</p>";

    checkMedicine(ean).then(function (isMedicine) {
      if (isMedicine) {
        message("warn", "<b>Es un medicamento.</b> No comparamos precios de medicamentos, solo de parafarmacia.");
        return;
      }
      return loadShard(ean).then(function (shard) {
        var rec = shard[ean];
        if (!rec) {
          message("warn", "No hemos encontrado este producto (" + ean + ") en las tiendas online que consultamos. Prueba con otro.");
          addHistory({ ean: ean, found: false });
          return;
        }
        renderResult(ean, rec, pvp);
        addHistory({ ean: ean, found: true, name: rec.n, online: rec.p, pvp: pvp });
      });
    }).catch(function () {
      message("error", "Ahora mismo no podemos consultar el índice de precios. Inténtalo en unos minutos.");
    });
  }

  function renderResult(ean, rec, pvp) {
    var verdict = "";
    if (pvp) {
      var diff = (pvp - rec.p) / pvp;
      if (diff > 0.005) {
        verdict = '<p class="result-hero__big">Online está un ' + Math.round(diff * 100) + "&nbsp;% más barato que tu PVP.</p>" +
          "<p>Tu PVP " + eur.format(pvp) + " · online desde " + eur.format(rec.p) + ".</p>";
      } else {
        verdict = '<p class="result-hero__big">Tu precio es igual o mejor que el más barato online.</p>' +
          "<p>Tu PVP " + eur.format(pvp) + " · online desde " + eur.format(rec.p) + ".</p>";
      }
    } else {
      verdict = '<p class="result-hero__big">Online desde ' + eur.format(rec.p) + "</p>" +
        "<p>Escribe tu PVP arriba para ver la diferencia.</p>";
    }
    resultBox.innerHTML = '<div class="result-hero" style="margin-top:16px">' +
      '<p class="small" style="margin:0 0 6px">' + escapeHtml(rec.n || "Producto") + " · " + ean + "</p>" + verdict +
      '<p class="small" style="margin-top:8px">' + (rec.t === 1
        ? "Precio encontrado en 1 tienda online"
        : "Precio más bajo entre " + rec.t + " tiendas online") +
      ", visto el " + formatDate(rec.f) + ". Orientativo.</p></div>" +
      '<div class="rx-cta" style="margin-top:12px"><h3>Sola, difícilmente compites con eso</h3>' +
      "<p>Comprando mejor y junto a otras farmacias, sí. En el piloto gratuito lo vemos con todo tu stock.</p>" +
      '<div class="btn-row"><a class="btn btn--cta" href="../index.html#alta">Quiero una plaza en el piloto</a></div></div>';
  }

  function addHistory(item) {
    history.unshift(item);
    var found = history.filter(function (h) { return h.found; });
    var withPvp = found.filter(function (h) { return h.pvp; });
    var cheaper = withPvp.filter(function (h) { return h.online < h.pvp; });
    if (history.length < 2) { listBox.innerHTML = ""; return; }
    var html = '<h3 style="margin-top:24px">Tus productos escaneados</h3>';
    if (withPvp.length) {
      html += "<p><b>En " + cheaper.length + " de " + withPvp.length + "</b> productos con tu PVP, online está más barato.</p>";
    }
    html += '<div class="table-wrap"><table class="table-cards"><thead><tr><th>Producto</th><th class="num">Tu PVP</th><th class="num">Online desde</th><th class="num">Diferencia</th></tr></thead><tbody>';
    history.forEach(function (h) {
      var diff = h.found && h.pvp ? Math.round((h.pvp - h.online) / h.pvp * 100) : null;
      html += "<tr><td>" + (h.found ? escapeHtml(h.name || h.ean) : h.ean + " (no encontrado)") + "</td>" +
        '<td class="num" data-label="Tu PVP">' + (h.pvp ? eur.format(h.pvp) : "—") + "</td>" +
        '<td class="num" data-label="Online desde">' + (h.found ? eur.format(h.online) : "—") + "</td>" +
        '<td class="num" data-label="Diferencia">' + (diff === null ? "—" : diff > 0
          ? '<span class="diff-up">−' + diff + "&nbsp;%</span>" : '<span class="diff-ok">Tu precio, mejor</span>') + "</td></tr>";
    });
    listBox.innerHTML = html + "</tbody></table></div>";
  }

  // --- Cámara ---

  function onCode(code) {
    stopCamera();
    eanInput.value = normalizeEan(code);
    if (navigator.vibrate) navigator.vibrate(80);
    lookup(code);
    pvpInput.focus();
  }

  function stopCamera() {
    scanning = false;
    if (zxingReader) { zxingReader.reset(); zxingReader = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    video.srcObject = null;
    cameraBox.hidden = true;
    stopBtn.hidden = true;
    startBtn.hidden = false;
  }

  function cameraError(err) {
    stopCamera();
    var name = err && err.name;
    cameraMsg.textContent = name === "NotAllowedError"
      ? "No tenemos permiso para usar la cámara. Puedes escribir el código a mano."
      : name === "NotFoundError"
        ? "No encontramos ninguna cámara. Escribe el código a mano."
        : "No hemos podido abrir la cámara. Escribe el código a mano.";
  }

  function scanWithDetector() {
    var detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(function (s) {
      stream = s;
      video.srcObject = s;
      return video.play();
    }).then(function () {
      scanning = true;
      (function tick() {
        if (!scanning) return;
        detector.detect(video).then(function (codes) {
          if (codes.length) onCode(codes[0].rawValue);
          else setTimeout(tick, 200);
        }).catch(function () { setTimeout(tick, 400); });
      })();
    }).catch(cameraError);
  }

  function loadZxing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = ZXING_SRC;
      s.onload = function () { resolve(window.ZXing); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function scanWithZxing() {
    loadZxing().then(function (ZX) {
      var hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A]);
      zxingReader = new ZX.BrowserMultiFormatReader(hints);
      scanning = true;
      return zxingReader.decodeFromConstraints({ video: { facingMode: "environment" } }, video, function (result) {
        if (result && scanning) onCode(result.getText());
      });
    }).catch(cameraError);
  }

  startBtn.addEventListener("click", function () {
    cameraMsg.textContent = "Apunta al código de barras. Se lee solo.";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cameraMsg.textContent = "Este navegador no permite usar la cámara aquí. Escribe el código a mano.";
      return;
    }
    cameraBox.hidden = false;
    startBtn.hidden = true;
    stopBtn.hidden = false;
    var detectorOk = "BarcodeDetector" in window && window.BarcodeDetector.getSupportedFormats
      ? window.BarcodeDetector.getSupportedFormats().then(function (f) { return f.indexOf("ean_13") !== -1; })
      : Promise.resolve(false);
    detectorOk.then(function (ok) { ok ? scanWithDetector() : scanWithZxing(); });
  });

  stopBtn.addEventListener("click", function () { stopCamera(); cameraMsg.textContent = ""; });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    lookup(eanInput.value);
  });

  // Tamaño del índice, para que se sepa cuánto cubre
  fetch("precios/info.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (info) {
    infoBox.textContent = "Nuestro índice tiene " + info.productos.toLocaleString("es-ES") +
      " productos de " + info.tiendas + " tiendas online, actualizado el " +
      formatDate(String(info.actualizado).slice(0, 10)) + ".";
  }).catch(function () {});

  // Pruebas automáticas desde la consola o Playwright
  window.SPEscaner = { normalizeEan: normalizeEan, eanValid: eanValid, lookup: lookup };
})();
