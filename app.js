/* =========================================================
   Edison Meetformulier – app (v2)
   Offline-first: data in localStorage + foto's in IndexedDB,
   synchroniseert met Google Sheet via Apps Script.
   Producten/kleuren/opties = catalogus uit de master-offerte.
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
const DB = { klanten: laad('emf_klanten', {}), inst: laad('emf_inst', null) };
if (!DB.inst) DB.inst = { waarden: { ...CONFIG.standaard }, aftrekPerType: kopie(CONFIG.aftrekPerType), url: '', sleutel: '', updated: 0, syncedAt: 0, laatstePull: 0 };
for (const [k, v] of Object.entries(CONFIG.standaard)) if (DB.inst.waarden[k] === undefined) DB.inst.waarden[k] = v;
for (const [k, v] of Object.entries(CONFIG.aftrekPerType)) if (DB.inst.aftrekPerType[k] === undefined) DB.inst.aftrekPerType[k] = v;

let CAT = laad('emf_cat', null) || CATALOGUS_STANDAARD;

function bewaarLokaal() {
  try { localStorage.setItem('emf_klanten', JSON.stringify(DB.klanten)); localStorage.setItem('emf_inst', JSON.stringify(DB.inst)); }
  catch (e) { melding('Opslaan op dit toestel mislukt: ' + e.message, true); }
}
function gewijzigd(k) { k.updated = Date.now(); bewaarLokaal(); planSync(); updateBadge(); }
function instGewijzigd() { DB.inst.updated = Date.now(); bewaarLokaal(); planSync(); updateBadge(); }

const fotoDB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('emf', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fotos', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('fotos', mode); const req = fn(t.objectStore('fotos')); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
  return { put: o => tx('readwrite', s => s.put(o)), get: id => tx('readonly', s => s.get(id)), del: id => tx('readwrite', s => s.delete(id)) };
})();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- model ---------- */
const nieuweKlant = () => ({ id: uid(), naam: '', adres: '', pcplaats: '', datum: vandaag(), offertenr: '', telefoon: '', email: '', opmerking: '', ruimtes: [], updated: Date.now(), syncedAt: 0, verwijderd: false });
const nieuweRuimte = naam => ({ id: uid(), naam: naam || '', ramen: [] });
const nieuwRaam = nr => ({ id: uid(), nr: String(nr), omschrijving: '', ondergrond: '', kozijndiepte: '', obstakels: [], fotos: [], opmerking: '', producten: [] });
const gordStandaard = () => ({ laag: '', indeling: 'gelijk', links: '', schuift: '', afwerking: 'boven', basis: 'kort', correctie: '', vanaf: 'Plafond', stelstuk: 'Stel', plooi: 'Enkele plooi', halvebanen: 'Nee', confectie: 'Automatisch', loodkoord: 'Nee', voering: '', voeringkleur: '', voeren: 'Vast', instomen: 'Nee', rapport: '', rails: 'Geen', runners: '', bochten: '', inhangen: 'Ja' });
const nieuwProduct = () => ({ id: uid(), cat: '', art: '', kleurnr: '', kleur: '', pk: '', opties: ['', '', ''], plaatsen: 'Ja', aantal: 1, montage: 'in', bevestiging: '', montagehoogte: '', zijde: '', B: ['', '', ''], H: ['', '', ''], par: {}, hand: { B: '', H: '', reden: '' }, gord: gordStandaard(), opmerking: '' });

/* ---------- catalogus ---------- */
const catModus = c => (CAT.categorieen.find(x => x.naam === c) || {}).modus || '';
const artDef = p => (CAT.artikelen[p.cat] || []).find(a => a.a === p.art) || null;
function prodDef(p) {
  if (!p || !p.cat || !p.art || !artDef(p)) return null;
  const m = catModus(p.cat);
  return { naam: p.art, cat: p.cat, modus: m, calc: m === 'gordijn' ? 'stof' : m === 'zon' ? 'zon' : 'los', art: artDef(p) };
}
const normKleur = nr => { const s = String(nr || '').trim(); return /^\d{1,3}$/.test(s) ? s.padStart(4, '0') : s; };
function kleurInfo(p) {
  const a = artDef(p); if (!a || !a.fam || !p.kleurnr) return null;
  const nr = normKleur(p.kleurnr);
  const k = (CAT.kleuren[a.fam] || {})[nr];
  return k ? { nr, kwaliteit: k[0], pk: k[1], plisse: k[2] } : { nr, fout: true };
}
function maxTabel(p) {
  const a = artDef(p); if (!a || !a.mp || !CAT.max) return null;
  const m = CAT.max[a.mp]; if (!m) return null;
  const pk = effPk(p);
  return m['*'] || m[pk] || null;
}
// bediening: maximaal één hoofdbediening; zijde verplicht bij handbediening met ketting/koord/stang
const isBediening = o => /smartcord|literise|softraise|kettingbediening|eindloos koord|^handgreep|trekkoord|gemotoriseerd|slingerstang/i.test(o);
const isMotor = o => /gemotoriseerd/i.test(o);
const vraagtZijde = o => /smartcord|kettingbediening|eindloos koord|trekkoord|slingerstang|bedieningsstang/i.test(o);
const isTDBU = o => /tdbu|top down/i.test(o);
// opties die om een zijde vragen; bij TDBU zit SmartCord aan beide kanten, dan telt SmartCord niet mee
const zijdeOpties = p => { const o = gekozenOpties(p), tdbu = o.some(isTDBU); return o.filter(x => vraagtZijde(x) && !(tdbu && /smartcord/i.test(x))); };
function zijdeVerplicht(p) { const o = gekozenOpties(p); return !o.some(isMotor) && !/powerview/i.test(p.art || '') && zijdeOpties(p).length > 0; }
const optieLijst = p => { const a = artDef(p); return a && a.og ? (CAT.opties[a.og] || []) : []; };
const gekozenOpties = p => (p.opties || []).filter(Boolean);
const effPk = p => { if (p.pk) return p.pk; const k = kleurInfo(p); return k && !k.fout ? k.pk : ''; };

/* ---------- gordijnen ---------- */
const AFWERKING = { boven: 'Net boven de grond', grond: 'Op de grond', vensterbank: 'Tot de vensterbank', vrij: 'Vrij (in overleg)' };
function gordMigreer(g) {
  if (!g.indeling) g.indeling = g.stelstuk === 'Stuk' ? 'stuk' : 'gelijk';
  if (!g.afwerking) g.afwerking = 'boven';
  if (!g.basis) g.basis = 'kort';
  if (!g.vanaf) g.vanaf = 'Plafond';
  if (g.laag === undefined) g.laag = '';
  return g;
}
function raamVan(p) {
  for (const k of Object.values(DB.klanten)) for (const ru of k.ruimtes) for (const w of ru.ramen) if (w.producten.some(q => q.id === p.id)) return w;
  return null;
}
const gordijnenOpRaam = p => { const w = raamVan(p); return w ? w.producten.filter(q => q.cat && catModus(q.cat) === 'gordijn' && q.art) : []; };
function tweedeLaag(p) { return (p.gord.laag === 'Vitrage') && gordijnenOpRaam(p).some(q => q.id !== p.id && q.gord && q.gord.laag === 'Overgordijn'); }

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
  const n = parseFloat(t);
  if (isNaN(n)) return null;
  if (!eenheid && t.includes('.') && n < 20) f = 1000; // laser in meters zonder eenheid
  return Math.round(n * f);
}
const metingen = arr => (arr || []).map(parseMaat).filter(n => n > 0);

function stdWaarde(p, key) {
  if (key === 'aftrekB' || key === 'aftrekH') {
    const d = key === 'aftrekB' ? 'B' : 'H';
    const tru = gekozenOpties(p).some(o => /trufit/i.test(o));
    for (const sleutel of [tru ? 'TruFit' : null, p.cat]) {
      const a = sleutel && DB.inst.aftrekPerType[sleutel];
      if (a && a[d] !== '' && a[d] != null) return Number(a[d]);
    }
  }
  return Number(DB.inst.waarden[key]) || 0;
}
function eff(p, key) {
  const std = stdWaarde(p, key); const v = p.par[key];
  if (v === '' || v === null || v === undefined) return { v: std, afw: false, std };
  const n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? { v: std, afw: false, std } : { v: n, afw: n !== std, std };
}

