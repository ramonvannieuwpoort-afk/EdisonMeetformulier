/* =========================================================
   Edison Meetformulier – app
   Offline-first: data in localStorage + foto's in IndexedDB,
   synchroniseert met Google Sheet via Apps Script.
   ========================================================= */
'use strict';

/* ---------- hulpjes ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vandaag = () => new Date().toISOString().slice(0, 10);
const datumNL = d => { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}-${m}-${y}`; };
const kopie = o => JSON.parse(JSON.stringify(o));
function laad(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }

/* ---------- opslag ---------- */
const DB = {
  klanten: laad('emf_klanten', {}),
  inst: laad('emf_inst', null)
};
if (!DB.inst) {
  DB.inst = { waarden: { ...CONFIG.standaard }, aftrekPerType: kopie(CONFIG.aftrekPerType), url: '', sleutel: '', updated: 0, syncedAt: 0, laatstePull: 0 };
}
// nieuwe standaardsleutels uit config aanvullen
for (const [k, v] of Object.entries(CONFIG.standaard)) if (DB.inst.waarden[k] === undefined) DB.inst.waarden[k] = v;

function bewaarLokaal() {
  try {
    localStorage.setItem('emf_klanten', JSON.stringify(DB.klanten));
    localStorage.setItem('emf_inst', JSON.stringify(DB.inst));
  } catch (e) { melding('Opslaan op dit toestel mislukt: ' + e.message, true); }
}
function gewijzigd(k) { k.updated = Date.now(); bewaarLokaal(); planSync(); updateBadge(); }
function instGewijzigd() { DB.inst.updated = Date.now(); bewaarLokaal(); planSync(); updateBadge(); }

/* IndexedDB voor foto's */
const fotoDB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('emf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('fotos', mode); const req = fn(t.objectStore('fotos'));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  };
  return { put: o => tx('readwrite', s => s.put(o)), get: id => tx('readonly', s => s.get(id)), del: id => tx('readwrite', s => s.delete(id)) };
})();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- model ---------- */
const nieuweKlant = () => ({ id: uid(), naam: '', adres: '', pcplaats: '', datum: vandaag(), offertenr: '', telefoon: '', email: '', opmerking: '', ruimtes: [], updated: Date.now(), syncedAt: 0, verwijderd: false });
const nieuweRuimte = naam => ({ id: uid(), naam: naam || '', ramen: [] });
const nieuwRaam = nr => ({ id: uid(), nr: String(nr), omschrijving: '', ondergrond: '', kozijndiepte: '', obstakels: [], fotos: [], opmerking: '', producten: [] });
const nieuwProduct = () => ({ id: uid(), type: '', montage: 'in', bevestiging: '', B: ['', '', ''], H: ['', '', ''], par: {}, hand: { B: '', H: '', reden: '' }, kleur: '', collectie: '', opties: {}, opmerking: '' });

const typeDef = id => CONFIG.producten.find(p => p.id === id);

/* maat parsen: altijd naar hele mm */
function parseMaat(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().toLowerCase().replace(/\s/g, '');
  if (!t) return null;
  let f = 1, eenheid = false;
  if (t.endsWith('mm')) { t = t.slice(0, -2); eenheid = true; }
  else if (t.endsWith('cm')) { t = t.slice(0, -2); f = 10; eenheid = true; }
  else if (t.endsWith('m')) { t = t.slice(0, -1); f = 1000; eenheid = true; }
  t = t.replace(',', '.');
  let n = parseFloat(t);
  if (isNaN(n)) return null;
  // laser in meters zonder eenheid, bv "1.195" -> 1195 mm
  if (!eenheid && t.includes('.') && n < 20) f = 1000;
  return Math.round(n * f);
}
const metingen = arr => (arr || []).map(parseMaat).filter(n => n > 0);

function stdWaarde(type, key) {
  const apt = DB.inst.aftrekPerType[type];
  if (key === 'aftrekB' && apt && apt.B !== '' && apt.B != null) return Number(apt.B);
  if (key === 'aftrekH' && apt && apt.H !== '' && apt.H != null) return Number(apt.H);
  return Number(DB.inst.waarden[key]) || 0;
}
function eff(p, key) {
  const std = stdWaarde(p.type, key);
  const v = p.par[key];
  if (v === '' || v === null || v === undefined) return { v: std, afw: false, std };
  const n = Number(String(v).replace(',', '.'));
  if (isNaN(n)) return { v: std, afw: false, std };
  return { v: n, afw: n !== std, std };
}

/* Kernberekening: strakke maat -> bestelmaat */
function bereken(p) {
  const t = typeDef(p.type);
  if (!t) return null;
  const mB = metingen(p.B), mH = t.calc === 'lengte' ? [] : metingen(p.H);
  const sB = mB.length ? Math.min(...mB) : null;
  const sH = mH.length ? Math.min(...mH) : null;
  const r = { t, sB, sH, B: null, H: null, uitB: '', uitH: '', params: [], hand: { B: false, H: false }, waarsch: [], afwijkend: [] };

  if (t.calc === 'stof') {
    const ov = eff(p, 'overlap'), vl = eff(p, 'vloerafstand');
    r.params = [['overlap', 'Overlap', ov], ['vloerafstand', 'Vloerafstand', vl]];
    if (sB != null) { r.B = sB + ov.v; r.uitB = `${sB} + ${ov.v} overlap = ${r.B}`; }
    if (sH != null) { r.H = sH - vl.v; r.uitH = `${sH} − ${vl.v} vloerafstand = ${r.H}`; }
  } else if (p.montage === 'in') {
    const aB = eff(p, 'aftrekB'), aH = eff(p, 'aftrekH');
    r.params = [['aftrekB', t.calc === 'lengte' ? 'Aftrek lengte' : 'Aftrek breedte', aB]];
    if (t.calc !== 'lengte') r.params.push(['aftrekH', 'Aftrek hoogte', aH]);
    if (sB != null) { r.B = sB - aB.v; r.uitB = `${sB} − ${aB.v} aftrek = ${r.B}`; }
    if (sH != null) { r.H = sH - aH.v; r.uitH = `${sH} − ${aH.v} aftrek = ${r.H}`; }
  } else {
    const oB = eff(p, 'overmaatB'), oH = eff(p, 'overmaatH');
    r.params = [['overmaatB', t.calc === 'lengte' ? 'Overmaat lengte' : 'Overmaat breedte', oB]];
    if (t.calc !== 'lengte') r.params.push(['overmaatH', 'Overmaat hoogte', oH]);
    if (sB != null) { r.B = sB + oB.v; r.uitB = `${sB} + ${oB.v} overmaat = ${r.B}`; }
    if (sH != null) { r.H = sH + oH.v; r.uitH = `${sH} + ${oH.v} overmaat = ${r.H}`; }
  }
  r.params.forEach(([k, l, e]) => { if (e.afw) r.afwijkend.push(`${l} ${e.v} (std ${e.std})`); });

  // handmatige bestelmaat
  ['B', 'H'].forEach(k => {
    const hv = parseMaat(p.hand && p.hand[k]);
    if (hv > 0) { const oud = r[k]; r[k] = hv; r.hand[k] = true; r['uit' + k] = `HANDMATIG ${hv}` + (oud != null ? ` (berekend was ${oud})` : ''); }
  });
  if ((r.hand.B || r.hand.H) && !(p.hand.reden || '').trim()) r.waarsch.push('Reden voor handmatige bestelmaat ontbreekt.');

  // controles
  const dims = t.calc === 'lengte' ? [['Lengte', mB]] : [[t.calc === 'stof' ? 'Breedte' : 'Breedte', mB], ['Hoogte', mH]];
  dims.forEach(([naam, m]) => {
    m.forEach(v => { if (v < 200) r.waarsch.push(`${naam} ${v} mm is erg klein. Is dit in cm gemeten?`); if (v > 8000) r.waarsch.push(`${naam} ${v} mm is erg groot. Klopt dit?`); });
    if (m.length > 1 && Math.max(...m) - Math.min(...m) > 5) r.waarsch.push(`${naam}: metingen verschillen ${Math.max(...m) - Math.min(...m)} mm – scheef kozijn, controleren. Kleinste maat gebruikt.`);
  });
  if (t.calc === 'zon' && p.montage === 'in' && (mB.length === 1 || mH.length === 1)) r.info = '1 meting – 3-puntsmeting aanbevolen';
  return r;
}
const fmtMaat = r => {
  if (!r) return '—';
  if (r.t.calc === 'lengte') return r.B != null ? `${r.B}` : '—';
  return `${r.B ?? '—'} × ${r.H ?? '—'}`;
};
const fmtStrak = r => {
  if (!r) return '—';
  if (r.t.calc === 'lengte') return r.sB != null ? `${r.sB}` : '—';
  return `${r.sB ?? '—'} × ${r.sH ?? '—'}`;
};
const labelsMaat = t => t.calc === 'stof' ? ['Railbreedte', 'Hoogte (bovenkant rail → vloer)'] : t.calc === 'lengte' ? ['Lengte', null] : ['Breedte', 'Hoogte'];

