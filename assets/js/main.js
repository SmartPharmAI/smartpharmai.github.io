// SmartPharma — comportamiento común de la web

(function () {
  // Número de WhatsApp: pendiente. Formato internacional sin "+", por ejemplo "34600111222".
  var WHATSAPP_NUMBER = "";
  var WHATSAPP_TEXT = "Hola, tengo una duda sobre el piloto de SmartPharma.";

  // Menú móvil
  var toggle = document.querySelector(".menu-toggle");
  var mobileNav = document.getElementById("mobile-nav");
  if (toggle && mobileNav) {
    toggle.addEventListener("click", function () {
      var open = mobileNav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "Cerrar" : "Menú";
    });
    mobileNav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        mobileNav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Menú";
      }
    });
  }

  // Enlaces de WhatsApp: hasta tener número, avisan en lugar de abrir un chat
  document.querySelectorAll(".js-whatsapp").forEach(function (link) {
    if (WHATSAPP_NUMBER) {
      link.href = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent(WHATSAPP_TEXT);
      link.target = "_blank";
      link.rel = "noopener";
    } else {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        alert("Vista previa: el número de WhatsApp está pendiente.");
      });
    }
  });

  // Tipo de solicitud: quien va a comprar no tiene aún farmacia propia
  var tipo = document.getElementById("f-tipo");
  var farmaciaLabel = document.querySelector('label[for="f-farmacia"]');
  function syncTipo() {
    if (!tipo || !farmaciaLabel) return;
    farmaciaLabel.textContent = tipo.value === "compra" ? "Farmacia que vas a comprar (o su municipio)" : "Nombre de la farmacia";
  }
  if (tipo) tipo.addEventListener("change", syncTipo);

  // Enlaces "Pide presupuesto": llevan al formulario con el tipo ya elegido
  document.querySelectorAll(".js-tipo").forEach(function (link) {
    link.addEventListener("click", function () {
      if (tipo) { tipo.value = link.dataset.tipo; syncTipo(); }
    });
  });

  // Tarjetas deslizantes por tipo de farmacia
  document.querySelectorAll(".js-slider").forEach(function (slider) {
    var track = slider.querySelector(".slider__track");
    var slides = slider.querySelectorAll(".slider__slide");
    var chips = slider.querySelectorAll(".slider__chip");
    var prev = slider.querySelector(".js-prev");
    var next = slider.querySelector(".js-next");
    var count = slider.querySelector(".js-count");
    var current = 0;

    function goTo(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      track.scrollTo({ left: slides[i].offsetLeft - track.offsetLeft, behavior: "smooth" });
    }

    function sync(i) {
      current = i;
      chips.forEach(function (c, n) { c.setAttribute("aria-selected", n === i ? "true" : "false"); });
      prev.disabled = i === 0;
      next.disabled = i === slides.length - 1;
      count.textContent = (i + 1) + " de " + slides.length;
    }

    // La tarjeta visible se calcula al deslizar, también con el dedo
    var raf;
    track.addEventListener("scroll", function () {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        var i = Math.round(track.scrollLeft / track.clientWidth);
        if (i !== current) sync(i);
      });
    });

    chips.forEach(function (c) {
      c.addEventListener("click", function () { goTo(Number(c.dataset.slide)); });
    });
    prev.addEventListener("click", function () { goTo(current - 1); });
    next.addEventListener("click", function () { goTo(current + 1); });
    track.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(current + 1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); goTo(current - 1); }
    });

    sync(0);
  });

  // Formularios de captación: llegan por correo a través de FormSubmit
  var FORM_ENDPOINT = "https://formsubmit.co/ajax/m.leo.acedo@gmail.com";
  var FORM_FALLBACK = "m.leo.acedo@gmail.com";

  function sendLead(form) {
    var data = {};
    form.querySelectorAll("input, select, textarea").forEach(function (f) {
      if (!f.name) return;
      if (f.type === "checkbox") data[f.name] = f.checked ? "sí" : "no";
      else data[f.name] = f.value.trim();
    });
    data._subject = "SmartPharma: nueva solicitud de plaza en el piloto";
    data._template = "table";
    data._captcha = "false";
    data._honey = "";
    return fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(data)
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (res) {
        if (String(res.success) !== "true") throw new Error(res.message || "envío rechazado");
      });
  }

  document.querySelectorAll(".js-lead-form").forEach(function (form) {
    var errorBox = form.querySelector(".js-form-error");
    var success = form.parentElement.querySelector(".js-form-success");
    var submitBtn = form.querySelector('[type="submit"]');

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var missing = [];
      form.querySelectorAll("[required]").forEach(function (field) {
        var empty = field.type === "checkbox" ? !field.checked : !field.value.trim();
        field.setAttribute("aria-invalid", empty ? "true" : "false");
        if (empty) missing.push(field);
      });

      if (missing.length) {
        errorBox.textContent = missing.some(function (f) { return f.type === "checkbox"; })
          ? "Rellena los campos y acepta la política de privacidad para continuar."
          : "Rellena todos los campos para continuar.";
        errorBox.hidden = false;
        missing[0].focus();
        return;
      }

      errorBox.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Enviando…";
      sendLead(form).then(function () {
        form.hidden = true;
        if (success) {
          success.classList.add("is-visible");
          success.setAttribute("tabindex", "-1");
          success.focus();
        }
      }).catch(function () {
        errorBox.innerHTML = "No hemos podido enviar la solicitud. Escríbenos a " +
          '<a href="mailto:' + FORM_FALLBACK + '">' + FORM_FALLBACK + "</a> y te llamamos.";
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Quiero una plaza en el piloto";
      });
    });
  });
})();