/* Kernberekening: strakke maat -> bestelmaat + controles */
function bereken(p) {
  const t = prodDef(p);
  if (!t) return null;
  const r = { t, sB: null, sH: null, B: null, H: null, uitB: '', uitH: '', params: [], hand: { B: false, H: false }, waarsch: [], afwijkend: [] };
  // kleur / prijsklasse
  if (t.art.fam) {
    const k = kleurInfo(p);
    if (!p.kleurnr) r.waarsch.push('Kleurnummer ontbreekt.');
    else if (k.fout && !p.pk) r.waarsch.push(`Kleurnummer ${k.nr} bestaat niet voor ${t.naam}.`);
  }
  const pk = effPk(p);
  if (pk && t.art.pk && !t.art.pk.split(',').map(s => s.trim()).includes(pk)) r.waarsch.push(`${pk} is niet leverbaar voor ${t.naam} (wel: ${t.art.pk}).`);
  if (t.modus === 'zon') {
    const o = gekozenOpties(p), bed = o.filter(isBediening);
    if (new Set(o).size < o.length) r.waarsch.push('Dezelfde optie is twee keer gekozen.');
    if (bed.length > 1) r.waarsch.push(`Meer dan één bediening gekozen (${bed.join(' + ')}). Kies er één.`);
    else if (o.some(isMotor) && o.some(vraagtZijde)) r.waarsch.push(`Motor gecombineerd met handbediening (${o.filter(vraagtZijde).join(', ')}).`);
    if (zijdeVerplicht(p) && !p.zijde) r.waarsch.push(`Bedieningszijde ontbreekt (verplicht bij ${zijdeOpties(p).join(', ')}).`);
  }
  if (p.overgenomen) r.waarsch.push(`Overgenomen van ${p.overgenomen} – nog niet bevestigd.`);
  if (t.art.let && t.modus === 'zon') r.info2 = t.art.let;
  if (t.calc === 'los') return r;

  const mB = metingen(p.B), mH = metingen(p.H);
  const sB = mB.length ? Math.min(...mB) : null, sH = mH.length ? Math.min(...mH) : null;
  r.sB = sB; r.sH = sH;
  if (t.calc === 'stof') {
    const g = gordMigreer(p.gord);
    const ov = eff(p, 'overlap');
    r.params = [['overlap', 'Overlap', ov]];
    if (sB != null) { r.B = sB + ov.v; r.uitB = `${sB} + ${ov.v} overlap = ${r.B}`; }
    const lang = g.afwerking === 'grond' || (g.afwerking === 'vrij' && g.basis === 'lang');
    const basisH = mH.length ? (lang ? Math.max(...mH) : Math.min(...mH)) : null;
    r.sH = basisH;
    if (basisH != null) {
      let corr = 0, uit = `${lang ? 'langste' : 'kortste'} ${basisH}`;
      if (g.afwerking === 'boven') { const e = eff(p, 'vloerafstand'); r.params.push(['vloerafstand', 'Net boven de grond (−)', e]); corr = -e.v; uit += ` − ${e.v} boven de grond`; }
      else if (g.afwerking === 'vensterbank') { const e = eff(p, 'vensterbank'); r.params.push(['vensterbank', 'Boven vensterbank (−)', e]); corr = -e.v; uit += ` − ${e.v} boven vensterbank`; }
      else if (g.afwerking === 'grond') { const e = eff(p, 'opGrond'); r.params.push(['opGrond', 'Op de grond (+)', e]); corr = e.v; uit += ` + ${e.v} op de grond`; }
      else { const c = parseInt(String(g.correctie).replace(/\s/g, ''), 10); if (isNaN(c)) r.waarsch.push('Vrije afwerking: vul de correctie in mm in (bijv. +100 of −15).'); else { corr = c; uit += ` ${c < 0 ? '−' : '+'} ${Math.abs(c)} vrij`; } }
      if ((g.afwerking === 'boven' || g.afwerking === 'vensterbank') && tweedeLaag(p)) { const e = eff(p, 'vitrageExtra'); r.params.push(['vitrageExtra', 'Extra vitrage (−)', e]); corr -= e.v; uit += ` − ${e.v} tweede laag`; }
      r.H = basisH + corr; r.uitH = `${uit} = ${r.H}`;
    }
    if (g.indeling === 'stuk' && !g.schuift) r.waarsch.push('Stuk: kies de schuifrichting.');
    if (g.indeling === 'ongelijk') {
      const l = parseMaat(g.links);
      if (!(l > 0)) r.waarsch.push('Ongelijke delen: vul de breedte van het linkerdeel in.');
      else if (r.B != null && l >= r.B) r.waarsch.push(`Linkerdeel (${l}) is breder dan het hele gordijn (${r.B}).`);
      else if (r.B != null) r.delen = [l, r.B - l];
    }
    if (gordijnenOpRaam(p).length > 1 && !g.laag) r.waarsch.push('Meerdere gordijnen op dit raam: kies de laag (overgordijn / vitrage).');
  } else if (p.montage === 'in') {
    const aB = eff(p, 'aftrekB'), aH = eff(p, 'aftrekH');
    r.params = [['aftrekB', 'Aftrek breedte', aB], ['aftrekH', 'Aftrek hoogte', aH]];
    if (sB != null) { r.B = sB - aB.v; r.uitB = `${sB} − ${aB.v} aftrek = ${r.B}`; }
    if (sH != null) { r.H = sH - aH.v; r.uitH = `${sH} − ${aH.v} aftrek = ${r.H}`; }
  } else {
    const oB = eff(p, 'overmaatB'), oH = eff(p, 'overmaatH');
    r.params = [['overmaatB', 'Overmaat breedte', oB], ['overmaatH', 'Overmaat hoogte', oH]];
    if (sB != null) { r.B = sB + oB.v; r.uitB = `${sB} + ${oB.v} overmaat = ${r.B}`; }
    if (sH != null) { r.H = sH + oH.v; r.uitH = `${sH} + ${oH.v} overmaat = ${r.H}`; }
  }
  r.params.forEach(([k, l, e]) => { if (e.afw) r.afwijkend.push(`${l} ${e.v} (std ${e.std})`); });
  ['B', 'H'].forEach(k => {
    const hv = parseMaat(p.hand && p.hand[k]);
    if (hv > 0) { const oud = r[k]; r[k] = hv; r.hand[k] = true; r['uit' + k] = `HANDMATIG ${hv}` + (oud != null ? ` (berekend was ${oud})` : ''); }
  });
  if ((r.hand.B || r.hand.H) && !(p.hand.reden || '').trim()) r.waarsch.push('Reden voor handmatige bestelmaat ontbreekt.');
  if (!(parseMaat(p.montagehoogte) > 0)) r.waarsch.push('Montagehoogte ontbreekt (verplicht).');
  [['Breedte', mB], ['Hoogte', mH]].forEach(([naam, m]) => {
    m.forEach(v => { if (v < 200) r.waarsch.push(`${naam} ${v} mm is erg klein. Is dit in cm gemeten?`); if (v > 8000) r.waarsch.push(`${naam} ${v} mm is erg groot. Klopt dit?`); });
    if (m.length > 1 && Math.max(...m) - Math.min(...m) > 5) {
      const d = Math.max(...m) - Math.min(...m);
      if (t.calc === 'stof' && naam === 'Hoogte') r.info4 = `Hoogtes verschillen ${d} mm – vloer of plafond loopt af. ${r.uitH.startsWith('langste') ? 'Langste' : 'Kortste'} maat gebruikt.`;
      else r.waarsch.push(`${naam}: metingen verschillen ${d} mm – scheef kozijn, controleren. Kleinste maat gebruikt.`);
    }
  });
  const tab = t.calc === 'zon' ? maxTabel(p) : null;
  if (tab && r.B != null && r.H != null) {
    const maxH = tab[tab.length - 1][0], maxB = Math.max(...tab.map(x => x[1]));
    const stap = tab.find(x => x[0] >= r.H);
    if (!stap) r.waarsch.push(`Te hoog: ${t.naam} kan tot ${maxH} mm hoog (bestelmaat ${r.H}).`);
    else if (r.B > stap[1]) r.waarsch.push(stap[1] < maxB ? `Te breed bij deze hoogte: max ${stap[1]} mm breed bij ${r.H} mm hoog (bestelmaat ${r.B}).` : `Te breed: ${t.naam} kan tot ${stap[1]} mm breed (bestelmaat ${r.B}).`);
  } else if (tab && t.art.fam && !effPk(p) && r.B != null) r.info3 = 'Maximale maat wordt gecontroleerd zodra het kleurnummer bekend is.';
  if (r.B != null) optieLijst(p).forEach(o => { if (o.max && gekozenOpties(p).includes(o.o) && r.B > o.max) r.waarsch.push(`${o.o} kan tot ${o.max} mm breed (bestelmaat ${r.B}).`); });
  if (t.calc === 'zon' && p.montage === 'in' && (mB.length === 1 || mH.length === 1)) r.info = '1 meting – 3-puntsmeting aanbevolen';
  return r;
}
const fmtMaat = r => !r ? '—' : r.t.calc === 'los' ? '' : `${r.B ?? '—'} × ${r.H ?? '—'}`;
const fmtStrak = r => !r ? '—' : r.t.calc === 'los' ? '' : `${r.sB ?? '—'} × ${r.sH ?? '—'}`;
function kleurTekst(p) {
  const k = kleurInfo(p);
  if (k && !k.fout) return `${k.nr} ${k.kwaliteit}`;
  return [p.kleurnr, p.kleur].filter(Boolean).join(' ');
}
function uitvoeringTekst(p) {
  const t = prodDef(p); if (!t) return '';
  if (t.calc === 'stof') {
    const g = gordMigreer(p.gord), r = bereken(p);
    const ind = g.indeling === 'stuk' ? 'stuk' + (g.schuift ? ', schuift ' + g.schuift.toLowerCase() : '') : g.indeling === 'ongelijk' ? 'stel ongelijk' + (r && r.delen ? ` (links ${r.delen[0]} / rechts ${r.delen[1]} mm)` : '') : 'stel';
    const afw = g.afwerking === 'vrij' ? `vrij: ${g.basis === 'lang' ? 'langste' : 'kortste'} ${g.correctie || ''} mm` : AFWERKING[g.afwerking].toLowerCase();
    return [g.laag && g.laag.toLowerCase(), ind, g.plooi, afw, 'gemeten vanaf ' + g.vanaf.toLowerCase(), g.voering && 'voering ' + g.voering + (g.voeringkleur ? ' ' + g.voeringkleur : ''), g.voering && g.voeren === 'Los' && 'los gevoerd', g.loodkoord === 'Ja' && 'loodkoord', g.instomen === 'Ja' && 'instomen', g.rails !== 'Geen' && g.rails, g.runners, g.bochten && g.bochten + ' bocht(en)'].filter(Boolean).join(' · ');
  }
  const kp = kleurInfo(p);
  return [kp && !kp.fout && kp.plisse && 'plissé ' + kp.plisse + ' mm', ...gekozenOpties(p), p.zijde && 'bediening ' + p.zijde.toLowerCase()].filter(Boolean).join(' · ');
}

/* ---------- router ---------- */
let huidigeKlant = null;
window.addEventListener('hashchange', route);
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  const y = window.scrollY, zelfde = route._laatst === location.hash; route._laatst = location.hash;
  if (h[0] === 'k' && DB.klanten[h[1]]) {
    huidigeKlant = DB.klanten[h[1]];
    if (h[2] === 'raam') renderRaam(huidigeKlant, h[3]);
    else if (h[2] === 'overzicht') renderOverzicht(huidigeKlant);
    else if (h[2] === 'afronden') renderAfronden(huidigeKlant);
    else renderKlant(huidigeKlant);
  } else {
    huidigeKlant = null;
    if (h[0] === 'instellingen') renderInst();
    else if (h[0] === 'leeg') renderLeeg();
    else renderLijst();
  }
  window.scrollTo(0, zelfde ? y : 0);
}
const app = () => $('#app');