function optieTekst(p) {
  const t = typeDef(p.type); if (!t) return '';
  return t.velden.map(v => p.opties[v]).filter(Boolean).join(' · ');
}

/* ---------- router ---------- */
let huidigeKlant = null;
window.addEventListener('hashchange', route);
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  if (h[0] === 'k' && DB.klanten[h[1]]) {
    huidigeKlant = DB.klanten[h[1]];
    if (h[2] === 'raam') return renderRaam(huidigeKlant, h[3]);
    if (h[2] === 'overzicht') return renderOverzicht(huidigeKlant);
    return renderKlant(huidigeKlant);
  }
  huidigeKlant = null;
  if (h[0] === 'instellingen') return renderInst();
  if (h[0] === 'leeg') return renderLeeg();
  return renderLijst();
}
const app = () => $('#app');

/* ---------- binding ---------- */
function getPad(o, pad) { return pad.split('.').reduce((a, k) => a == null ? a : a[k], o); }
function zetPad(o, pad, v) {
  const d = pad.split('.'); const last = d.pop();
  const doel = d.reduce((a, k) => a[k], o); doel[last] = v;
}
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.bind && huidigeKlant) {
    zetPad(huidigeKlant, el.dataset.bind, el.type === 'checkbox' ? el.checked : el.value);
    gewijzigd(huidigeKlant);
    if (el.dataset.live !== undefined) liveUpdate(el);
  } else if (el.dataset.ibind) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.num !== undefined && v !== '') v = Number(String(v).replace(',', '.'));
    zetPad(DB.inst, el.dataset.ibind, v);
    if (el.dataset.lokaal !== undefined) bewaarLokaal(); else instGewijzigd();
  }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.toggle && huidigeKlant) {
    const [pad, waarde] = el.dataset.toggle.split('|');
    const arr = getPad(huidigeKlant, pad);
    const i = arr.indexOf(waarde);
    if (el.checked && i < 0) arr.push(waarde); if (!el.checked && i >= 0) arr.splice(i, 1);
    gewijzigd(huidigeKlant);
  }
  if (el.dataset.rerender !== undefined) route();
  // maatvelden netjes naar hele mm
  if (el.dataset.meet !== undefined && el.value.trim()) {
    const n = parseMaat(el.value);
    if (n != null && String(n) !== el.value) { el.value = n; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
});
// Enter in een maatveld -> volgende maatveld (handig met laser in toetsenbordmodus)
document.addEventListener('keydown', e => {
  const el = e.target;
  if (e.key === 'Enter' && el.dataset.meet !== undefined) {
    e.preventDefault();
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const alle = $$('[data-meet]'); const i = alle.indexOf(el);
    if (alle[i + 1]) alle[i + 1].focus(); else el.blur();
  }
});

function liveUpdate(el) {
  const kaart = el.closest('[data-prod]'); if (!kaart) return;
  const [ri, wi, pi] = kaart.dataset.prod.split('.').map(Number);
  const p = huidigeKlant.ruimtes[ri].ramen[wi].producten[pi];
  $('.resultaat', kaart).innerHTML = resultaatHTML(p);
  $$('[data-par]', kaart).forEach(inp => inp.classList.toggle('afwijkend', eff(p, inp.dataset.par).afw));
}

/* ---------- UI: kop ---------- */
function kop(titel, terug) {
  return `<header class="kop no-print">
    ${terug ? `<a class="terug" href="${terug}" aria-label="Terug">‹</a>` : '<span class="terug-leeg"></span>'}
    <img src="logo.png" alt="Edison Interieur" class="kop-logo">
    <span class="kop-titel">${esc(titel)}</span>
    <button class="badge" id="badge" onclick="sync(true)"></button>
  </header>`;
}

