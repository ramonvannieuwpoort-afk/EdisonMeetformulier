/* =========================================================
   Edison Meetformulier – winkelpagina
   Eenvoudige weergave voor de winkel met een eigen wachtwoord.
   Kan alleen: opdrachten klaarzetten, de lijst en printbonnen
   bekijken en een offerte als gemaakt afvinken. De Apps Script
   controleert dat; met dit wachtwoord kan niets anders.
   ========================================================= */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const datumNL = d => { if (!d || !/^\d{4}-\d\d-\d\d/.test(d)) return d || ''; const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}-${m}-${y}`; };
const app = () => $('#app');
const W = (() => { try { return JSON.parse(localStorage.getItem('emf_winkel') || '{}'); } catch (e) { return {}; } })();
const bewaar = () => localStorage.setItem('emf_winkel', JSON.stringify(W));
let KLANTEN = [], filter = 'gevraagd', laden = false;

// koppeling via link (#koppel=...) van de inmeter
if (location.hash.startsWith('#koppel=')) {
  try { const k = JSON.parse(atob(decodeURIComponent(location.hash.slice(8)))); W.url = k.url; W.ww = k.ww; bewaar(); } catch (e) {}
  history.replaceState(null, '', location.pathname);
}

// voorkomt dubbel klikken: knop uit zolang het verzoek loopt
let bezig = false;
async function eenKeer(knop, fn) {
  if (bezig) return; bezig = true;
  const oud = knop && knop.textContent; if (knop) { knop.disabled = true; knop.textContent = 'Bezig…'; }
  try { await fn(); } finally { bezig = false; if (knop && document.body.contains(knop)) { knop.disabled = false; knop.textContent = oud; } }
}
async function post(data) {
  if (!W.url || !W.ww) throw new Error('Niet gekoppeld');
  const r = await fetch(W.url, { method: 'POST', body: JSON.stringify({ ...data, key: W.ww }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.fout || 'Onbekende fout');
  return j;
}
function melding(tekst, fout) {
  let m = $('#melding'); if (!m) { m = document.createElement('div'); m.id = 'melding'; document.body.appendChild(m); }
  m.innerHTML = esc(tekst); m.className = 'no-print toon' + (fout ? ' fout' : '');
  clearTimeout(m._t); m._t = setTimeout(() => m.className = 'no-print', 5000);
}
const kop = (titel, terug) => `<header class="kop no-print">${terug ? `<a class="terug" href="${terug}">‹</a>` : '<span class="terug-leeg"></span>'}<img src="logo.png" alt="Edison Interieur" class="kop-logo"><span class="kop-titel">${esc(titel)}</span><span class="badge grijs">Winkel</span></header>`;

const METING = { klaargezet: 'klaargezet – nog te meten', nieuw: 'nog te meten', bezig: 'bezig met meten', afgerond: '✓ ingemeten' };
function offerteLabel(k) {
  const o = k.offerte || {};
  if (o.keuze === 'winkel') return '<b class="of-winkel">Offerte graag door winkel</b>';
  if (o.keuze === 'gemaakt') return `<span class="of-gemaakt">offerte ${esc(o.nr)} gemaakt${o.door === 'winkel' ? ' door winkel' : ''}${o.verstuurd ? ' · verstuurd' : ''}</span>`;
  if (o.keuze === 'zelf') return 'offerte: maakt inmeter';
  if (o.keuze === 'geen') return 'geen offerte nodig';
  return '';
}
const gevraagd = k => k.offerte && k.offerte.keuze === 'winkel';
const FILTERS = { gevraagd: ['Offerte gevraagd', gevraagd], meten: ['Nog te meten', k => k.meting !== 'afgerond'], alles: ['Alles', () => true] };

async function haalLijst() {
  laden = true; route();
  try { KLANTEN = (await post({ action: 'w_lijst' })).klanten; }
  catch (e) { melding('Lijst ophalen mislukt: ' + e.message, true); }
  laden = false; route();
}

function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (!W.url || !W.ww) return renderKoppel();
  if (h[0] === 'nieuw') return renderNieuw();
  if (h[0] === 'k') { const k = KLANTEN.find(x => x.id === h[1]); if (k) return h[2] === 'printbon' ? renderPrintbon(k) : renderKlant(k); }
  renderLijst();
}
window.addEventListener('hashchange', route);

function renderKoppel() {
  app().innerHTML = kop('Winkel – koppelen') + `<main class="inhoud"><section class="kaart"><h2>Koppelen</h2>
    <p class="uitleg">Open de winkel-link die je van de inmeter hebt gekregen, of vul hieronder de gegevens in.</p>
    <label class="veld"><span>Web-app-URL</span><input id="k-url" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label class="veld"><span>Winkelwachtwoord</span><input id="k-ww" autocomplete="off"></label>
    <div class="acties"><button class="knop primair" onclick="koppel()">Koppelen</button></div></section></main>`;
}
async function koppel() {
  W.url = $('#k-url').value.trim(); W.ww = $('#k-ww').value.trim();
  try { await post({ action: 'w_test' }); bewaar(); melding('Gekoppeld.'); haalLijst(); }
  catch (e) { delete W.url; delete W.ww; melding('Koppelen mislukt: ' + e.message, true); }
}

function renderLijst() {
  const f = FILTERS[filter] ? filter : 'alles';
  const lijst = KLANTEN.filter(FILTERS[f][1]).sort((a, b) => (gevraagd(b) - gevraagd(a)) || (b.datum || '').localeCompare(a.datum || '') || b.t - a.t);
  app().innerHTML = kop('Opdrachten') + `<main class="inhoud">
    <div class="acties"><a class="knop primair" href="#nieuw">+ Nieuwe opdracht klaarzetten</a><button class="knop" onclick="haalLijst()">${laden ? 'Laden…' : 'Vernieuwen'}</button>
      <input type="search" placeholder="Zoek klant…" class="zoek" oninput="$$('#wlijst li[data-zoek]').forEach(li => li.hidden = !li.dataset.zoek.includes(this.value.toLowerCase()))"></div>
    <div class="chips filters">${Object.entries(FILTERS).map(([key, [l, fn]]) => `<button class="${key === f ? 'actief' : ''}" onclick="filter='${key}';route()">${l} <b>${KLANTEN.filter(fn).length}</b></button>`).join('')}</div>
    <ul class="lijst" id="wlijst">${lijst.map(k => `<li class="${gevraagd(k) ? 'nieuw-winkel' : ''}" data-zoek="${esc((k.naam + ' ' + k.adres + ' ' + k.pcplaats + ' ' + k.offertenr).toLowerCase())}"><a href="#k/${k.id}">
      <strong>${esc(k.naam || '(geen naam)')}</strong><span>${esc(k.adres)} ${esc(k.pcplaats)}</span>
      <small>${k.datum ? datumNL(k.datum) + " · " : ""}<em class="st-${k.meting}">${METING[k.meting] || ''}</em>${offerteLabel(k) ? ' · ' + offerteLabel(k) : ''}</small></a></li>`).join('') || `<li class="leeg">${laden ? 'Laden…' : 'Niets in deze lijst.'}</li>`}</ul>
  </main>`;
}

function renderKlant(k) {
  const o = k.offerte || {};
  app().innerHTML = kop(k.naam || 'Klant', '#') + `<main class="inhoud">
    <section class="kaart"><h2>${esc(k.naam)}</h2>
      <p>${esc(k.adres)}<br>${esc(k.pcplaats)}<br>${esc(k.telefoon)}${k.email ? ' · ' + esc(k.email) : ''}</p>
      <p><b>Meting:</b> ${METING[k.meting] || ''}${k.datum ? ' · ' + datumNL(k.datum) : ''}<br><b>Offerte:</b> ${offerteLabel(k) || '–'}${o.notitie ? `<br><b>Notitie inmeter:</b> ${esc(o.notitie)}` : ''}</p>
      ${k.wens ? `<div class="wens-kaart kaart"><b>Wens klant</b>${k.door ? ' (aangenomen door ' + esc(k.door) + ')' : ''}<div class="wens">${esc(k.wens).replace(/\n/g, '<br>')}</div></div>` : ''}
      <div class="acties">${k.printbon ? `<a class="knop primair" href="#k/${k.id}/printbon">Printbon bekijken / printen</a>` : '<span class="uitleg">Printbon komt beschikbaar zodra de meting is afgerond.</span>'}
        ${k.meting === 'klaargezet' || k.meting === 'nieuw' ? `<button class="knop gevaar" onclick="eenKeer(this, () => verwijderOpdracht('${k.id}'))">Opdracht verwijderen</button>` : ''}</div>
    </section>
    ${k.meting === 'afgerond' && o.keuze !== 'gemaakt' && o.keuze !== 'geen' ? `<section class="kaart"><h2>Offerte gemaakt?</h2>
      <div class="raster2"><label class="veld"><span>Offertenummer</span><input id="o-nr"></label><label class="veld"><span>Je naam</span><input id="o-wie" value="${esc(W.naam || '')}"></label></div>
      <div class="acties"><button class="knop primair" onclick="eenKeer(this, () => offerteGemaakt('${k.id}'))">✓ Offerte gemaakt</button></div></section>` : ''}
  </main>`;
}
async function offerteGemaakt(id) {
  const nr = $('#o-nr').value.trim(), wie = $('#o-wie').value.trim();
  if (!nr) return melding('Vul het offertenummer in.', true);
  W.naam = wie; bewaar();
  try { await post({ action: 'w_offerte', id, nr, wie }); melding('Opgeslagen. De inmeter ziet het bij de volgende synchronisatie.'); await haalLijst(); location.hash = '#k/' + id; }
  catch (e) { melding('Opslaan mislukt: ' + e.message, true); }
}

async function verwijderOpdracht(id) {
  const k = KLANTEN.find(x => x.id === id);
  if (!confirm(`Opdracht ${k ? k.naam : ''} verwijderen?`)) return;
  try { await post({ action: 'w_verwijder', id }); melding('Opdracht verwijderd.'); location.hash = ''; await haalLijst(); }
  catch (e) { melding('Verwijderen mislukt: ' + e.message, true); }
}
async function renderPrintbon(k) {
  app().innerHTML = kop('Printbon ' + (k.naam || ''), '#k/' + k.id) + `<div class="werkbalk no-print"><button class="knop primair" onclick="window.print()">Printen / PDF</button></div><div class="print-houder" id="pb">Laden…</div>`;
  try {
    const j = await post({ action: 'w_printbon', id: k.id });
    $('#pb').innerHTML = j.html; schaal();
  } catch (e) { $('#pb').textContent = 'Printbon niet te laden: ' + e.message; }
}
function schaal() {
  const h = $('.print-houder'), p = $('.print'); if (!h || !p) return;
  p.style.transform = '';
  const z = Math.min(1, (document.documentElement.clientWidth - 16) / p.offsetWidth);
  p.style.transform = `scale(${z})`; h.style.width = (p.offsetWidth * z) + 'px'; h.style.height = (p.offsetHeight * z) + 'px';
}
window.addEventListener('resize', schaal);
window.addEventListener('beforeprint', () => { const p = $('.print'); if (p) p.style.transform = ''; const h = $('.print-houder'); if (h) { h.style.width = ''; h.style.height = ''; } });
window.addEventListener('afterprint', schaal);

function renderNieuw() {
  app().innerHTML = kop('Nieuwe opdracht', '#') + `<main class="inhoud"><section class="kaart"><h2>Opdracht klaarzetten voor de inmeter</h2>
    <div class="raster2">
      <label class="veld"><span>Naam klant *</span><input id="n-naam"></label>
      <label class="veld"><span>Gewenste inmeetdatum</span><input id="n-datum" type="date"></label>
    </div>
    <label class="veld"><span>Adres * <small>– typ straat + huisnummer of postcode + huisnummer</small></span><input id="n-adres" autocomplete="off" oninput="zoekAdres(this.value)"></label>
    <div id="adres-suggesties" class="chips"></div>
    <div class="raster2">
      <label class="veld"><span>Postcode en plaats</span><input id="n-pc"></label>
      <label class="veld"><span>Telefoon</span><input id="n-tel" type="tel"></label>
      <label class="veld"><span>E-mail</span><input id="n-mail" type="email"></label>
      <label class="veld"><span>Aangenomen door</span><input id="n-door" value="${esc(W.naam || '')}"></label>
    </div>
    <label class="veld"><span>Wens van de klant</span><textarea id="n-wens" rows="4" placeholder="bijv. duette slaapkamer, kleur 0260; vitrage woonkamer"></textarea></label>
    <div class="acties"><button class="knop primair" onclick="eenKeer(this, maakOpdracht)">Opdracht klaarzetten</button></div>
  </section></main>`;
}
let adresTimer = null;
function zoekAdres(q) {
  clearTimeout(adresTimer); const box = $('#adres-suggesties');
  if (!/\d/.test(q) || q.trim().length < 5) { box.innerHTML = ''; return; }
  adresTimer = setTimeout(async () => {
    try {
      const url = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?' + new URLSearchParams({ q, fq: 'type:adres', rows: '5', lat: '52.37', lon: '4.89', fl: 'weergavenaam,straatnaam,huis_nlt,postcode,woonplaatsnaam' });
      const docs = ((await (await fetch(url)).json()).response || {}).docs || [];
      box.innerHTML = docs.map((d, i) => `<button type="button" data-i="${i}">${esc(d.weergavenaam)}</button>`).join('') || '<small>Geen adres gevonden</small>';
      $$('button', box).forEach(b => b.onclick = () => { const d = docs[b.dataset.i]; const pc = String(d.postcode || ''); $('#n-adres').value = `${d.straatnaam} ${d.huis_nlt}`; $('#n-pc').value = `${pc.slice(0, 4)} ${pc.slice(4)} ${d.woonplaatsnaam}`.trim(); box.innerHTML = ''; });
    } catch (e) { box.innerHTML = '<small>Adres opzoeken lukt nu niet</small>'; }
  }, 450);
}
async function maakOpdracht() {
  const v = id => $(id).value.trim();
  const o = { naam: v('#n-naam'), adres: v('#n-adres'), pcplaats: v('#n-pc'), telefoon: v('#n-tel'), email: v('#n-mail'), datum: v('#n-datum'), door: v('#n-door'), wens: $('#n-wens').value.trim() };
  if (!o.naam || !o.adres) return melding('Naam en adres zijn verplicht.', true);
  W.naam = o.door; bewaar();
  try { await post({ action: 'w_opdracht', opdracht: o }); melding('Opdracht klaargezet. De inmeter ziet hem bij de volgende synchronisatie.'); filter = 'meten'; location.hash = ''; await haalLijst(); }
  catch (e) { melding('Klaarzetten mislukt: ' + e.message, true); }
}

route();
if (W.url && W.ww) haalLijst();