/* ---------- binding ---------- */
function getPad(o, pad) { return pad.split('.').reduce((a, k) => a == null ? a : a[k], o); }
function zetPad(o, pad, v) { const d = pad.split('.'); const last = d.pop(); const doel = d.reduce((a, k) => a[k], o); doel[last] = v; }
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.bind && huidigeKlant) {
    zetPad(huidigeKlant, el.dataset.bind, el.type === 'checkbox' ? el.checked : el.value);
    gewijzigd(huidigeKlant);
    if (el.dataset.live !== undefined) liveUpdate(el);
    if (el.dataset.adres !== undefined) zoekAdres(el.value);
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
    const arr = getPad(huidigeKlant, pad); const i = arr.indexOf(waarde);
    if (el.checked && i < 0) arr.push(waarde); if (!el.checked && i >= 0) arr.splice(i, 1);
    gewijzigd(huidigeKlant);
  }
  if (el.dataset.meet !== undefined && el.value.trim()) {
    const n = parseMaat(el.value);
    if (n != null && String(n) !== el.value) { el.value = n; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  if (el.dataset.kleur !== undefined && el.value.trim()) {
    const n = normKleur(el.value); if (n !== el.value) { el.value = n; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  if (el.dataset.cat !== undefined) { const [w, pi] = prodVan(el.dataset.cat); const p = w.producten[pi]; p.art = ''; p.opties = ['', '', '']; p.pk = ''; gewijzigd(huidigeKlant); }
  if (el.dataset.rerender !== undefined) route();
});
document.addEventListener('keydown', e => {
  const el = e.target;
  if (e.key === 'Enter' && el.dataset.meet !== undefined) {
    e.preventDefault(); el.dispatchEvent(new Event('change', { bubbles: true }));
    const alle = $$('[data-meet]'); const i = alle.indexOf(el);
    if (alle[i + 1]) alle[i + 1].focus(); else el.blur();
  }
});
function liveUpdate(el) {
  const kaart = el.closest('[data-prod]'); if (!kaart) return;
  const [w, pi] = prodVan(kaart.dataset.prod); const p = w.producten[pi];
  const res = $('.resultaat', kaart); if (res) res.innerHTML = resultaatHTML(p);
  // laag van een gordijn beïnvloedt de vitrage op hetzelfde raam
  if (el.dataset.bind && /\.gord\.laag$/.test(el.dataset.bind)) $$('[data-prod]').forEach(kk => { if (kk !== kaart) { const [w2, pi2] = prodVan(kk.dataset.prod); const r2 = $('.resultaat', kk); if (r2) r2.innerHTML = resultaatHTML(w2.producten[pi2]); } });
  $$('[data-bind$=".gord.laag"]', kaart).forEach(sel => sel.classList.toggle('verplicht', sel.classList.contains('verplicht') && !p.gord.laag));
  $$('[data-bind$=".gord.links"]', kaart).forEach(inp => inp.classList.toggle('verplicht', !(parseMaat(p.gord.links) > 0)));
  const ki = $('.kleur-info', kaart); if (ki) ki.innerHTML = kleurInfoHTML(p);
  $$('[data-par]', kaart).forEach(inp => inp.classList.toggle('afwijkend', eff(p, inp.dataset.par).afw));
  $$('[data-zijde]', kaart).forEach(sel => sel.classList.toggle('verplicht', zijdeVerplicht(p) && !p.zijde));
  $$('[data-zijde-ster]', kaart).forEach(st => st.hidden = !zijdeVerplicht(p));
  $$('[data-mh]', kaart).forEach(inp => inp.classList.toggle('verplicht', !(parseMaat(p.montagehoogte) > 0)));
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
function telProducten(k) { return k.ruimtes.reduce((a, r) => a + r.ramen.reduce((b, w) => b + w.producten.length, 0), 0); }
function renderLijst() {
  const lijst = Object.values(DB.klanten).filter(k => !k.verwijderd).sort((a, b) => (b.datum || '').localeCompare(a.datum || '') || b.updated - a.updated);
  app().innerHTML = kop('Meetformulier') + `
  <main class="inhoud">
    <div class="acties">
      <button class="knop primair" onclick="maakKlant()">+ Nieuwe meting</button>
      <input type="search" placeholder="Zoek klant…" oninput="filterLijst(this.value)" class="zoek">
    </div>
    <ul class="lijst" id="klantlijst">
      ${lijst.map(k => `<li data-zoek="${esc((k.naam + ' ' + k.adres + ' ' + k.pcplaats + ' ' + k.offertenr).toLowerCase())}">
        <a href="#/k/${k.id}"><strong>${esc(k.naam || '(geen naam)')}</strong>
        <span>${esc(k.adres)} ${esc(k.pcplaats)}</span>
        <small>${datumNL(k.datum)}${k.offertenr ? ' · offerte ' + esc(k.offertenr) : ''} · ${k.ruimtes.length} ruimtes · ${telProducten(k)} producten · ${statusTekst(k)} ${k.updated > k.syncedAt ? '· <em class="niet-sync">niet gesynchroniseerd</em>' : ''}</small></a></li>`).join('') || '<li class="leeg">Nog geen metingen.</li>'}
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
      </div>
      <label class="veld"><span>Adres <small>– typ straat + huisnummer of postcode + huisnummer</small></span><input data-bind="adres" data-adres value="${esc(k.adres)}" autocomplete="off"></label>
      <div id="adres-suggesties" class="chips"></div>
      <div class="raster2">
        ${veld('Postcode en woonplaats', 'pcplaats', k.pcplaats)}
        ${veld('Offertenummer', 'offertenr', k.offertenr, 'text', 'inputmode="numeric"')}
        ${veld('Telefoon', 'telefoon', k.telefoon, 'tel')}
        ${veld('E-mail', 'email', k.email, 'email')}
      </div>
      <label class="veld"><span>Opmerking</span><textarea data-bind="opmerking" rows="2">${esc(k.opmerking)}</textarea></label>
    </details>
    ${montageKaart(k)}

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
            <span>${w.producten.map(p => { const r = bereken(p); return r ? `${esc(r.t.naam)} <b>${r.t.calc === 'los' ? p.aantal + '×' : fmtMaat(r)}</b>${r.waarsch.length ? ' <em class="fout">⚠</em>' : ''}` : '<em>product kiezen</em>'; }).join(' · ') || '<em>nog geen product</em>'}</span>
          </a></li>`).join('')}
        </ul>
        <button class="knop" onclick="maakRaam(${ri})">+ Raam</button>
      </section>`).join('')}

    <section class="kaart">
      <strong>Ruimte toevoegen</strong>
      <div class="chips">${RUIMTE_SNEL.map(n => `<button onclick="maakRuimte('${n}')">${n}</button>`).join('')}<button onclick="maakRuimte('')">Anders…</button></div>
    </section>

    <div class="acties onder">
      <a class="knop primair" href="#/k/${k.id}/afronden">Meting afronden</a>
      <a class="knop" href="#/k/${k.id}/overzicht">Overzicht &amp; print</a>
      <button class="knop" onclick="kopieerExcel()">Kopieer voor Excel</button>
      <button class="knop gevaar" onclick="verwijderKlant()">Meting verwijderen</button>
    </div>
  </main>`;
  updateBadge();
}
function veld(label, pad, waarde, type = 'text', extra = '') {
  return `<label class="veld"><span>${label}</span><input type="${type}" data-bind="${pad}" value="${esc(waarde)}" ${extra}></label>`;
}

/* adres opzoeken via PDOK (gratis, Kadaster) */
let adresTimer = null, adresVraag = 0;
function zoekAdres(q) {
  clearTimeout(adresTimer);
  const box = $('#adres-suggesties'); if (!box) return;
  if (!/\d/.test(q) || q.trim().length < 5) { box.innerHTML = ''; return; }
  adresTimer = setTimeout(async () => {
    const nr = ++adresVraag;
    try {
      const url = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?' + new URLSearchParams({ q, fq: 'type:adres', rows: '5', lat: CONFIG.adres.lat, lon: CONFIG.adres.lon, fl: 'weergavenaam,straatnaam,huis_nlt,postcode,woonplaatsnaam' });
      const j = await (await fetch(url)).json();
      if (nr !== adresVraag) return;
      const docs = (j.response && j.response.docs) || [];
      box.innerHTML = docs.map((d, i) => `<button type="button" data-i="${i}">${esc(d.weergavenaam)}</button>`).join('') || '<small>Geen adres gevonden</small>';
      $$('button', box).forEach(b => b.onclick = () => {
        const d = docs[b.dataset.i]; const k = huidigeKlant;
        k.adres = `${d.straatnaam} ${d.huis_nlt}`;
        const pc = String(d.postcode || ''); k.pcplaats = `${pc.slice(0, 4)} ${pc.slice(4)} ${d.woonplaatsnaam}`.trim();
        $('[data-bind=adres]').value = k.adres; $('[data-bind=pcplaats]').value = k.pcplaats;
        box.innerHTML = ''; gewijzigd(k);
      });
    } catch (e) { box.innerHTML = navigator.onLine ? '<small>Adres opzoeken lukt nu niet</small>' : '<small>Offline – vul postcode zelf in</small>'; }
  }, 450);
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
  const w = nieuwRaam(ru.ramen.length + 1);
  // handig: vorig product als startpunt (zelfde product/kleur, maten leeg)
  // vorig raam in deze ruimte, anders het laatste raam uit een eerdere ruimte
  let vorige = null, bron = '';
  if (ru.ramen.length) { const w0 = ru.ramen[ru.ramen.length - 1]; vorige = w0.producten[0]; bron = `${ru.naam} raam ${w0.nr}`; }
  for (let i = ri - 1; !vorige && i >= 0; i--) { const rr = k.ruimtes[i].ramen; if (rr.length) { vorige = rr[rr.length - 1].producten[0]; bron = `${k.ruimtes[i].naam} raam ${rr[rr.length - 1].nr}`; } }
  const p = nieuwProduct();
  if (vorige) Object.assign(p, kopie({ cat: vorige.cat, art: vorige.art, kleurnr: vorige.kleurnr, kleur: vorige.kleur, pk: vorige.pk, opties: vorige.opties, montage: vorige.montage, bevestiging: vorige.bevestiging, zijde: vorige.zijde, gord: vorige.gord || gordStandaard() }));
  if (vorige && vorige.art) p.overgenomen = bron;
  w.producten.push(p);
  ru.ramen.push(w); gewijzigd(k); location.hash = `#/k/${k.id}/raam/${w.id}`;
}
function verwijderKlant() { if (!confirm('Deze hele meting verwijderen?')) return; huidigeKlant.verwijderd = true; gewijzigd(huidigeKlant); location.hash = '#/'; }

/* ---------- Montage-info (voor de plaatsers) ---------- */
const MONTAGE = [
  ['verdieping', 'Verdieping', ['Souterrain', 'Begane grond', '1e', '2e', '3e', '4e', '5e of hoger'], false],
  ['lift', 'Lift', ['Ja', 'Nee'], false],
  ['trap', 'Trap', ['Normaal', 'Steil / smal'], false],
  ['parkeren', 'Parkeren', ['Voor de deur', 'Vergunning / kaart nodig', 'Betaald parkeren', 'Eigen terrein', 'Lastig – ver lopen'], false],
  ['boren', 'Boren toegestaan', ['Ja', 'Nee', 'Navragen VvE / verhuurder'], false],
  ['stroom', 'Stroom voor motor', ['n.v.t.', 'Aanwezig', 'Nog regelen'], false],
  ['ladder', 'Ladder / steiger', ['Huishoudtrap', 'Ladder tot 3 m', 'Grote ladder', 'Steiger / hoogwerker'], false]
];
const hoogsteMh = k => Math.max(0, ...k.ruimtes.flatMap(r => r.ramen.flatMap(w => w.producten.map(p => parseMaat(p.montagehoogte) || 0))));
function montageKaart(k) {
  const m = k.montage || (k.montage = {});
  const open = MONTAGE.filter(([key, , , verpl]) => verpl && !m[key]).length;
  const mh = hoogsteMh(k);
  return `<details class="kaart">
    <summary>Montage-info voor de plaatsers <small>(optioneel)</small></summary>
    <div class="raster2">
      ${MONTAGE.map(([key, label, opties, verpl]) => `<label class="veld"><span>${label}${verpl ? ' <b class="verplicht-ster">*</b>' : ''}</span>${select('montage.' + key, opties, m[key] || '', verpl && !m[key] ? 'class="verplicht"' : '')}</label>`).join('')}
      <label class="veld"><span>Contact op montagedag</span><input data-bind="montage.contact" value="${esc(m.contact || '')}" placeholder="naam en telefoon"></label>
      <label class="veld"><span>Toegang / sleutel</span><input data-bind="montage.toegang" value="${esc(m.toegang || '')}" placeholder="bijv. sleutel bij buren, code"></label>
    </div>
    ${mh ? `<p class="uitleg">Hoogste montagehoogte in deze meting: <b>${mh} mm</b>${mh > 2800 ? ' – denk aan een grote ladder' : ''}.</p>` : ''}
    <label class="veld"><span>Bijzonderheden montage</span><textarea data-bind="montage.bijz" rows="2">${esc(m.bijz || '')}</textarea></label>
  </details>`;
}
function montagePrint(k) {
  const m = k.montage || {}; const mh = hoogsteMh(k);
  const rijen = MONTAGE.filter(([key]) => m[key]).map(([key, label]) => [label, m[key]]);
  if (m.contact) rijen.push(['Contact montagedag', m.contact]);
  if (m.toegang) rijen.push(['Toegang', m.toegang]);
  if (mh) rijen.push(['Hoogste montagehoogte', mh + ' mm']);
  if (!rijen.length && !m.bijz) return '';
  return `<h2>Montage-info</h2><table class="gegevens montage">${rijen.reduce((h, r, i) => h + (i % 2 ? '' : '<tr>') + `<th>${esc(r[0])}</th><td>${esc(r[1])}</td>` + (i % 2 ? '</tr>' : ''), '')}${rijen.length % 2 ? '<th></th><td></td></tr>' : ''}</table>${m.bijz ? `<p>${esc(m.bijz).replace(/\n/g, '<br>')}</p>` : ''}`;
}

/* ---------- Meting afronden: alles nalopen ---------- */
function statusTekst(k) {
  if (!k.afgerond) return '<em class="open">open</em>';
  return k.updated - k.afgerond > 3000 ? '<em class="niet-sync">gewijzigd na afronden</em>' : `<em class="ok">✓ afgerond ${datumNL(new Date(k.afgerond).toISOString().slice(0, 10))}</em>`;
}
function controleer(k) {
  const fout = [], aandacht = [];
  const kl = `#/k/${k.id}`;
  if (!k.naam.trim()) fout.push(['Klantnaam ontbreekt', kl]);
  if (!k.adres.trim() || !k.pcplaats.trim()) fout.push(['Adres of postcode/plaats ontbreekt', kl]);
  if (!k.telefoon.trim() && !k.email.trim()) fout.push(['Geen telefoon en geen e-mail', kl]);
  const m = k.montage || {};
  if (m.boren === 'Navragen VvE / verhuurder') aandacht.push(['Boren nog navragen bij VvE / verhuurder', kl]);
  if (m.stroom === 'Nog regelen') aandacht.push(['Stroom voor motor moet nog geregeld worden', kl]);
  if (!k.ruimtes.length) fout.push(['Nog geen ruimtes', kl]);
  k.ruimtes.forEach(ru => {
    const rn = ru.naam || '(ruimte zonder naam)';
    if (!ru.naam.trim()) fout.push(['Ruimte zonder naam', kl]);
    if (!ru.ramen.length) aandacht.push([`${rn}: nog geen ramen`, kl]);
    ru.ramen.forEach(w => {
      const wl = `${kl}/raam/${w.id}`, wn = `${rn} · raam ${w.nr}`;
      if (!w.producten.length) fout.push([`${wn}: geen product`, wl]);
      if (!w.fotos.length) aandacht.push([`${wn}: geen foto`, wl]);
      w.producten.forEach((p, i) => {
        const r = bereken(p);
        if (!r) { fout.push([`${wn}: product ${i + 1} niet compleet`, wl]); return; }
        if (r.t.calc !== 'los' && (r.B == null || r.H == null)) fout.push([`${wn}: ${r.t.naam} – maten ontbreken`, wl]);
        r.waarsch.forEach(x => fout.push([`${wn}: ${r.t.naam} – ${x}`, wl]));
        if (r.info) aandacht.push([`${wn}: ${r.t.naam} – ${r.info}`, wl]);
        if (r.afwijkend.length) aandacht.push([`${wn}: ${r.t.naam} – afwijkend van standaard (${r.afwijkend.join(', ')})`, wl]);
      });
    });
  });
  const ex = exportRegels(k), L = CAT.limieten;
  if (ex.aantalInvoer > L.invoer) fout.push([`${ex.aantalInvoer} productregels – de offerte heeft er ${L.invoer}`, kl]);
  if (ex.aantalGord > L.gordijnen) fout.push([`${ex.aantalGord} gordijnregels – de offerte heeft er ${L.gordijnen}`, kl]);
  if (ex.aantalRuimtes > L.ruimtes) fout.push([`${ex.aantalRuimtes} ruimtes – de offerte heeft er ${L.ruimtes}`, kl]);
  if (!k.offertenr) aandacht.push(['Nog geen offertenummer', kl]);
  return { fout, aandacht };
}
function renderAfronden(k) {
  const { fout, aandacht } = controleer(k);
  const item = ([t, href]) => `<li><a href="${href}">${esc(t)}</a></li>`;
  app().innerHTML = kop('Meting afronden', '#/k/' + k.id) + `
  <main class="inhoud">
    ${fout.length ? `<section class="kaart fout-kaart"><h2>Moet nog (${fout.length})</h2><ul class="checklijst">${fout.map(item).join('')}</ul></section>`
                  : `<section class="kaart ok-kaart"><h2>✓ Alles compleet</h2><p>Geen ontbrekende gegevens gevonden.</p></section>`}
    ${aandacht.length ? `<section class="kaart let-kaart"><h2>Aandachtspunten (${aandacht.length})</h2><ul class="checklijst">${aandacht.map(item).join('')}</ul></section>` : ''}
    <div class="acties onder">
      <button class="knop primair" onclick="rondAf(${fout.length})">${fout.length ? 'Toch afronden' : '✓ Meting afronden'}</button>
      <a class="knop" href="#/k/${k.id}/overzicht">Overzicht &amp; print</a>
    </div>
  </main>`;
  updateBadge();
}
function rondAf(nFout) {
  if (nFout && !confirm(`Er staan nog ${nFout} punten open. Toch afronden?`)) return;
  const k = huidigeKlant; k.afgerond = Date.now(); gewijzigd(k); k.afgerond = k.updated; bewaarLokaal();
  melding('Meting afgerond.'); location.hash = '#/k/' + k.id;
}

/* ---------- Raam ---------- */
function zoekRaam(k, wid) {
  for (let ri = 0; ri < k.ruimtes.length; ri++) { const wi = k.ruimtes[ri].ramen.findIndex(w => w.id === wid); if (wi >= 0) return [ri, wi]; }
  return [-1, -1];
}
function renderRaam(k, wid) {
  const [ri, wi] = zoekRaam(k, wid);
  if (ri < 0) { location.hash = '#/k/' + k.id; return; }
  const ru = k.ruimtes[ri], w = ru.ramen[wi], pre = `ruimtes.${ri}.ramen.${wi}`;
  const volgende = ru.ramen[wi + 1];
  app().innerHTML = kop(`${ru.naam || 'Ruimte'} · Raam ${w.nr}`, '#/k/' + k.id) + `
  <main class="inhoud met-balk">
    ${w.producten.map((p, pi) => productKaart(p, `${pre}.producten.${pi}`, `${ri}.${wi}.${pi}`, pi)).join('')}
    <div class="acties"><button class="knop" onclick="maakProduct(${ri},${wi})">+ Product op dit raam</button></div>

    <details class="kaart" ${w.omschrijving || w.ondergrond || w.fotos.length || w.obstakels.length ? 'open' : ''}>
      <summary>Raam: omschrijving, ondergrond, foto's</summary>
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
    </details>

    <div class="acties">
      <button class="knop" onclick="kopieerRaam(${ri},${wi})">Raam dupliceren</button>
      <button class="knop gevaar" onclick="verwijderRaam(${ri},${wi})">Raam verwijderen</button>
    </div>
  </main>
  <nav class="balk no-print">
    <a class="knop primair" href="#/k/${k.id}">✓ Klaar</a>
    ${volgende ? `<a class="knop" href="#/k/${k.id}/raam/${volgende.id}">Raam ${esc(volgende.nr)} ›</a>` : `<button class="knop" onclick="maakRaam(${ri})">+ Volgend raam</button>`}
  </nav>`;
  laadFotos(); updateBadge();
}
function select(pad, opties, waarde, extra = '', leeg = '—') {
  return `<select data-bind="${pad}" ${extra}>${leeg !== null ? `<option value="">${leeg}</option>` : ''}${opties.map(o => `<option ${o === waarde ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
}
function productKaart(p, pre, sleutel, pi) {
  if (!p.gord) p.gord = gordStandaard();
  if (!p.opties || !Array.isArray(p.opties)) p.opties = ['', '', ''];
  const t = prodDef(p);
  const cats = CAT.categorieen.filter(c => c.modus !== 'los' || p.cat === c.naam);
  const overig = CAT.categorieen.filter(c => c.modus === 'los');
  const catSel = `<select data-bind="${pre}.cat" data-cat="${sleutel}" data-rerender class="type-select"><option value="">Kies productgroep…</option>
      <optgroup label="Producten">${cats.filter(c => c.modus !== 'los').map(c => `<option ${c.naam === p.cat ? 'selected' : ''}>${esc(c.naam)}</option>`).join('')}</optgroup>
      <optgroup label="Overig (arbeid, reparatie, vrije regel)">${overig.map(c => `<option ${c.naam === p.cat ? 'selected' : ''}>${esc(c.naam)}</option>`).join('')}</optgroup></select>`;
  const arts = CAT.artikelen[p.cat] || [];
  const artSel = p.cat ? `<label class="veld"><span>Artikel</span><select data-bind="${pre}.art" data-rerender class="type-select"><option value="">Kies…</option>${arts.map(a => `<option ${a.a === p.art ? 'selected' : ''}>${esc(a.a)}</option>`).join('')}</select></label>` : '';
  const banner = p.overgenomen ? `<div class="overgenomen">Overgenomen van <b>${esc(p.overgenomen)}</b>. Controleer product, kleur en opties.
      <div class="acties klein"><button class="mini" onclick="bevestigProduct('${sleutel}')">✓ Klopt</button><button class="mini gevaar" onclick="leegProduct('${sleutel}')">Leeg maken</button></div></div>` : '';
  const kop = `${banner}<div class="product-kop"><b>Product ${pi + 1}</b>${catSel}</div>${artSel}`;
  if (!t) return `<section class="kaart product" data-prod="${sleutel}">${kop}${p.cat && !p.art ? '' : ''}</section>`;

  const a = t.art;
  let blok = '';
  // kleur
  if (t.modus === 'zon') {
    blok += `<div class="raster2">
      ${a.fam ? `<label class="veld"><span>Kleurnummer</span><input data-kleur data-live data-bind="${pre}.kleurnr" value="${esc(p.kleurnr)}" inputmode="numeric" autocomplete="off" placeholder="bijv. 0260"></label>`
               : `<label class="veld"><span>Kleur</span><input data-bind="${pre}.kleur" value="${esc(p.kleur)}"></label>`}
      <label class="veld"><span>Prijsklasse ${a.fam ? '<small>(leeg = via kleurnummer)</small>' : ''}</span>${select(pre + '.pk', (a.pk || '').split(',').map(s => s.trim()).filter(Boolean), p.pk, 'data-live', a.fam ? 'automatisch' : '—')}</label>
    </div><div class="kleur-info">${kleurInfoHTML(p)}</div>`;

  } else if (t.modus === 'gordijn') {
    blok += `<label class="veld"><span>Kleur(nummer)</span><input data-bind="${pre}.kleur" value="${esc(p.kleur)}"></label>`;
  }
  // opties
  if (t.modus === 'zon') {
    const ol = optieLijst(p).map(o => o.o);
    if (ol.length) blok += `<div class="veld"><span>Opties (max. 3, komen op de offerte)</span><div class="raster3">${[0, 1, 2].map(i => select(`${pre}.opties.${i}`, ol, p.opties[i], 'data-live', `Optie ${i + 1}`)).join('')}</div></div>`;
  }
  if (t.modus === 'gordijn') {
    const g = gordMigreer(p.gord), gp = pre + '.gord', L = CAT.lijsten;
    const seg = (veld, opties, live) => `<div class="segment">${opties.map(([v, l]) => `<label><input type="radio" name="${veld.replace(/\./g, '_')}" value="${v}" data-bind="${veld}" ${live ? 'data-live' : 'data-rerender'} ${g[veld.split('.').pop()] === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>`;
    const meer = gordijnenOpRaam(p).length > 1;
    blok += `<div class="raster2">
      <label class="veld"><span>Laag${meer ? ' <b class="verplicht-ster">*</b>' : ''}</span>${select(gp + '.laag', ['Overgordijn', 'Vitrage', 'Inbetween'], g.laag, `data-live class="${meer && !g.laag ? 'verplicht' : ''}"`)}</label>
      <label class="veld"><span>Plooi</span>${select(gp + '.plooi', L.plooi, g.plooi, '', null)}</label>
    </div>
    <div class="veld"><span>Indeling</span>${seg(gp + '.indeling', [['gelijk', 'Stel gelijk'], ['ongelijk', 'Stel ongelijk'], ['stuk', 'Stuk']])}</div>
    ${g.indeling === 'ongelijk' ? `<label class="veld"><span>Breedte linkerdeel (mm) <b class="verplicht-ster">*</b> <small>rechterdeel = rest</small></span><input data-bind="${gp}.links" data-live value="${esc(g.links)}" inputmode="numeric" class="${parseMaat(g.links) > 0 ? '' : 'verplicht'}"></label>` : ''}
    ${g.indeling === 'stuk' ? `<div class="veld"><span>Schuift naar <b class="verplicht-ster">*</b></span>${seg(gp + '.schuift', [['Links', 'Links'], ['Rechts', 'Rechts']], true)}</div>` : ''}
    <div class="raster2">
      <label class="veld"><span>Afwerking onderkant</span><select data-bind="${gp}.afwerking" data-rerender>${Object.entries(AFWERKING).map(([v, l]) => `<option value="${v}" ${g.afwerking === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="veld"><span>Gemeten vanaf</span>${seg(gp + '.vanaf', [['Plafond', 'Plafond'], ['Bovenkant rail', 'Bovenkant rail']], true)}</div>
      ${g.afwerking === 'vrij' ? `<label class="veld"><span>Uitgaan van</span><select data-bind="${gp}.basis" data-live><option value="kort" ${g.basis === 'kort' ? 'selected' : ''}>kortste hoogte</option><option value="lang" ${g.basis === 'lang' ? 'selected' : ''}>langste hoogte</option></select></label>
      <label class="veld"><span>Correctie (mm) <b class="verplicht-ster">*</b> <small>+ langer / − korter</small></span><input data-bind="${gp}.correctie" data-live value="${esc(g.correctie)}" inputmode="text" placeholder="bijv. +100 of -15"></label>` : ''}
    </div>
    <div class="raster2">
      <label class="veld"><span>Voering</span>${select(gp + '.voering', L.voering, g.voering, '', 'ongevoerd')}</label>
      <label class="veld"><span>Voering kleur</span><input data-bind="${gp}.voeringkleur" value="${esc(g.voeringkleur)}"></label>
      <label class="veld"><span>Voeren</span>${select(gp + '.voeren', L.voeren, g.voeren, '', null)}</label>
      <label class="veld"><span>Confectie</span>${select(gp + '.confectie', L.confectie, g.confectie, '', null)}</label>
      <label class="veld"><span>Rails</span>${select(gp + '.rails', L.rails, g.rails, '', null)}</label>
      <label class="veld"><span>Runners (bij wave)</span>${select(gp + '.runners', L.runners, g.runners)}</label>
      <label class="veld"><span>Bochten (aantal)</span><input data-bind="${gp}.bochten" value="${esc(g.bochten)}" inputmode="numeric"></label>
      <label class="veld"><span>Rapport (mm)</span><input data-bind="${gp}.rapport" value="${esc(g.rapport)}" inputmode="numeric"></label>
      <label class="veld vink-veld"><input type="checkbox" ${g.loodkoord === 'Ja' ? 'checked' : ''} onchange="zetLoodkoord('${pre}', this.checked)"> Loodkoord</label>
      <label class="veld"><span>Instomen</span>${select(gp + '.instomen', L.janee, g.instomen, '', null)}</label>
      <label class="veld"><span>Halve banen</span>${select(gp + '.halvebanen', L.janee, g.halvebanen, '', null)}</label>
      <label class="veld"><span>Inhangen</span>${select(gp + '.inhangen', L.janee, g.inhangen, '', null)}</label>
    </div>`;
  }
  // maten
  if (t.calc !== 'los') {
    const [lB, lH] = t.calc === 'stof' ? ['Railbreedte', `Hoogte (${gordMigreer(p.gord).vanaf.toLowerCase()} → vloer)`] : ['Breedte', 'Hoogte'];
    const meetrij = (label, as) => `<div class="meetrij"><span class="meetlabel">${label}</span>${[0, 1, 2].map(i => `<input data-meet data-live data-bind="${pre}.${as}.${i}" value="${esc(p[as][i])}" inputmode="decimal" placeholder="${i === 0 ? 'mm' : (i === 1 ? '2e' : '3e')}" autocomplete="off" class="meet">`).join('')}</div>`;
    const r = bereken(p);
    blok += `<div class="raster2">
      ${t.calc === 'zon' ? `<div class="veld"><span>Montage</span><div class="segment">
        <label><input type="radio" name="m${sleutel}" value="in" data-bind="${pre}.montage" data-rerender ${p.montage === 'in' ? 'checked' : ''}> In de dag</label>
        <label><input type="radio" name="m${sleutel}" value="op" data-bind="${pre}.montage" data-rerender ${p.montage === 'op' ? 'checked' : ''}> Op de dag</label>
      </div></div>` : ''}
      <label class="veld"><span>Bevestiging</span>${select(pre + '.bevestiging', CONFIG.bevestiging, p.bevestiging)}</label>
      <label class="veld"><span>Montagehoogte (mm) <b class="verplicht-ster">*</b> <small>vloer → bevestiging</small></span><input data-meet data-live data-mh data-bind="${pre}.montagehoogte" value="${esc(p.montagehoogte || '')}" inputmode="decimal" autocomplete="off" class="${parseMaat(p.montagehoogte) > 0 ? '' : 'verplicht'}"></label>
      ${t.calc === 'zon' ? `<label class="veld"><span>Bedieningszijde <b class="verplicht-ster" data-zijde-ster ${zijdeVerplicht(p) ? '' : 'hidden'}>*</b> <small>(niet op offerte)</small></span>${select(pre + '.zijde', CONFIG.zijde, p.zijde, `data-live data-zijde class="${zijdeVerplicht(p) && !p.zijde ? 'verplicht' : ''}"`)}</label>` : ''}
    </div>
    <div class="strak-blok">
      <div class="strak-titel">GEMETEN (strak) – niet bestellen <small>mm · ${t.calc === 'zon' && p.montage === 'in' ? '3-puntsmeting aanbevolen, kleinste telt' : 'kleinste telt'}</small></div>
      ${meetrij(lB, 'B')}${meetrij(lH, 'H')}
    </div>
    <details class="correcties"><summary>Correcties (standaard ingevuld)</summary>
      <div class="raster2">${r.params.map(([key, label, e]) => `<label class="veld"><span>${label} (mm)</span><input data-par="${key}" data-live data-bind="${pre}.par.${key}" value="${esc(p.par[key] ?? '')}" placeholder="standaard ${e.std}" inputmode="decimal" class="${e.afw ? 'afwijkend' : ''}"></label>`).join('')}</div>
    </details>`;
  } else {
    blok += `<label class="veld"><span>Aantal</span><input data-bind="${pre}.aantal" data-live value="${esc(p.aantal)}" inputmode="numeric"></label>`;
  }
  blok += `<div class="resultaat">${resultaatHTML(p)}</div>`;
  if (t.calc !== 'los') blok += `<details class="correcties" ${p.hand.B || p.hand.H ? 'open' : ''}><summary>Bestelmaat handmatig aanpassen</summary>
      <div class="raster2">
        <label class="veld"><span>Breedte (mm)</span><input data-live data-bind="${pre}.hand.B" value="${esc(p.hand.B)}" inputmode="decimal"></label>
        <label class="veld"><span>Hoogte (mm)</span><input data-live data-bind="${pre}.hand.H" value="${esc(p.hand.H)}" inputmode="decimal"></label>
      </div>
      <label class="veld"><span>Reden (verplicht)</span><input data-live data-bind="${pre}.hand.reden" value="${esc(p.hand.reden)}"></label>
    </details>`;
  blok += `<div class="raster2">
      ${t.modus !== 'los' ? `<label class="veld"><span>Plaatsen door Edison</span>${select(pre + '.plaatsen', CAT.lijsten.janee, p.plaatsen, '', null)}</label>` : ''}
      <label class="veld"><span>Opmerking <small>(alleen op meetformulier)</small></span><input data-bind="${pre}.opmerking" value="${esc(p.opmerking)}"></label>
    </div>
    <div class="acties klein">
      <button class="mini" onclick="dupliceerProduct('${sleutel}')">Dupliceer</button>
      <button class="mini gevaar" onclick="verwijderProduct('${sleutel}')">Verwijder product</button>
    </div>`;
  return `<section class="kaart product" data-prod="${sleutel}">${kop}${blok}</section>`;
}
function zetLoodkoord(pre, aan) { zetPad(huidigeKlant, pre + '.gord.loodkoord', aan ? 'Ja' : 'Nee'); gewijzigd(huidigeKlant); }
function kleurInfoHTML(p) {
  const k = kleurInfo(p);
  if (!k) return '';
  if (k.fout) return `<div class="waarschuwing">⚠ Kleurnummer ${esc(k.nr)} niet gevonden bij ${esc(p.art)}</div>`;
  return `<div class="kleur-ok">${esc(k.kwaliteit)} · <b>${esc(p.pk || k.pk)}</b>${p.pk && p.pk !== k.pk ? ` <span class="tag">handmatig (kleur = ${esc(k.pk)})</span>` : ''}${k.plisse ? ` · <b class="plisse">plissé ${esc(k.plisse)} mm</b>` : ''}</div>`;
}
function resultaatHTML(p) {
  const r = bereken(p);
  if (!r) return '';
  const meldingen = `${r.afwijkend.length ? `<div class="let-op">Afwijkend van standaard: ${esc(r.afwijkend.join(', '))}</div>` : ''}
    ${r.waarsch.map(w => `<div class="waarschuwing">⚠ ${esc(w)}</div>`).join('')}
    ${r.info ? `<div class="info">${esc(r.info)}</div>` : ''}${r.info2 ? `<div class="info">Let op: ${esc(r.info2)}</div>` : ''}${r.info3 ? `<div class="info">${esc(r.info3)}</div>` : ''}${r.info4 ? `<div class="let-op">${esc(r.info4)}</div>` : ''}${r.delen ? `<div class="info">Verdeling: links ${r.delen[0]} mm · rechts ${r.delen[1]} mm</div>` : ''}`;
  if (r.t.calc === 'los') return meldingen;
  return `<div class="bestel ${r.hand.B || r.hand.H ? 'hand' : ''}">
      <div class="bestel-label">BESTELMAAT <small>mm</small>${r.hand.B || r.hand.H ? ' <span class="tag">handmatig</span>' : ''}</div>
      <div class="bestel-maat">${fmtMaat(r)}</div>
      <div class="bestel-uitleg">${esc(r.uitB)}${r.uitH ? '<br>' + esc(r.uitH) : ''}</div>
    </div>${meldingen}`;
}
function prodVan(sleutel) { const [ri, wi, pi] = sleutel.split('.').map(Number); return [huidigeKlant.ruimtes[ri].ramen[wi], pi]; }
function bevestigProduct(s) { const [w, pi] = prodVan(s); delete w.producten[pi].overgenomen; gewijzigd(huidigeKlant); route(); }
function leegProduct(s) { if (!confirm('Overgenomen gegevens wissen en dit product leeg maken?')) return; const [w, pi] = prodVan(s); const oud = w.producten[pi]; const n = nieuwProduct(); n.montagehoogte = oud.montagehoogte; n.B = oud.B; n.H = oud.H; w.producten[pi] = n; gewijzigd(huidigeKlant); route(); }
function maakProduct(ri, wi) { huidigeKlant.ruimtes[ri].ramen[wi].producten.push(nieuwProduct()); gewijzigd(huidigeKlant); route(); }
function dupliceerProduct(s) { const [w, pi] = prodVan(s); const c = kopie(w.producten[pi]); c.id = uid(); c.overgenomen = `product ${pi + 1} van raam ${w.nr}`; w.producten.splice(pi + 1, 0, c); gewijzigd(huidigeKlant); route(); }
function verwijderProduct(s) { if (!confirm('Product verwijderen?')) return; const [w, pi] = prodVan(s); w.producten.splice(pi, 1); gewijzigd(huidigeKlant); route(); }
function kopieerRaam(ri, wi) {
  const ru = huidigeKlant.ruimtes[ri]; const c = kopie(ru.ramen[wi]);
  const bronNr = ru.ramen[wi].nr;
  c.id = uid(); c.nr = String(ru.ramen.length + 1); c.fotos = []; c.producten.forEach(p => { p.id = uid(); if (p.art) p.overgenomen = `${ru.naam} raam ${bronNr}`; p.B = ['', '', '']; p.H = ['', '', '']; p.montagehoogte = ''; p.hand = { B: '', H: '', reden: '' }; });
  ru.ramen.push(c); gewijzigd(huidigeKlant); location.hash = `#/k/${huidigeKlant.id}/raam/${c.id}`;
}
function verwijderRaam(ri, wi) { if (!confirm('Dit raam verwijderen?')) return; const k = huidigeKlant; k.ruimtes[ri].ramen.splice(wi, 1); gewijzigd(k); location.hash = '#/k/' + k.id; }

/* ---------- foto's ---------- */
async function verklein(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
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
      if (f && f.driveId) img.replaceWith(Object.assign(document.createElement('a'), { href: `https://drive.google.com/file/d/${f.driveId}/view`, target: '_blank', textContent: 'Foto in Drive', className: 'drive-link' })); }
  }
  schaalPrint();
}
const alleFotos = k => k.ruimtes.flatMap(r => r.ramen.flatMap(w => w.fotos));

/* ---------- Overzicht / print ---------- */
let werkprint = false;
function renderOverzicht(k) {
  const ruimtes = k.ruimtes.filter(r => r.ramen.some(w => w.producten.some(p => prodDef(p))));
  const totaal = 1 + ruimtes.length + (werkprint ? 1 : 0);
  const kopje = (nr, sub) => `<div class="blad-kop"><img src="logo.png" alt="Edison Interieur"><div class="blad-kop-tekst"><b>${esc(k.naam)}</b> · ${esc(k.adres)}, ${esc(k.pcplaats)}${k.offertenr ? ' · Offerte ' + esc(k.offertenr) : ''}<br>${esc(sub)}</div><div class="bladnr">Blad ${nr} van ${totaal}</div></div>`;
  const voet = `<div class="blad-voet">Alle maten in mm. Maten op dit formulier zijn <b>BESTELMATEN</b>. Ingemeten ${datumNL(k.datum)}.</div>`;
  const fouten = ruimtes.flatMap(ru => ru.ramen.flatMap(w => w.producten.map(p => bereken(p)).filter(r => r && r.waarsch.length).map(r => `${ru.naam} raam ${w.nr}: ${r.waarsch.join(' ')}`)));
  let html = kop('Overzicht', '#/k/' + k.id) + `
  <div class="werkbalk no-print">
    <button class="knop primair" onclick="window.print()">Printen / PDF</button>
    <button class="knop" onclick="kopieerExcel()">Kopieer voor Excel</button>
    <label class="schakel"><input type="checkbox" ${werkprint ? 'checked' : ''} onchange="werkprint=this.checked;route()"> Werkprint (met bijlage gemeten maten)</label>
    ${fouten.length ? `<div class="waarschuwing breed">⚠ ${fouten.length} product(en) met een melding:<br>${fouten.map(esc).join('<br>')}</div>` : ''}
  </div>
  <div class="print-houder"><div class="print">
  <section class="blad voorblad">
    <div class="voor-kop"><img src="logo.png" alt="Edison Interieur" class="voor-logo"><div class="voor-titel">MEETFORMULIER</div></div>
    <table class="gegevens">
      <tr><th>Naam</th><td>${esc(k.naam)}</td><th>Datum</th><td>${datumNL(k.datum)}</td></tr>
      <tr><th>Adres</th><td>${esc(k.adres)}</td><th>Offertenummer</th><td>${esc(k.offertenr)}</td></tr>
      <tr><th>Postcode/plaats</th><td>${esc(k.pcplaats)}</td><th>Telefoon</th><td>${esc(k.telefoon)}</td></tr>
      <tr><th></th><td></td><th>E-mail</th><td>${esc(k.email)}</td></tr>
    </table>
    <h2>Overzicht per ruimte</h2>
    <table class="tabel"><thead><tr><th>Ruimte</th><th>Ramen</th><th>Producten</th><th>Blad</th></tr></thead>
      <tbody>${ruimtes.map((ru, i) => `<tr><td><b>${esc(ru.naam)}</b></td><td>${ru.ramen.length}</td><td>${samenvatting(ru)}</td><td>${i + 2}</td></tr>`).join('')}</tbody></table>
    ${k.opmerking ? `<h2>Opmerking</h2><p>${esc(k.opmerking).replace(/\n/g, '<br>')}</p>` : ''}
    ${montagePrint(k)}
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
            <thead><tr><th>Product</th><th>Montage</th><th class="kol-bestel">BESTELMAAT (mm)<br><small>b × h</small></th><th>Kleur</th><th>Uitvoering</th></tr></thead>
            <tbody>${w.producten.filter(p => prodDef(p)).map(p => { const r = bereken(p); return `
              <tr><td><b>${esc(r.t.naam)}</b><br><small>${esc(p.cat)}</small>${p.plaatsen === 'Nee' ? '<br><small>klant plaatst zelf</small>' : ''}</td>
                <td>${r.t.calc === 'zon' ? (p.montage === 'in' ? 'In de dag' : 'Op de dag') : ''}${p.bevestiging ? '<br><small>' + esc(p.bevestiging) + '</small>' : ''}${r.t.calc !== 'los' ? (parseMaat(p.montagehoogte) > 0 ? '<br><small>Mh ' + parseMaat(p.montagehoogte) + ' mm</small>' : '<br><small class="fout">Mh ontbreekt</small>') : ''}</td>
                <td class="kol-bestel">${r.t.calc === 'los' ? `${esc(p.aantal)}×` : `<span class="bestel-print">${fmtMaat(r)}</span>`}${r.hand.B || r.hand.H ? '<br><span class="tag">handmatig: ' + esc(p.hand.reden || 'geen reden') + '</span>' : ''}${r.afwijkend.length ? '<br><small class="afw">afwijkend: ' + esc(r.afwijkend.join(', ')) + '</small>' : ''}</td>
                <td>${esc(kleurTekst(p))}${effPk(p) ? '<br><small>' + esc(effPk(p)) + '</small>' : ''}</td>
                <td><small>${esc(uitvoeringTekst(p))}${p.opmerking ? '<br><i>' + esc(p.opmerking) + '</i>' : ''}</small></td></tr>
              ${r.t.calc !== 'los' ? `<tr class="strak-rij no-print"><td colspan="5"><button class="mini" onclick="this.parentNode.classList.toggle('open')">Toon gemeten maten</button>
                <span class="strak-detail">GEMETEN – NIET BESTELLEN: ${fmtStrak(r)} mm · ${esc(r.uitB)}${r.uitH ? ' · ' + esc(r.uitH) : ''}</span></td></tr>` : ''}`; }).join('')}
            </tbody></table>
          ${w.opmerking ? `<div class="raam-opm">${esc(w.opmerking)}</div>` : ''}
          ${w.fotos.length ? `<div class="print-fotos">${w.fotos.map(f => `<img data-foto="${f.id}" alt="">`).join('')}</div>` : ''}
        </div>`).join('')}
      ${voet}</section>`;
  });
  if (werkprint) {
    html += `<section class="blad bijlage">${kopje(totaal, 'Bijlage')}
      <h2 class="bijlage-titel">BIJLAGE – GEMETEN MATEN – NIET BESTELLEN</h2>
      <p class="bijlage-uitleg">Dit zijn de strakke (gemeten) maten. Bestel altijd op de bestelmaat van de ruimtebladen.</p>
      <table class="tabel grijs"><thead><tr><th>Ruimte</th><th>Raam</th><th>Product</th><th>Montage</th><th>Breedte 1 / 2 / 3</th><th>Hoogte 1 / 2 / 3</th><th>Strak</th><th>Berekening</th></tr></thead><tbody>
      ${ruimtes.flatMap(ru => ru.ramen.flatMap(w => w.producten.map(p => [p, bereken(p)]).filter(([, r]) => r && r.t.calc !== 'los').map(([p, r]) => `<tr><td>${esc(ru.naam)}</td><td>${esc(w.nr)}</td><td>${esc(r.t.naam)}</td><td>${r.t.calc === 'zon' ? (p.montage === 'in' ? 'In' : 'Op') : ''}</td><td>${p.B.map(v => esc(v) || '–').join(' / ')}</td><td>${p.H.map(v => esc(v) || '–').join(' / ')}</td><td>${fmtStrak(r)}</td><td><small>${esc(r.uitB)}${r.uitH ? '<br>' + esc(r.uitH) : ''}</small></td></tr>`))).join('')}
      </tbody></table></section>`;
  }
  html += '</div></div>';
  app().innerHTML = html;
  schaalPrint(); laadFotos(); updateBadge();
}
function samenvatting(ru) {
  const telling = {};
  ru.ramen.forEach(w => w.producten.forEach(p => { const t = prodDef(p); if (t) telling[t.naam] = (telling[t.naam] || 0) + (t.calc === 'los' ? Number(p.aantal) || 1 : 1); }));
  return Object.entries(telling).map(([n, c]) => `${c}× ${esc(n)}`).join(', ');
}

/* A4 op scherm verkleinen tot schermbreedte (print blijft 100%) */
function schaalPrint() {
  const h = $('.print-houder'), p = $('.print'); if (!h || !p) return;
  p.style.transform = '';
  const z = Math.min(1, (document.documentElement.clientWidth - 16) / p.offsetWidth);
  p.style.transform = `scale(${z})`;
  h.style.width = (p.offsetWidth * z) + 'px';
  h.style.height = (p.offsetHeight * z) + 'px';
  $$('img', p).forEach(i => { if (!i.complete) i.addEventListener('load', schaalPrint, { once: true }); });
}
window.addEventListener('resize', schaalPrint);
window.addEventListener('afterprint', schaalPrint);

/* ---------- Export naar Excel (tab Import -> macro ImporteerMeting) ---------- */
function exportRegels(k) {
  const regels = [['EDISON-MEETFORMULIER', '2'], ['KLANT', k.naam, k.adres, k.pcplaats, k.telefoon, k.email, k.offertenr]];
  const ruimtes = [], invoer = new Map(), gord = new Map(), problemen = [];
  k.ruimtes.forEach(ru => {
    let heeft = false;
    ru.ramen.forEach(w => w.producten.forEach(p => {
      const r = bereken(p); if (!r) { if (p.cat || p.art) problemen.push(`${ru.naam} raam ${w.nr}: product niet compleet`); return; }
      if (r.waarsch.length) problemen.push(`${ru.naam} raam ${w.nr}: ${r.waarsch.join(' ')}`);
      heeft = true;
      if (r.t.calc === 'stof') {
        const g = p.gord;
        const rij = [ru.naam, p.cat, p.art, p.kleur, r.B ?? '', r.H ?? '', gordMigreer(g).indeling === 'stuk' ? 'Stuk' : 'Stel', g.plooi, g.halvebanen, g.confectie, g.loodkoord, g.voering, g.voeringkleur, g.voeren, g.instomen, g.rapport, g.rails, g.runners, g.bochten, g.inhangen];
        const s = JSON.stringify(rij); gord.set(s, { rij, n: (gord.get(s)?.n || 0) + 1 });
      } else {
        const rij = [ru.naam, p.cat, p.art, r.t.art.fam ? normKleur(p.kleurnr) : '', r.t.calc === 'los' ? '' : (r.B ?? ''), r.t.calc === 'los' ? '' : (r.H ?? ''), p.pk || '', p.opties[0] || '', p.opties[1] || '', p.opties[2] || '', r.t.modus === 'los' ? '' : p.plaatsen];
        const n = r.t.calc === 'los' ? (Number(p.aantal) || 1) : 1;
        const s = JSON.stringify(rij); invoer.set(s, { rij, n: (invoer.get(s)?.n || 0) + n });
      }
    }));
    if (heeft) ruimtes.push(ru.naam);
  });
  ruimtes.forEach(n => regels.push(['RUIMTE', n]));
  invoer.forEach(({ rij, n }) => regels.push(['INVOER', rij[0], rij[1], rij[2], rij[3], n, ...rij.slice(4)]));
  gord.forEach(({ rij, n }) => regels.push(['GORDIJN', rij[0], n, ...rij.slice(1)]));
  regels.push(['EINDE']);
  return { regels, aantalInvoer: invoer.size, aantalGord: gord.size, aantalRuimtes: ruimtes.length, problemen };
}
async function kopieerExcel() {
  const k = huidigeKlant; const ex = exportRegels(k); const L = CAT.limieten;
  const te = [];
  if (ex.aantalInvoer > L.invoer) te.push(`${ex.aantalInvoer} productregels (Invoer heeft er ${L.invoer})`);
  if (ex.aantalGord > L.gordijnen) te.push(`${ex.aantalGord} gordijnregels (tab Gordijnen heeft er ${L.gordijnen})`);
  if (ex.aantalRuimtes > L.ruimtes) te.push(`${ex.aantalRuimtes} ruimtes (Invoer heeft er ${L.ruimtes})`);
  const tekst = ex.regels.map(r => r.map(v => String(v ?? '').replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
  let ok = false;
  try { await navigator.clipboard.writeText(tekst); ok = true; } catch (e) {}
  if (!ok) { const ta = document.createElement('textarea'); ta.value = tekst; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); }
  let m = ok ? `Gekopieerd: ${ex.aantalInvoer} productregels, ${ex.aantalGord} gordijnen, ${ex.aantalRuimtes} ruimtes.<br>Excel: tab <b>Import</b> → cel A1 → plakken → macro <b>ImporteerMeting</b>.` : 'Kopiëren lukte niet.';
  if (te.length) m += `<br><b>Te veel voor de offerte: ${te.join(', ')}.</b>`;
  if (ex.problemen.length) m += `<br><b>Let op:</b> ${ex.problemen.slice(0, 3).map(esc).join('<br>')}${ex.problemen.length > 3 ? '<br>…' : ''}`;
  melding(m, !ok || te.length || ex.problemen.length, 12000);
}

/* ---------- Instellingen ---------- */
function renderInst() {
  const w = DB.inst.waarden;
  const aftrekRijen = ['TruFit', ...CAT.categorieen.filter(c => c.modus === 'zon').map(c => c.naam)];
  app().innerHTML = kop('Instellingen', '#/') + `
  <main class="inhoud">
    <section class="kaart">
      <h2>Standaardwaarden</h2>
      <p class="uitleg">Gelden voor alle producten, tenzij per product afwijkend ingevuld. Alle maten in mm.</p>
      <div class="raster2">
        ${[['overlap', 'Overlap gordijn'], ['vloerafstand', 'Gordijn net boven de grond (−)'], ['opGrond', 'Gordijn op de grond (+)'], ['vensterbank', 'Gordijn tot vensterbank (−)'], ['vitrageExtra', 'Extra vitrage tweede laag (−)'], ['aftrekB', 'Aftrek breedte in de dag'], ['aftrekH', 'Aftrek hoogte in de dag'], ['overmaatB', 'Overmaat breedte op de dag'], ['overmaatH', 'Overmaat hoogte op de dag']].map(([k, l]) => `<label class="veld"><span>${l}</span><input data-ibind="waarden.${k}" data-num value="${esc(w[k])}" inputmode="decimal"></label>`).join('')}
      </div>
    </section>
    <section class="kaart">
      <h2>Aftrek in de dag per productgroep</h2>
      <p class="uitleg">Leeg = standaard (${esc(w.aftrekB)} / ${esc(w.aftrekH)} mm). "TruFit" geldt zodra een TruFit-optie gekozen is.</p>
      <table class="tabel inst"><thead><tr><th>Productgroep</th><th>Breedte</th><th>Hoogte</th></tr></thead><tbody>
      ${aftrekRijen.map(id => { const a = DB.inst.aftrekPerType[id] || {}; return `<tr><td>${esc(id)}</td><td><input data-ibind="aftrekPerType.${id}.B" data-num value="${esc(a.B ?? '')}" inputmode="decimal" onfocus="zorgType('${esc(id)}')"></td><td><input data-ibind="aftrekPerType.${id}.H" data-num value="${esc(a.H ?? '')}" inputmode="decimal" onfocus="zorgType('${esc(id)}')"></td></tr>`; }).join('')}
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
      <h2>Catalogus (producten, kleurnummers, opties)</h2>
      <p class="uitleg">Nu: ${esc(CAT.bron)} · ${Object.values(CAT.kleuren).reduce((a, f) => a + Object.keys(f).length, 0)} kleurnummers.<br>Nieuwe prijslijst? Plak de tabs Artikelen, Opties, Kleuren en Lijsten uit je master in de Google Sheet en tik hieronder.</p>
      <div class="acties"><button class="knop" onclick="haalCatalogus()">Catalogus ophalen uit Sheet</button>${localStorage.getItem('emf_cat') ? '<button class="knop" onclick="herstelCatalogus()">Terug naar ingebouwde catalogus</button>' : ''}</div>
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
  try { const j = await post({ action: 'test' }); melding('Verbinding werkt: ' + (j.bericht || 'ok') + '. Metingen worden opgehaald…'); DB.inst.laatstePull = 0; bewaarLokaal(); sync(); }
  catch (e) { melding('Verbinding mislukt: ' + e.message, true); }
}
async function haalCatalogus() {
  try {
    melding('Catalogus ophalen…');
    const j = await post({ action: 'catalogus' });
    const c = j.catalogus;
    if (!c || !c.categorieen || !c.categorieen.length) throw new Error('geen catalogus gevonden in de Sheet');
    CAT = c; localStorage.setItem('emf_cat', JSON.stringify(c));
    melding(`Catalogus bijgewerkt: ${c.categorieen.length} productgroepen, ${Object.values(c.kleuren).reduce((a, f) => a + Object.keys(f).length, 0)} kleurnummers.`);
    route();
  } catch (e) { melding('Catalogus ophalen mislukt: ' + e.message, true); }
}
function herstelCatalogus() { localStorage.removeItem('emf_cat'); CAT = CATALOGUS_STANDAARD; route(); }
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
      <div class="leeg-rij klein">Product: ${vakjes(['Gordijn', 'Vitrage', 'Rolgordijn', 'Duo-rol', 'Plissé', 'Duette', 'Vouwgordijn', 'Silhouette', 'Jaloezie', 'Houten jal.', 'Verticaal', 'Hor', 'Hordeur', 'Dutch Design'])}</div>
      <div class="leeg-rij klein">Montage: ${vakjes(['In de dag', 'Op de dag'])} &nbsp; Bevestiging: ${vakjes(['Wand', 'Plafond', 'Kozijn', 'Glaslat'])} &nbsp; Bediening: ${vakjes(['L', 'R'])}</div>
      <div class="leeg-maten">
        <div class="strak-vak"><b>GEMETEN – NIET BESTELLEN</b><div>B: ______ / ______ / ______</div><div>H: ______ / ______ / ______</div></div>
        <div class="bestel-vak"><b>BESTELMAAT (mm)</b><div class="groot">B ________ × H ________</div></div>
      </div>
      <div class="leeg-rij">${lijn('Montagehoogte * (mm)')}${lijn('Kleurnummer')}${lijn('Opties')}</div>
    </div>`;
  app().innerHTML = kop('Lege printversie', '#/') + `
  <div class="werkbalk no-print"><button class="knop primair" onclick="window.print()">Printen</button><span class="uitleg">Blad 1 is het voorblad, blad 2 print je zo vaak als nodig (één per ruimte).</span></div>
  <div class="print-houder"><div class="print">
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
  </div></div>`;
  schaalPrint(); updateBadge();
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
function metBerekening(k) {
  const c = kopie(k);
  c.ruimtes.forEach(ru => ru.ramen.forEach(w => w.producten.forEach(p => {
    const r = bereken(p);
    p.berekend = r ? { naam: r.t.naam, cat: p.cat, calc: r.t.calc, B: r.B, H: r.H, sB: r.sB, sH: r.sH, hand: r.hand.B || r.hand.H, kleur: kleurTekst(p), pk: effPk(p), uitvoering: (parseMaat(p.montagehoogte) > 0 ? 'montagehoogte ' + parseMaat(p.montagehoogte) + ' mm · ' : '') + uitvoeringTekst(p) } : null;
  })));
  return c;
}
const aantalOpen = () => Object.values(DB.klanten).filter(k => k.updated > k.syncedAt).length + (DB.inst.updated > DB.inst.syncedAt ? 1 : 0);
function updateBadge() {
  const b = $('#badge'); if (!b) return;
  const n = aantalOpen(); let t, c;
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
      if (!lok || (r.updated > lok.updated && lok.updated <= lok.syncedAt)) { const k = JSON.parse(r.json); k.syncedAt = k.updated; DB.klanten[k.id] = k; veranderd = true; }
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
// elke minuut versturen én nieuwe metingen van andere toestellen ophalen
setInterval(() => sync(), 60000);
// bij terugkeren naar de app (iPhone: app weer openen, laptop: tabblad weer actief)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });

/* ---------- meldingen ---------- */
function melding(tekst, fout, ms = 4000) {
  let m = $('#melding'); if (!m) { m = document.createElement('div'); m.id = 'melding'; document.body.appendChild(m); }
  m.innerHTML = tekst; m.className = 'no-print toon' + (fout ? ' fout' : '');
  m.onclick = () => m.className = 'no-print';
  clearTimeout(m._t); m._t = setTimeout(() => m.className = 'no-print', ms);
}

/* ---------- start ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
sync();