/* ---------- Klantenlijst ---------- */
function renderLijst() {
  const lijst = Object.values(DB.klanten).filter(k => !k.verwijderd).sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || b.updated - a.updated);
  app().innerHTML = kop('Meetformulier') + `
  <main class="inhoud">
    <div class="acties">
      <button class="knop primair" onclick="maakKlant()">+ Nieuwe meting</button>
      <input type="search" placeholder="Zoek klant…" oninput="filterLijst(this.value)" class="zoek">
    </div>
    <ul class="lijst" id="klantlijst">
      ${lijst.map(k => {
        const n = k.ruimtes.reduce((a, r) => a + r.ramen.reduce((b, w) => b + w.producten.length, 0), 0);
        return `<li data-zoek="${esc((k.naam + ' ' + k.adres + ' ' + k.pcplaats + ' ' + k.offertenr).toLowerCase())}">
        <a href="#/k/${k.id}"><strong>${esc(k.naam || '(geen naam)')}</strong>
        <span>${esc(k.adres)} ${esc(k.pcplaats)}</span>
        <small>${datumNL(k.datum)}${k.offertenr ? ' · offerte ' + esc(k.offertenr) : ''} · ${k.ruimtes.length} ruimtes · ${n} producten ${k.updated > k.syncedAt ? '· <em class="niet-sync">niet gesynchroniseerd</em>' : ''}</small></a></li>`;
      }).join('') || '<li class="leeg">Nog geen metingen.</li>'}
    </ul>
    <div class="acties onder">
      <a class="knop" href="#/instellingen">Instellingen</a>
      <a class="knop" href="#/leeg">Lege printversie</a>
    </div>
  </main>`;
  updateBadge();
}
function filterLijst(q) { q = q.toLowerCase(); $$('#klantlijst li[data-zoek]').forEach(li => li.hidden = !li.dataset.zoek.includes(q)); }
function maakKlant() { const k = nieuweKlant(); DB.klanten[k.id] = k; gewijzigd(k); location.hash = '#/k/' + k.id; }

/* ---------- Klant ---------- */
const RUIMTE_SNEL = ['Woonkamer', 'Keuken', 'Eetkamer', 'Slaapkamer', 'Kinderkamer', 'Werkkamer', 'Badkamer', 'Hal', 'Overloop', 'Zolder', 'Serre'];
function renderKlant(k) {
  app().innerHTML = kop(k.naam || 'Nieuwe meting', '#/') + `
  <main class="inhoud">
    <details class="kaart" ${k.naam ? '' : 'open'}>
      <summary>Klantgegevens</summary>
      <div class="raster2">
        ${veld('Naam', 'naam', k.naam)}
        ${veld('Datum', 'datum', k.datum, 'date')}
        ${veld('Adres', 'adres', k.adres)}
        ${veld('Offertenummer', 'offertenr', k.offertenr, 'text', 'inputmode="numeric"')}
        ${veld('Postcode en woonplaats', 'pcplaats', k.pcplaats)}
        ${veld('Telefoon', 'telefoon', k.telefoon, 'tel')}
        ${veld('E-mail', 'email', k.email, 'email')}
      </div>
      <label class="veld"><span>Opmerking</span><textarea data-bind="opmerking" rows="2">${esc(k.opmerking)}</textarea></label>
    </details>

    ${k.ruimtes.map((ru, ri) => `
      <section class="kaart ruimte">
        <div class="ruimte-kop">
          <input class="ruimte-naam" data-bind="ruimtes.${ri}.naam" value="${esc(ru.naam)}" placeholder="Naam ruimte">
          <button class="mini" onclick="verplaatsRuimte(${ri},-1)" title="Omhoog">↑</button>
          <button class="mini" onclick="verplaatsRuimte(${ri},1)" title="Omlaag">↓</button>
          <button class="mini gevaar" onclick="verwijderRuimte(${ri})" title="Verwijder ruimte">✕</button>
        </div>
        <ul class="ramen">
          ${ru.ramen.map(w => `<li><a href="#/k/${k.id}/raam/${w.id}">
            <strong>Raam ${esc(w.nr)}</strong>${w.omschrijving ? ' – ' + esc(w.omschrijving) : ''}
            <span>${w.producten.map(p => { const r = bereken(p); return r ? `${esc(r.t.naam)} <b>${fmtMaat(r)}</b>` : '<em>product kiezen</em>'; }).join(' · ') || '<em>nog geen product</em>'}</span>
          </a></li>`).join('')}
        </ul>
        <button class="knop" onclick="maakRaam(${ri})">+ Raam</button>
      </section>`).join('')}

    <section class="kaart">
      <strong>Ruimte toevoegen</strong>
      <div class="chips">${RUIMTE_SNEL.map(n => `<button onclick="maakRuimte('${n}')">${n}</button>`).join('')}<button onclick="maakRuimte('')">Anders…</button></div>
    </section>

    <div class="acties onder">
      <a class="knop primair" href="#/k/${k.id}/overzicht">Overzicht &amp; print</a>
      <button class="knop" onclick="kopieerOfferte()">Kopieer voor offerte</button>
      <button class="knop gevaar" onclick="verwijderKlant()">Meting verwijderen</button>
    </div>
  </main>`;
  updateBadge();
}
function veld(label, pad, waarde, type = 'text', extra = '') {
  return `<label class="veld"><span>${label}</span><input type="${type}" data-bind="${pad}" value="${esc(waarde)}" ${extra}></label>`;
}
function maakRuimte(naam) {
  const k = huidigeKlant;
  if (naam) { const n = k.ruimtes.filter(r => r.naam.startsWith(naam)).length; if (n) naam += ' ' + (n + 1); }
  k.ruimtes.push(nieuweRuimte(naam)); gewijzigd(k); renderKlant(k);
  const inp = $$('.ruimte-naam').pop(); if (!naam && inp) inp.focus();
}
function verplaatsRuimte(i, d) { const r = huidigeKlant.ruimtes; const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; gewijzigd(huidigeKlant); renderKlant(huidigeKlant); }
function verwijderRuimte(i) { const ru = huidigeKlant.ruimtes[i]; if (!confirm(`Ruimte "${ru.naam}" met ${ru.ramen.length} ramen verwijderen?`)) return; huidigeKlant.ruimtes.splice(i, 1); gewijzigd(huidigeKlant); renderKlant(huidigeKlant); }
function maakRaam(ri) {
  const k = huidigeKlant; const ru = k.ruimtes[ri];
  const w = nieuwRaam(ru.ramen.length + 1); w.producten.push(nieuwProduct());
  ru.ramen.push(w); gewijzigd(k); location.hash = `#/k/${k.id}/raam/${w.id}`;
}
function verwijderKlant() { if (!confirm('Deze hele meting verwijderen?')) return; huidigeKlant.verwijderd = true; gewijzigd(huidigeKlant); location.hash = '#/'; }

