const $ = (s, r = document) => r.querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const money = (n, cur) => new Intl.NumberFormat('es-DO', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n);
const CAT = { servicio: 'Servicio', paquete: 'Paquete', licencia: 'Licencia' };
const FORMAT = { largometraje: 'Largometraje', cortometraje: 'Cortometraje', serie: 'Serie', comercial: 'Comercial', trailer_libro: 'Booktrailer', documental: 'Documental', videoclip: 'Videoclip' };

async function loadOfferings() {
  const box = $('[data-offerings]');
  try {
    const { rows } = await (await fetch('/api/public/offerings')).json();
    box.innerHTML = rows.length ? rows.map((o) => `<article class="card">
      <span class="tag">${esc(CAT[o.category] || o.category)}</span>
      <h3>${esc(o.name)}</h3><p>${esc(o.description || '')}</p>
      ${o.price_from ? `<div class="price">desde <b>${esc(money(o.price_from, o.currency))}</b> <span>${esc(o.unit || '')}</span></div>` : ''}
    </article>`).join('') : '<p class="muted">Escríbenos para conocer nuestros servicios.</p>';
  } catch {
    box.innerHTML = '<p class="muted">No se pudo cargar el catálogo. Escríbenos y te lo enviamos.</p>';
  }
}

async function loadShowcase() {
  const box = $('[data-showcase]');
  try {
    const { rows } = await (await fetch('/api/public/showcase')).json();
    box.innerHTML = rows.length
      ? rows.map((p) => `<div class="show"><span>${esc(FORMAT[p.format] || p.format)}</span><b>${esc(p.title)}</b><p>${esc(p.logline || '')}</p></div>`).join('')
      : `<div class="show"><span>Booktrailer</span><b>De la portada a la pantalla</b><p>60–90 segundos que cuentan el alma de tu libro, listos para redes y para tu página de LibroSeller.</p></div>
         <div class="show"><span>Adaptación</span><b>Opción de derechos</b><p>Evaluamos tu novela para corto, serie o largometraje y te proponemos un plan de desarrollo.</p></div>`;
  } catch { box.innerHTML = ''; }
}

function leadForm() {
  const form = $('[data-lead]');
  const msg = $('[data-msg]');
  const params = new URLSearchParams(location.search);
  document.querySelectorAll('[data-preset]').forEach((a) => a.addEventListener('click', () => {
    form.service.value = a.dataset.preset; form.source_type.value = 'novela';
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    form.querySelectorAll('.invalid').forEach((x) => x.classList.remove('invalid'));
    if (!form.checkValidity()) {
      [...form.elements].filter((x) => !x.validity.valid).forEach((x) => x.closest('label')?.classList.add('invalid'));
      msg.className = 'form-msg bad';
      msg.textContent = 'Revisa los campos marcados: nombre, email válido, descripción (mín. 20 caracteres) y el consentimiento.';
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    data.privacy = form.privacy.checked;
    data.utm_source = params.get('utm_source') || params.get('ref') || '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    msg.className = 'form-msg'; msg.textContent = 'Enviando…';
    try {
      const res = await fetch('/api/public/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        for (const k of Object.keys(out.details || {})) form.elements[k]?.closest('label')?.classList.add('invalid');
        throw new Error(out.details ? Object.values(out.details).join(' · ') : out.error || 'No se pudo enviar');
      }
      form.reset();
      msg.className = 'form-msg ok';
      msg.textContent = `¡Gracias! Recibimos tu solicitud${out.reference ? ` (${out.reference})` : ''}. Te escribiremos pronto.`;
    } catch (err) {
      msg.className = 'form-msg bad';
      msg.textContent = err.message;
    } finally { btn.disabled = false; }
  });
}

loadOfferings();
loadShowcase();
leadForm();