/* ---------- Raam ---------- */
function zoekRaam(k, wid) {
  for (let ri = 0; ri < k.ruimtes.length; ri++) { const wi = k.ruimtes[ri].ramen.findIndex(w => w.id === wid); if (wi >= 0) return [ri, wi]; }
  return [-1, -1];
}
function renderRaam(k, wid) {
  const [ri, wi] = zoekRaam(k, wid);
  if (ri < 0) { location.hash = '#/k/' + k.id; return; }
  const ru = k.ruimtes[ri], w = ru.ramen[wi], pre = `ruimtes.${ri}.ramen.${wi}`;
  app().innerHTML = kop(`${ru.naam || 'Ruimte'} · Raam ${w.nr}`, '#/k/' + k.id) + `
  <main class="inhoud">
    <section class="kaart">
      <div class="raster2">
        <label class="veld"><span>Raamnummer</span><input data-bind="${pre}.nr" value="${esc(w.nr)}"></label>
        <label class="veld"><span>Omschrijving</span><input data-bind="${pre}.omschrijving" value="${esc(w.omschrijving)}" placeholder="bijv. links van de deur"></label>
        <label class="veld"><span>Ondergrond</span>${select(`${pre}.ondergrond`, CONFIG.ondergrond, w.ondergrond)}</label>
        <label class="veld"><span>Kozijndiepte (mm)</span><input data-bind="${pre}.kozijndiepte" value="${esc(w.kozijndiepte)}" inputmode="decimal"></label>
      </div>
      <div class="veld"><span>Let op</span><div class="chips vink">${CONFIG.obstakels.map(o => `<label><input type="checkbox" data-toggle="${pre}.obstakels|${esc(o)}" ${w.obstakels.includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></div>
      <label class="veld"><span>Opmerking raam</span><textarea data-bind="${pre}.opmerking" rows="2">${esc(w.opmerking)}</textarea></label>
      <div class="veld"><span>Foto's</span>
        <div class="fotos">${w.fotos.map((f, fi) => `<figure><img data-foto="${f.id}" alt=""><button class="mini gevaar" onclick="verwijderFoto(${ri},${wi},${fi})">✕</button></figure>`).join('')}
          <label class="foto-knop">+ Foto<input type="file" accept="image/*" multiple hidden onchange="voegFotoToe(this,${ri},${wi})"></label>
        </div>
      </div>
    </section>

    ${w.producten.map((p, pi) => productKaart(p, `${pre}.producten.${pi}`, `${ri}.${wi}.${pi}`, pi)).join('')}

    <div class="acties">
      <button class="knop" onclick="maakProduct(${ri},${wi})">+ Product op dit raam</button>
    </div>
    <div class="acties onder">
      ${wi > 0 ? `<a class="knop" href="#/k/${k.id}/raam/${ru.ramen[wi - 1].id}">‹ Raam ${esc(ru.ramen[wi - 1].nr)}</a>` : ''}
      ${wi < ru.ramen.length - 1 ? `<a class="knop" href="#/k/${k.id}/raam/${ru.ramen[wi + 1].id}">Raam ${esc(ru.ramen[wi + 1].nr)} ›</a>` : ''}
      <button class="knop primair" onclick="maakRaam(${ri})">+ Volgend raam in ${esc(ru.naam || 'ruimte')}</button>
      <button class="knop" onclick="kopieerRaam(${ri},${wi})">Raam dupliceren</button>
      <button class="knop gevaar" onclick="verwijderRaam(${ri},${wi})">Raam verwijderen</button>
    </div>
  </main>`;
  laadFotos();
  updateBadge();
}
function select(pad, opties, waarde, extra = '') {
  return `<select data-bind="${pad}" ${extra}><option value="">—</option>${opties.map(o => `<option ${o === waarde ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
}
function typeSelect(pad, waarde) {
  const groepen = [...new Set(CONFIG.producten.map(p => p.groep))];
  return `<select data-bind="${pad}" data-rerender class="type-select"><option value="">Kies product…</option>${groepen.map(g => `<optgroup label="${g}">${CONFIG.producten.filter(p => p.groep === g).map(p => `<option value="${p.id}" ${p.id === waarde ? 'selected' : ''}>${esc(p.naam)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
function productKaart(p, pre, sleutel, pi) {
  const t = typeDef(p.type);
  if (!t) return `<section class="kaart product" data-prod="${sleutel}"><div class="product-kop"><b>Product ${pi + 1}</b>${typeSelect(pre + '.type', p.type)}</div><div class="resultaat"></div></section>`;
  const [lB, lH] = labelsMaat(t);
  const meetrij = (label, as) => `<div class="meetrij"><span class="meetlabel">${label}</span>${[0, 1, 2].map(i => `<input data-meet data-live data-bind="${pre}.${as}.${i}" value="${esc(p[as][i])}" inputmode="decimal" placeholder="${i === 0 ? 'mm' : (i === 1 ? '2e' : '3e')}" autocomplete="off" class="meet">`).join('')}</div>`;
  const r = bereken(p);
  return `<section class="kaart product" data-prod="${sleutel}">
    <div class="product-kop"><b>Product ${pi + 1}</b>${typeSelect(pre + '.type', p.type)}</div>
    <div class="raster2">
      ${t.calc !== 'stof' ? `<div class="veld"><span>Montage</span><div class="segment">
        <label><input type="radio" name="m${sleutel}" value="in" data-bind="${pre}.montage" data-rerender ${p.montage === 'in' ? 'checked' : ''}> In de dag</label>
        <label><input type="radio" name="m${sleutel}" value="op" data-bind="${pre}.montage" data-rerender ${p.montage === 'op' ? 'checked' : ''}> Op de dag</label>
      </div></div>` : ''}
      <label class="veld"><span>Bevestiging</span>${select(pre + '.bevestiging', CONFIG.bevestiging, p.bevestiging)}</label>
    </div>

    <div class="strak-blok">
      <div class="strak-titel">GEMETEN (strak) – niet bestellen <small>mm · ${t.calc === 'zon' && p.montage === 'in' ? '3-puntsmeting aanbevolen, kleinste telt' : 'kleinste telt'}</small></div>
      ${meetrij(lB, 'B')}
      ${lH ? meetrij(lH, 'H') : ''}
    </div>

    <details class="correcties"><summary>Correcties (standaard ingevuld)</summary>
      <div class="raster2">
        ${(r ? r.params : []).map(([key, label, e]) => `<label class="veld"><span>${label} (mm)</span><input data-par="${key}" data-live data-bind="${pre}.par.${key}" value="${esc(p.par[key] ?? '')}" placeholder="standaard ${e.std}" inputmode="decimal" class="${e.afw ? 'afwijkend' : ''}"></label>`).join('')}
      </div>
    </details>

    <div class="resultaat">${resultaatHTML(p)}</div>

    <details class="correcties" ${p.hand.B || p.hand.H ? 'open' : ''}><summary>Bestelmaat handmatig aanpassen</summary>
      <div class="raster2">
        <label class="veld"><span>${t.calc === 'lengte' ? 'Lengte' : 'Breedte'} (mm)</span><input data-live data-bind="${pre}.hand.B" value="${esc(p.hand.B)}" inputmode="decimal"></label>
        ${t.calc !== 'lengte' ? `<label class="veld"><span>Hoogte (mm)</span><input data-live data-bind="${pre}.hand.H" value="${esc(p.hand.H)}" inputmode="decimal"></label>` : ''}
      </div>
      <label class="veld"><span>Reden (verplicht)</span><input data-live data-bind="${pre}.hand.reden" value="${esc(p.hand.reden)}"></label>
    </details>

    <div class="raster2">
      <label class="veld"><span>Kleur / stof</span><input data-bind="${pre}.kleur" value="${esc(p.kleur)}"></label>
      <label class="veld"><span>Collectie / prijsgroep</span><input data-bind="${pre}.collectie" value="${esc(p.collectie)}"></label>
      ${t.velden.map(v => { const d = CONFIG.velden[v]; const val = p.opties[v] ?? (d.std ? DB.inst.waarden[d.std] : '');
        if (d.std && p.opties[v] === undefined) p.opties[v] = val;
        return `<label class="veld"><span>${d.label}</span>${d.type === 'select' ? select(`${pre}.opties.${v}`, d.opties, val, d.std && val !== DB.inst.waarden[d.std] ? 'class="afwijkend"' : '') : `<input data-bind="${pre}.opties.${v}" value="${esc(val)}" placeholder="${esc(d.placeholder || '')}">`}</label>`; }).join('')}
    </div>
    <label class="veld"><span>Opmerking product</span><input data-bind="${pre}.opmerking" value="${esc(p.opmerking)}"></label>
    <div class="acties klein">
      <button class="mini" onclick="dupliceerProduct('${sleutel}')">Dupliceer</button>
      <button class="mini gevaar" onclick="verwijderProduct('${sleutel}')">Verwijder product</button>
    </div>
  </section>`;
}
function resultaatHTML(p) {
  const r = bereken(p);
  if (!r) return '';
  return `<div class="bestel ${r.hand.B || r.hand.H ? 'hand' : ''}">
      <div class="bestel-label">BESTELMAAT <small>mm</small>${r.hand.B || r.hand.H ? ' <span class="tag">handmatig</span>' : ''}</div>
      <div class="bestel-maat">${fmtMaat(r)}</div>
      <div class="bestel-uitleg">${esc(r.uitB)}${r.uitH ? '<br>' + esc(r.uitH) : ''}</div>
    </div>
    ${r.afwijkend.length ? `<div class="let-op">Afwijkend van standaard: ${esc(r.afwijkend.join(', '))}</div>` : ''}
    ${r.waarsch.map(w => `<div class="waarschuwing">⚠ ${esc(w)}</div>`).join('')}
    ${r.info ? `<div class="info">${esc(r.info)}</div>` : ''}`;
}
function prodVan(sleutel) { const [ri, wi, pi] = sleutel.split('.').map(Number); return [huidigeKlant.ruimtes[ri].ramen[wi], pi]; }
function maakProduct(ri, wi) { huidigeKlant.ruimtes[ri].ramen[wi].producten.push(nieuwProduct()); gewijzigd(huidigeKlant); route(); }
function dupliceerProduct(s) { const [w, pi] = prodVan(s); const c = kopie(w.producten[pi]); c.id = uid(); w.producten.splice(pi + 1, 0, c); gewijzigd(huidigeKlant); route(); }
function verwijderProduct(s) { if (!confirm('Product verwijderen?')) return; const [w, pi] = prodVan(s); w.producten.splice(pi, 1); gewijzigd(huidigeKlant); route(); }
function kopieerRaam(ri, wi) {
  const ru = huidigeKlant.ruimtes[ri]; const c = kopie(ru.ramen[wi]);
  c.id = uid(); c.nr = String(ru.ramen.length + 1); c.fotos = []; c.producten.forEach(p => p.id = uid());
  ru.ramen.push(c); gewijzigd(huidigeKlant); location.hash = `#/k/${huidigeKlant.id}/raam/${c.id}`;
}
function verwijderRaam(ri, wi) {
  if (!confirm('Dit raam verwijderen?')) return;
  const k = huidigeKlant; k.ruimtes[ri].ramen.splice(wi, 1); gewijzigd(k); location.hash = '#/k/' + k.id;
}

/* ---------- foto's ---------- */
async function verklein(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg', 0.75);
}
async function voegFotoToe(input, ri, wi) {
  const k = huidigeKlant; const w = k.ruimtes[ri].ramen[wi];
  for (const f of input.files) {
    try { const data = await verklein(f); const id = uid(); await fotoDB.put({ id, klantId: k.id, data }); w.fotos.push({ id, driveId: '' }); }
    catch (e) { melding('Foto kon niet worden verwerkt.', true); }
  }
  gewijzigd(k); route();
}
async function verwijderFoto(ri, wi, fi) {
  if (!confirm('Foto verwijderen? (Een kopie in Drive blijft bestaan.)')) return;
  const w = huidigeKlant.ruimtes[ri].ramen[wi]; const [f] = w.fotos.splice(fi, 1);
  await fotoDB.del(f.id).catch(() => {}); gewijzigd(huidigeKlant); route();
}
async function laadFotos() {
  for (const img of $$('img[data-foto]')) {
    const rec = await fotoDB.get(img.dataset.foto).catch(() => null);
    if (rec) img.src = rec.data;
    else { const f = alleFotos(huidigeKlant).find(x => x.id === img.dataset.foto);
      if (f && f.driveId) { img.replaceWith(Object.assign(document.createElement('a'), { href: `https://drive.google.com/file/d/${f.driveId}/view`, target: '_blank', textContent: 'Foto in Drive', className: 'drive-link' })); } }
  }
}
const alleFotos = k => k.ruimtes.flatMap(r => r.ramen.flatMap(w => w.fotos));

/* ---------- Overzicht / print ---------- */
let werkprint = false;
function renderOverzicht(k) {
  const ruimtes = k.ruimtes.filter(r => r.ramen.some(w => w.producten.some(p => typeDef(p.type))));
  const totaalBladen = 1 + ruimtes.length + (werkprint ? 1 : 0);
  const kopje = (nr, sub) => `<div class="blad-kop"><img src="logo.png" alt="Edison Interieur"><div class="blad-kop-tekst"><b>${esc(k.naam)}</b> · ${esc(k.adres)}, ${esc(k.pcplaats)}${k.offertenr ? ' · Offerte ' + esc(k.offertenr) : ''}<br>${esc(sub)}</div><div class="bladnr">Blad ${nr} van ${totaalBladen}</div></div>`;
  const voet = `<div class="blad-voet">Alle maten in mm. Maten op dit formulier zijn <b>BESTELMATEN</b>. Ingemeten ${datumNL(k.datum)}.</div>`;

  let html = kop('Overzicht', '#/k/' + k.id) + `
  <div class="werkbalk no-print">
    <button class="knop primair" onclick="window.print()">Printen / PDF</button>
    <button class="knop" onclick="kopieerOfferte()">Kopieer voor offerte</button>
    <label class="schakel"><input type="checkbox" ${werkprint ? 'checked' : ''} onchange="werkprint=this.checked;route()"> Werkprint (met bijlage gemeten maten)</label>
  </div>
  <div class="print">
  <section class="blad voorblad">
    <div class="voor-kop"><img src="logo.png" alt="Edison Interieur" class="voor-logo"><div class="voor-titel">MEETFORMULIER</div></div>
    <table class="gegevens">
      <tr><th>Naam</th><td>${esc(k.naam)}</td><th>Datum</th><td>${datumNL(k.datum)}</td></tr>
      <tr><th>Adres</th><td>${esc(k.adres)}</td><th>Offertenummer</th><td>${esc(k.offertenr)}</td></tr>
      <tr><th>Postcode/plaats</th><td>${esc(k.pcplaats)}</td><th>Telefoon</th><td>${esc(k.telefoon)}</td></tr>
      <tr><th></th><td></td><th>E-mail</th><td>${esc(k.email)}</td></tr>
    </table>
    <h2>Overzicht per ruimte</h2>
    <table class="tabel">
      <thead><tr><th>Ruimte</th><th>Ramen</th><th>Producten</th><th>Blad</th></tr></thead>
      <tbody>${ruimtes.map((ru, i) => `<tr><td><b>${esc(ru.naam)}</b></td><td>${ru.ramen.length}</td><td>${samenvatting(ru)}</td><td>${i + 2}</td></tr>`).join('')}</tbody>
    </table>
    ${k.opmerking ? `<h2>Opmerking</h2><p>${esc(k.opmerking).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="handtekening"><div>Ingemeten door</div><div>Paraaf klant</div></div>
    ${voet}
  </section>`;

  ruimtes.forEach((ru, i) => {
    html += `<section class="blad">${kopje(i + 2, ru.naam)}
      <h2 class="ruimte-titel">${esc(ru.naam)}</h2>
      ${ru.ramen.map(w => `
        <div class="raam-blok">
          <div class="raam-kop"><b>Raam ${esc(w.nr)}</b>${w.omschrijving ? ' – ' + esc(w.omschrijving) : ''}
            <span class="raam-meta">${[w.ondergrond && 'Ondergrond: ' + w.ondergrond, w.kozijndiepte && 'Kozijndiepte: ' + w.kozijndiepte + ' mm', w.obstakels.length && 'Let op: ' + w.obstakels.join(', ')].filter(Boolean).map(esc).join(' · ')}</span></div>
          <table class="tabel producten">
            <thead><tr><th>Product</th><th>Montage</th><th class="kol-bestel">BESTELMAAT (mm)<br><small>${'b × h'}</small></th><th>Kleur / stof</th><th>Uitvoering</th></tr></thead>
            <tbody>${w.producten.filter(p => typeDef(p.type)).map(p => { const r = bereken(p); return `
              <tr><td><b>${esc(r.t.naam)}</b>${p.collectie ? '<br><small>' + esc(p.collectie) + '</small>' : ''}</td>
                <td>${r.t.calc === 'stof' ? '' : (p.montage === 'in' ? 'In de dag' : 'Op de dag')}${p.bevestiging ? '<br><small>' + esc(p.bevestiging) + '</small>' : ''}</td>
                <td class="kol-bestel"><span class="bestel-print">${fmtMaat(r)}</span>${r.hand.B || r.hand.H ? '<br><span class="tag">handmatig: ' + esc(p.hand.reden || 'geen reden') + '</span>' : ''}${r.afwijkend.length ? '<br><small class="afw">afwijkend: ' + esc(r.afwijkend.join(', ')) + '</small>' : ''}</td>
                <td>${esc(p.kleur)}</td>
                <td><small>${esc(optieTekst(p))}${p.opmerking ? '<br><i>' + esc(p.opmerking) + '</i>' : ''}</small></td></tr>
              <tr class="strak-rij no-print"><td colspan="5"><button class="mini" onclick="this.parentNode.classList.toggle('open')">Toon gemeten maten</button>
                <span class="strak-detail">GEMETEN – NIET BESTELLEN: ${fmtStrak(r)} mm · ${esc(r.uitB)}${r.uitH ? ' · ' + esc(r.uitH) : ''}</span></td></tr>`; }).join('')}
            </tbody>
          </table>
          ${w.opmerking ? `<div class="raam-opm">${esc(w.opmerking)}</div>` : ''}
          ${w.fotos.length ? `<div class="print-fotos">${w.fotos.map(f => `<img data-foto="${f.id}" alt="">`).join('')}</div>` : ''}
        </div>`).join('')}
      ${voet}
    </section>`;
  });

  if (werkprint) {
    html += `<section class="blad bijlage">${kopje(totaalBladen, 'Bijlage')}
      <h2 class="bijlage-titel">BIJLAGE – GEMETEN MATEN – NIET BESTELLEN</h2>
      <p class="bijlage-uitleg">Dit zijn de strakke (gemeten) maten. Bestel altijd op de bestelmaat van de ruimtebladen.</p>
      <table class="tabel grijs"><thead><tr><th>Ruimte</th><th>Raam</th><th>Product</th><th>Montage</th><th>Breedte 1 / 2 / 3</th><th>Hoogte 1 / 2 / 3</th><th>Strak</th><th>Berekening</th></tr></thead><tbody>
      ${ruimtes.flatMap(ru => ru.ramen.flatMap(w => w.producten.filter(p => typeDef(p.type)).map(p => { const r = bereken(p); return `<tr><td>${esc(ru.naam)}</td><td>${esc(w.nr)}</td><td>${esc(r.t.naam)}</td><td>${r.t.calc === 'stof' ? '' : p.montage === 'in' ? 'In' : 'Op'}</td><td>${p.B.map(v => esc(v) || '–').join(' / ')}</td><td>${r.t.calc === 'lengte' ? '' : p.H.map(v => esc(v) || '–').join(' / ')}</td><td>${fmtStrak(r)}</td><td><small>${esc(r.uitB)}${r.uitH ? '<br>' + esc(r.uitH) : ''}</small></td></tr>`; }))).join('')}
      </tbody></table></section>`;
  }
  html += '</div>';
  app().innerHTML = html;
  laadFotos();
  updateBadge();
}
function samenvatting(ru) {
  const telling = {};
  ru.ramen.forEach(w => w.producten.forEach(p => { const t = typeDef(p.type); if (t) telling[t.naam] = (telling[t.naam] || 0) + 1; }));
  return Object.entries(telling).map(([n, c]) => `${c}× ${esc(n)}`).join(', ');
}

/* ---------- Offerte ---------- */
function offerteRegels(k) {
  const regels = [];
  k.ruimtes.forEach(ru => {
    const groepen = new Map();
    ru.ramen.forEach(w => w.producten.forEach(p => {
      const t = typeDef(p.type); if (!t) return;
      const r = bereken(p);
      const sleutel = JSON.stringify([p.type, r.B, r.H, p.kleur.trim().toLowerCase(), p.collectie.trim().toLowerCase(), p.montage, p.bevestiging, Object.entries(p.opties).filter(([, v]) => v).sort()]);
      if (!groepen.has(sleutel)) {
        const delen = [t.naam];
        if (p.collectie) delen.push(p.collectie);
        if (p.kleur) delen.push(p.kleur);
        if (DB.inst.waarden.matenInOfferte && r.B != null) delen.push(fmtMaat(r) + ' mm');
        const zijde = p.opties.zijde; if (zijde) delen.push('bediening ' + zijde.toLowerCase());
        groepen.set(sleutel, { aantal: 0, tekst: delen.join(' – ') });
      }
      groepen.get(sleutel).aantal++;
    }));
    if (groepen.size) { regels.push(['', '', ru.naam]); groepen.forEach(g => regels.push([g.aantal, 'st', g.tekst])); }
  });
  return regels;
}
async function kopieerOfferte() {
  const regels = offerteRegels(huidigeKlant);
  const tekst = regels.map(r => r.join('\t')).join('\n');
  let ok = false;
  try { await navigator.clipboard.writeText(tekst); ok = true; } catch (e) {}
  if (!ok) { const ta = document.createElement('textarea'); ta.value = tekst; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); }
  const limiet = regels.length > 21 ? `<br><b>Let op: ${regels.length} regels, de offerte heeft er maximaal 21.</b>` : '';
  melding(ok ? `${regels.length} regels gekopieerd. Klik in Excel op cel B14 en plak.${limiet}` : 'Kopiëren lukte niet.', !ok || !!limiet, 8000);
}

/* ---------- Instellingen ---------- */
function renderInst() {
  const w = DB.inst.waarden;
  app().innerHTML = kop('Instellingen', '#/') + `
  <main class="inhoud">
    <section class="kaart">
      <h2>Standaardwaarden</h2>
      <p class="uitleg">Gelden voor nieuwe én bestaande producten, tenzij per product afwijkend ingevuld. Alle maten in mm.</p>
      <div class="raster2">
        <label class="veld"><span>Plooi</span><select data-ibind="waarden.plooi">${CONFIG.velden.plooi.opties.map(o => `<option ${o === w.plooi ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
        ${[['overlap', 'Overlap gordijn'], ['vloerafstand', 'Vloerafstand gordijn'], ['aftrekB', 'Aftrek breedte in de dag'], ['aftrekH', 'Aftrek hoogte in de dag'], ['overmaatB', 'Overmaat breedte op de dag'], ['overmaatH', 'Overmaat hoogte op de dag']].map(([k, l]) => `<label class="veld"><span>${l}</span><input data-ibind="waarden.${k}" data-num value="${esc(w[k])}" inputmode="decimal"></label>`).join('')}
      </div>
      <label class="schakel"><input type="checkbox" data-ibind="waarden.matenInOfferte" ${w.matenInOfferte ? 'checked' : ''}> Bestelmaten opnemen in offerteregels</label>
    </section>
    <section class="kaart">
      <h2>Aftrek in de dag per product</h2>
      <p class="uitleg">Leeg = standaard (${esc(w.aftrekB)} / ${esc(w.aftrekH)} mm).</p>
      <table class="tabel inst"><thead><tr><th>Product</th><th>Breedte</th><th>Hoogte</th></tr></thead><tbody>
      ${CONFIG.producten.filter(p => p.calc !== 'stof').map(p => { const a = DB.inst.aftrekPerType[p.id] || {}; return `<tr><td>${esc(p.naam)}</td><td><input data-ibind="aftrekPerType.${p.id}.B" data-num value="${esc(a.B ?? '')}" inputmode="decimal" onfocus="zorgType('${p.id}')"></td><td><input data-ibind="aftrekPerType.${p.id}.H" data-num value="${esc(a.H ?? '')}" inputmode="decimal" onfocus="zorgType('${p.id}')"></td></tr>`; }).join('')}
      </tbody></table>
    </section>
    <section class="kaart">
      <h2>Koppeling Google Sheet</h2>
      <p class="uitleg">Alleen op dit toestel opgeslagen. Zie het stappenplan.</p>
      <label class="veld"><span>Web-app-URL (Apps Script)</span><input data-ibind="url" data-lokaal value="${esc(DB.inst.url)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="veld"><span>Sleutel</span><input data-ibind="sleutel" data-lokaal value="${esc(DB.inst.sleutel)}" autocomplete="off"></label>
      <div class="acties"><button class="knop primair" onclick="testVerbinding()">Test verbinding</button><button class="knop" onclick="sync(true)">Nu synchroniseren</button></div>
    </section>
    <section class="kaart">
      <h2>Back-up</h2>
      <div class="acties"><button class="knop" onclick="exporteer()">Download back-up (JSON)</button>
      <label class="knop">Back-up terugzetten<input type="file" accept="application/json" hidden onchange="importeer(this)"></label></div>
      <p class="uitleg">Versie ${CONFIG.versie}</p>
    </section>
  </main>`;
  updateBadge();
}
function zorgType(id) { if (!DB.inst.aftrekPerType[id]) DB.inst.aftrekPerType[id] = { B: '', H: '' }; }
async function testVerbinding() {
  try { const j = await post({ action: 'test' }); melding('Verbinding werkt: ' + (j.bericht || 'ok')); }
  catch (e) { melding('Verbinding mislukt: ' + e.message, true); }
}
function exporteer() {
  const blob = new Blob([JSON.stringify({ klanten: DB.klanten, inst: { ...DB.inst, sleutel: '' } }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `meetformulier-backup-${vandaag()}.json`; a.click();
}
async function importeer(input) {
  try { const d = JSON.parse(await input.files[0].text()); Object.assign(DB.klanten, d.klanten || {}); Object.values(DB.klanten).forEach(k => k.syncedAt = 0); bewaarLokaal(); melding('Back-up teruggezet.'); planSync(); }
  catch (e) { melding('Bestand niet leesbaar.', true); }
}

/* ---------- Lege printversie ---------- */
function renderLeeg() {
  const lijn = l => `<div class="leeg-veld"><span>${l}</span><i></i></div>`;
  const vakjes = l => l.map(x => `<span class="vakje">☐ ${x}</span>`).join(' ');
  const raamblok = () => `<div class="raam-blok leeg-raam">
      <div class="leeg-rij">${lijn('Raam')}${lijn('Omschrijving')}</div>
      <div class="leeg-rij klein">Product: ${vakjes(['Overgordijn', 'Vitrage', 'Inbetween', 'Rail', 'Roede', 'Rolgordijn', 'Duo-rol', 'Plissé', 'Duette', 'Vouwgordijn', 'Paneel', 'Lamellen', 'Jaloezie', 'Shutters', 'Tru-fit', 'Hor', 'Hordeur'])}</div>
      <div class="leeg-rij klein">Montage: ${vakjes(['In de dag', 'Op de dag'])} &nbsp; Bevestiging: ${vakjes(['Wand', 'Plafond', 'Kozijn', 'Glaslat'])} &nbsp; Bediening: ${vakjes(['L', 'R'])}</div>
      <div class="leeg-maten">
        <div class="strak-vak"><b>GEMETEN – NIET BESTELLEN</b><div>B: ______ / ______ / ______</div><div>H: ______ / ______ / ______</div></div>
        <div class="bestel-vak"><b>BESTELMAAT (mm)</b><div class="groot">B ________ × H ________</div></div>
      </div>
      <div class="leeg-rij">${lijn('Kleur / stof')}${lijn('Opmerking')}</div>
    </div>`;
  app().innerHTML = kop('Lege printversie', '#/') + `
  <div class="werkbalk no-print"><button class="knop primair" onclick="window.print()">Printen</button><span class="uitleg">Blad 1 is het voorblad, blad 2 print je zo vaak als nodig (één per ruimte).</span></div>
  <div class="print">
    <section class="blad voorblad">
      <div class="voor-kop"><img src="logo.png" alt="Edison Interieur" class="voor-logo"><div class="voor-titel">MEETFORMULIER</div></div>
      <div class="leeg-rij">${lijn('Naam')}${lijn('Datum')}</div>
      <div class="leeg-rij">${lijn('Adres')}${lijn('Offertenummer')}</div>
      <div class="leeg-rij">${lijn('Postcode/plaats')}${lijn('Telefoon')}</div>
      <div class="leeg-rij">${lijn('E-mail')}${lijn('Ingemeten door')}</div>
      <h2>Ruimtes</h2>
      <table class="tabel leeg-tabel"><thead><tr><th>Ruimte</th><th>Ramen</th><th>Producten</th></tr></thead><tbody>${'<tr><td></td><td></td><td></td></tr>'.repeat(10)}</tbody></table>
      <div class="blad-voet">Alle maten in mm. Vul de strakke maten alleen in het grijze vak in.</div>
    </section>
    <section class="blad">
      <div class="blad-kop"><img src="logo.png" alt=""><div class="blad-kop-tekst">${lijn('Klant')} ${lijn('Ruimte')}</div></div>
      ${raamblok()}${raamblok()}${raamblok()}
      <div class="blad-voet">Alle maten in mm. Bestel alleen op de BESTELMAAT.</div>
    </section>
  </div>`;
  updateBadge();
}

/* ---------- synchronisatie ---------- */
let syncBezig = false, syncFout = '', syncTimer = null;
function planSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), 4000); }
async function post(data) {
  if (!DB.inst.url || !DB.inst.sleutel) throw new Error('Koppeling niet ingesteld');
  const r = await fetch(DB.inst.url, { method: 'POST', body: JSON.stringify({ ...data, key: DB.inst.sleutel }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.fout || 'Onbekende fout');
  return j;
}
// kopie met berekende maten erbij, zodat het tabblad "Regels" in de Sheet bestelmaten toont
function metBerekening(k) {
  const c = kopie(k);
  c.ruimtes.forEach(ru => ru.ramen.forEach(w => w.producten.forEach(p => {
    const r = bereken(p);
    p.berekend = r ? { naam: r.t.naam, calc: r.t.calc, B: r.B, H: r.H, sB: r.sB, sH: r.sH, hand: r.hand.B || r.hand.H } : null;
  })));
  return c;
}
const aantalOpen = () => Object.values(DB.klanten).filter(k => k.updated > k.syncedAt).length + (DB.inst.updated > DB.inst.syncedAt ? 1 : 0);
function updateBadge() {
  const b = $('#badge'); if (!b) return;
  const n = aantalOpen();
  let t, c;
  if (!DB.inst.url) { t = 'Niet gekoppeld'; c = 'grijs'; }
  else if (syncBezig) { t = 'Bezig…'; c = 'grijs'; }
  else if (syncFout) { t = `⚠ ${n} niet verstuurd`; c = 'rood'; }
  else if (!navigator.onLine && n) { t = `Offline · ${n} wacht`; c = 'oranje'; }
  else if (n) { t = `${n} wacht`; c = 'oranje'; }
  else { t = '✓ Gesynchroniseerd'; c = 'groen'; }
  b.textContent = t; b.className = 'badge ' + c; b.title = syncFout || '';
}
async function sync(handmatig) {
  if (syncBezig) return;
  if (!DB.inst.url || !DB.inst.sleutel) { if (handmatig) location.hash = '#/instellingen'; return; }
  if (!navigator.onLine) { updateBadge(); if (handmatig) melding('Geen verbinding. Wordt later verstuurd.'); return; }
  syncBezig = true; updateBadge();
  let veranderd = false;
  try {
    for (const k of Object.values(DB.klanten)) {
      if (k.updated <= k.syncedAt) continue;
      for (const f of alleFotos(k)) {
        if (f.driveId) continue;
        const rec = await fotoDB.get(f.id).catch(() => null); if (!rec) continue;
        const j = await post({ action: 'foto', klantId: k.id, klantNaam: k.naam, fotoId: f.id, dataUrl: rec.data });
        f.driveId = j.driveId; bewaarLokaal();
      }
      const stempel = k.updated;
      await post({ action: 'opslaan', klant: metBerekening(k) });
      k.syncedAt = stempel; bewaarLokaal();
    }
    if (DB.inst.updated > DB.inst.syncedAt) {
      const stempel = DB.inst.updated;
      await post({ action: 'instellingen_opslaan', inst: { waarden: DB.inst.waarden, aftrekPerType: DB.inst.aftrekPerType, updated: stempel } });
      DB.inst.syncedAt = stempel;
    }
    const j = await post({ action: 'lijst', sinds: DB.inst.laatstePull || 0 });
    for (const r of j.klanten || []) {
      const lok = DB.klanten[r.id];
      if (!lok || (r.updated > lok.updated && lok.updated <= lok.syncedAt)) {
        const k = JSON.parse(r.json); k.syncedAt = k.updated; DB.klanten[k.id] = k; veranderd = true;
      }
    }
    const si = j.instellingen;
    if (si && si.updated > DB.inst.updated && DB.inst.updated <= DB.inst.syncedAt) {
      DB.inst.waarden = { ...CONFIG.standaard, ...si.waarden }; DB.inst.aftrekPerType = si.aftrekPerType || {}; DB.inst.updated = DB.inst.syncedAt = si.updated; veranderd = true;
    }
    DB.inst.laatstePull = j.serverTijd || Date.now();
    bewaarLokaal(); syncFout = '';
    if (handmatig) melding('Gesynchroniseerd.');
  } catch (e) {
    syncFout = e.message; if (handmatig) melding('Synchroniseren mislukt: ' + e.message, true);
  } finally {
    syncBezig = false; updateBadge();
    const bezig = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (veranderd && !bezig && !huidigeKlant) route();
  }
}
window.addEventListener('online', () => sync());
window.addEventListener('offline', updateBadge);
setInterval(() => { if (aantalOpen()) sync(); }, 60000);

/* ---------- meldingen ---------- */
function melding(tekst, fout, ms = 4000) {
  let m = $('#melding'); if (!m) { m = document.createElement('div'); m.id = 'melding'; m.className = 'no-print'; document.body.appendChild(m); }
  m.innerHTML = tekst; m.className = 'no-print toon' + (fout ? ' fout' : '');
  clearTimeout(m._t); m._t = setTimeout(() => m.className = 'no-print', ms);
}

/* ---------- start ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
sync();
