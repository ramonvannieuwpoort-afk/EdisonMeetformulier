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
// v3.1: elke klant onder een eigen sleutel (emf_k_<id>), zodat bij typen alleen die ene klant wordt weggeschreven
let PER_KLANT = true;
function laadKlanten() {
  const k = {};
  for (let i = 0; i < localStorage.length; i++) {
    const sl = localStorage.key(i);
    if (sl && sl.startsWith('emf_k_')) { try { const v = JSON.parse(localStorage.getItem(sl)); if (v && v.id) k[v.id] = v; } catch (e) {} }
  }
  const oud = laad('emf_klanten', null);
  if (oud) { // eenmalig omzetten vanuit de oude opslag (alles onder één sleutel)
    let ok = true;
    Object.values(oud).forEach(x => {
      if (!x || !x.id) return;
      if (!k[x.id] || (k[x.id].updated || 0) < (x.updated || 0)) k[x.id] = x;
      try { localStorage.setItem('emf_k_' + x.id, JSON.stringify(k[x.id])); } catch (e) { ok = false; }
    });
    if (ok) localStorage.removeItem('emf_klanten');
    else { PER_KLANT = false; Object.keys(k).forEach(id => { try { localStorage.removeItem('emf_k_' + id); } catch (e) {} }); }
  }
  return k;
}
const DB = { klanten: laadKlanten(), inst: laad('emf_inst', null) };
if (!DB.inst) DB.inst = { waarden: { ...CONFIG.standaard }, aftrekPerType: kopie(CONFIG.aftrekPerType), url: '', sleutel: '', updated: 0, syncedAt: 0, laatstePull: 0 };
for (const [k, v] of Object.entries(CONFIG.standaard)) if (DB.inst.waarden[k] === undefined) DB.inst.waarden[k] = v;
for (const [k, v] of Object.entries(CONFIG.aftrekPerType)) if (DB.inst.aftrekPerType[k] === undefined) DB.inst.aftrekPerType[k] = v;

let CAT = laad('emf_cat', null) || CATALOGUS_STANDAARD;

// v2.5: elke meting gaat kant-en-klaar voor Excel mee naar de Sheet.
// Eenmalig alles opnieuw versturen, zodat ook oude metingen in Excel op te halen zijn.
if (DB.inst.excelV !== 1) { Object.values(DB.klanten).forEach(k => { k.syncedAt = 0; }); DB.inst.excelV = 1; bewaarLokaal(); }

// bewaarLokaal(k) = alleen die klant, bewaarLokaal([..]) = alleen die klanten ([] = alleen instellingen), bewaarLokaal() = alles
function bewaarLokaal(welke) {
  try {
    if (!PER_KLANT) localStorage.setItem('emf_klanten', JSON.stringify(DB.klanten));
    else {
      const lijst = welke == null ? Object.values(DB.klanten) : Array.isArray(welke) ? welke : [welke];
      lijst.forEach(k => { if (k && k.id) localStorage.setItem('emf_k_' + k.id, JSON.stringify(k)); });
    }
    localStorage.setItem('emf_inst', JSON.stringify(DB.inst));
  } catch (e) { melding('Opslaan op dit toestel mislukt: ' + e.message, true); }
}
function gewijzigd(k) { k.updated = Date.now(); bewaarLokaal(k); planSync(); updateBadge(); snapPeriodiek(k); }
function instGewijzigd() { DB.inst.updated = Date.now(); bewaarLokaal([]); planSync(); updateBadge(); }

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
// namen van de drie meetpunten
const puntNaam = (p, as, i) => { const t = prodDef(p); return as === 'H' ? ['links', 'midden', 'rechts'][i] : (t && t.calc === 'stof' ? ['1e', '2e', '3e'][i] : ['boven', 'midden', 'onder'][i]); };
const naastAantal = p => { const n = parseInt(p.naast, 10); return n > 1 ? n : 1; };
// naast elkaar alleen bij raambekleding in de dag
const alsBestel = p => p.maatSoort === 'bestel';
const naastActief = p => { const t = prodDef(p); return !!t && t.calc === 'zon' && p.montage === 'in' && naastAantal(p) > 1 && !alsBestel(p); };
const naastN = p => naastActief(p) ? naastAantal(p) : 1;
const POSITIES = { 2: ['links', 'rechts'], 3: ['links', 'midden', 'rechts'], 4: ['links', 'midden-links', 'midden-rechts', 'rechts'] };
const positie = (n, i) => (POSITIES[n] || [])[i] || String(i + 1);
const deelZijde = (p, i) => (Array.isArray(p.naastZijde) && p.naastZijde[i]) || '';
const kleurLater = p => !!p.kleurLater && !String(p.kleurnr || '').trim() && !String(p.kleur || '').trim();
const KLEUR_LATER = 'KLEUR NOG KIEZEN – klant kiest in de winkel';
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
  if (key === 'overlap' && p.gord && p.gord.indeling === 'stuk') return Number(DB.inst.waarden.overlapStuk) || 0;
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
    if (kleurLater(p)) { if (!p.pk) r.waarsch.push('Klant kiest kleur later: kies een prijsklasse, anders kan Excel geen prijs maken.'); }
    else if (!p.kleurnr) r.waarsch.push('Kleurnummer ontbreekt.');
    else if (k.fout && !p.pk) r.waarsch.push(`Kleurnummer ${k.nr} bestaat niet voor ${t.naam}.`);
  }
  const pk = effPk(p);
  if (pk && t.art.pk && !t.art.pk.split(',').map(s => s.trim()).includes(pk)) r.waarsch.push(`${pk} is niet leverbaar voor ${t.naam} (wel: ${t.art.pk}).`);
  if (t.modus === 'zon') {
    const o = gekozenOpties(p), bed = o.filter(isBediening);
    if (new Set(o).size < o.length) r.waarsch.push('Dezelfde optie is twee keer gekozen.');
    if (bed.length > 1) r.waarsch.push(`Meer dan één bediening gekozen (${bed.join(' + ')}). Kies er één.`);
    else if (o.some(isMotor) && o.some(vraagtZijde)) r.waarsch.push(`Motor gecombineerd met handbediening (${o.filter(vraagtZijde).join(', ')}).`);
    if (zijdeVerplicht(p)) {
      const n = naastN(p);
      if (n === 1 && !p.zijde) r.waarsch.push(`Bedieningszijde ontbreekt (verplicht bij ${zijdeOpties(p).join(', ')}).`);
      for (let i = 0; n > 1 && i < n; i++) if (!deelZijde(p, i)) r.waarsch.push(`Bedieningszijde deel ${i + 1} (${positie(n, i)}) ontbreekt.`);
    }
  }
  if (p.overgenomen) r.waarsch.push(`Overgenomen van ${p.overgenomen} – nog niet bevestigd.`);
  if (t.art.let && t.modus === 'zon') r.info2 = t.art.let;
  if (t.calc === 'los') return r;

  const mB = metingen(p.B), mH = metingen(p.H);
  const sB = mB.length ? Math.min(...mB) : null, sH = mH.length ? Math.min(...mH) : null;
  r.sB = sB; r.sH = sH;
  if (alsBestel(p)) {
    // inmeter heeft zelf de bestelmaat (blijvende maat) ingevoerd: niets afhalen of optellen
    r.sB = null; r.sH = null; r.alsBestel = true;
    if (sB != null) { r.B = sB; r.uitB = `${sB} ingevoerd als bestelmaat (app rekent niets)`; }
    if (sH != null) { r.H = sH; r.uitH = `${sH} ingevoerd als bestelmaat (app rekent niets)`; }
  } else if (t.calc === 'stof') {
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
    const n = t.calc === 'zon' ? naastAantal(p) : 1;
    if (n === 1) {
      if (sB != null) { r.B = sB - aB.v; r.uitB = `${sB} − ${aB.v} aftrek = ${r.B}`; }
    } else if (sB != null) {
      // n stuks naast elkaar in één dag: n + 1 kiertjes van elk de halve aftrek
      const kier = aB.v / 2, mm = v => String(Math.round(v * 10) / 10).replace('.', ',');
      const ongelijk = n === 2 && p.naastIndeling === 'ongelijk';
      r.naast = { n, dag: sB, kier, ongelijk };
      if (!ongelijk) {
        const per = Math.floor((sB - (n + 1) * kier) / n);
        r.B = per; r.naast.delen = Array(n).fill(per);
        r.uitB = `dag ${sB} − ${n + 1} kiertjes × ${mm(kier)} = ${mm(sB - (n + 1) * kier)} → ${n} × ${per}`;
      } else {
        const L = parseMaat(p.naastLinks);
        if (!(L > 0)) r.waarsch.push('Ongelijke delen: vul de dagmaat (strak) van het linkerdeel in.');
        else if (L >= sB) r.waarsch.push(`Linkerdeel (${L}) is breder dan de hele dag (${sB}).`);
        else {
          const links = Math.floor(L - 1.5 * kier), rechts = Math.floor(sB - L - 1.5 * kier);
          r.naast.L = L; r.naast.delen = [links, rechts]; r.B = Math.max(links, rechts);
          r.uitB = `links ${L} − ${mm(1.5 * kier)} = ${links} · rechts ${sB - L} − ${mm(1.5 * kier)} = ${rechts} (3 kiertjes × ${mm(kier)})`;
        }
      }
    }
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
    if (hv > 0) { const oud = r[k]; r[k] = hv; r.hand[k] = true; r['uit' + k] = `HANDMATIG ${hv}` + (oud != null ? ` (berekend was ${oud})` : ''); if (k === 'B' && r.naast) { r.naast.delen = Array(r.naast.n).fill(hv); r.naast.ongelijk = false; r['uitB'] += ` · ${r.naast.n} × ${hv}`; } }
  });
  if (r.naast && r.naast.delen) {
    const d = r.naast.delen, som = d.reduce((a, b) => a + b, 0), sp = r.naast.dag - som;
    const kier = String(r.naast.kier).replace('.', ',');
    r.naast.som = som; r.naast.speling = sp;
    r.naastRegels = [
      ['Totale dag (strak)', `${r.naast.dag} mm`],
      r.naast.ongelijk ? ['Ongelijk verdeeld (strak)', `links ${r.naast.L} · rechts ${r.naast.dag - r.naast.L}`] : ['Gelijk verdeeld', `${r.naast.n} stuks`],
      ['Bestelmaat', r.naast.ongelijk ? `links ${d[0]} + rechts ${d[1]} = ${som}` : `${r.naast.n} × ${d[0]} = ${som}`],
      ['Speling totaal', `${sp} mm (${r.naast.n + 1} kiertjes van ${kier} mm${sp !== Math.round((r.naast.n + 1) * r.naast.kier) ? ', + afronding' : ''})`]
    ];
  }
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
const fmtMaat = r => {
  if (!r) return '—'; if (r.t.calc === 'los') return '';
  if (r.naast && r.naast.delen) return r.naast.ongelijk ? `L ${r.naast.delen[0]} × ${r.H ?? '—'} · R ${r.naast.delen[1]} × ${r.H ?? '—'}` : `${r.naast.n} × (${r.B} × ${r.H ?? '—'})`;
  return `${r.B ?? '—'} × ${r.H ?? '—'}`;
};
const naastTekst = r => r && r.naast ? `${r.naast.n} stuks naast elkaar in één dag${r.naast.ongelijk ? ' (ongelijk)' : ''}` : '';
const dagStrakTekst = r => r && r.naast ? `Totale dagmaat GEMETEN (strak) – niet bestellen: B ${r.naast.dag}${r.naast.L ? ` · linkerdeel ${r.naast.L}` : ''}` : '';
const fmtStrak = r => !r ? '—' : r.t.calc === 'los' ? '' : `${r.sB ?? '—'} × ${r.sH ?? '—'}`;
function kleurTekst(p) {
  if (kleurLater(p)) return KLEUR_LATER;
  const k = kleurInfo(p);
  if (k && !k.fout) return `${k.nr} ${k.kwaliteit}`;
  return [p.kleurnr, p.kleur].filter(Boolean).join(' ');
}
function uitvoeringTekst(p, deel) {
  const t = prodDef(p); if (!t) return '';
  if (t.calc === 'stof') {
    const g = gordMigreer(p.gord), r = bereken(p);
    const ind = g.indeling === 'stuk' ? 'stuk' + (g.schuift ? ', schuift ' + g.schuift.toLowerCase() : '') : g.indeling === 'ongelijk' ? 'stel ongelijk' + (r && r.delen ? ` (links ${r.delen[0]} / rechts ${r.delen[1]} mm)` : '') : 'stel';
    const afw = g.afwerking === 'vrij' ? `vrij: ${g.basis === 'lang' ? 'langste' : 'kortste'} ${g.correctie || ''} mm` : AFWERKING[g.afwerking].toLowerCase();
    return [g.laag && g.laag.toLowerCase(), ind, g.plooi, afw, 'gemeten vanaf ' + g.vanaf.toLowerCase(), g.voering && 'voering ' + g.voering + (g.voeringkleur ? ' ' + g.voeringkleur : ''), g.voering && g.voeren === 'Los' && 'los gevoerd', g.loodkoord === 'Ja' && 'loodkoord', g.instomen === 'Ja' && 'instomen', g.rails !== 'Geen' && g.rails, g.runners, g.bochten && g.bochten + ' bocht(en)'].filter(Boolean).join(' · ');
  }
  const kp = kleurInfo(p), r = bereken(p);
  const naast = r && r.naast ? naastTekst(r) + (r.naast.delen ? (r.naast.ongelijk ? `: links ${r.naast.delen[0]} / rechts ${r.naast.delen[1]} mm` : `: ${r.naast.n} × ${r.naast.delen[0]} mm`) : '') + ` (dag strak ${r.naast.dag})` : '';
  const plooiLater = kleurLater(p) && /duette/i.test(p.cat + ' ' + p.art) && /25\/32/.test(p.art) && 'plooihoogte volgt na kleurkeuze';
  const n = naastN(p);
  const bl = i => { const v = parseMaat(i == null ? p.bedLengte : (p.naastBedLengte || [])[i]); return v > 0 ? `lengte ${v} mm` : ''; };
  const bedTekst = (z, l) => (z || l) ? 'bediening ' + [z && z.toLowerCase(), l].filter(Boolean).join(', ') : '';
  const zijde = n > 1 ? (deel != null ? bedTekst(deelZijde(p, deel), bl(deel)) : Array.from({ length: n }, (_, i) => { const tx = bedTekst(deelZijde(p, i), bl(i)); return tx && `deel ${i + 1} ${tx}`; }).filter(Boolean).join(', ')) : bedTekst(p.zijde, bl());
  return [deel != null ? '' : naast, kp && !kp.fout && kp.plisse && 'plissé ' + kp.plisse + ' mm', plooiLater, ...gekozenOpties(p), zijde].filter(Boolean).join(' · ');
}

/* ---------- router ---------- */
let huidigeKlant = null;
window.addEventListener('hashchange', route);
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  const y = window.scrollY, zelfde = route._laatst === location.hash; route._laatst = location.hash;
  if (h[0] === 'k' && DB.klanten[h[1]]) {
    if (!huidigeKlant || huidigeKlant.id !== h[1]) snapshot(DB.klanten[h[1]], 'geopend');
    huidigeKlant = DB.klanten[h[1]];
    if (h[2] === 'historie') renderHistorie(huidigeKlant);
    else if (h[2] === 'raam') renderRaam(huidigeKlant, h[3]);
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
    if (/^offerte\./.test(el.dataset.bind)) offerteGewijzigd(huidigeKlant); else gewijzigd(huidigeKlant);
    if (el.dataset.live !== undefined) liveUpdate(el);
    if (el.dataset.adres !== undefined) zoekAdres(el.value);
  } else if (el.dataset.ibind) {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.num !== undefined && v !== '') v = Number(String(v).replace(',', '.'));
    zetPad(DB.inst, el.dataset.ibind, v);
    if (el.dataset.lokaal !== undefined) bewaarLokaal([]); else instGewijzigd();
  }
});
document.addEventListener('focusin', e => { const el = e.target; if (el.dataset && el.dataset.bind) el.dataset.oud = el.value; });
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
  if (el.dataset.bind && huidigeKlant && (el.dataset.meet !== undefined || /\.(hand\.[BH]|kleurnr)$/.test(el.dataset.bind))) logMaat(huidigeKlant, el);
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
  const ls = $('[data-livesom]', kaart); if (ls) ls.innerHTML = liveSomHTML(p);
  // laag van een gordijn beïnvloedt de vitrage op hetzelfde raam
  if (el.dataset.bind && /\.gord\.laag$/.test(el.dataset.bind)) $$('[data-prod]').forEach(kk => { if (kk !== kaart) { const [w2, pi2] = prodVan(kk.dataset.prod); const r2 = $('.resultaat', kk); if (r2) r2.innerHTML = resultaatHTML(w2.producten[pi2]); } });
  $$('[data-bind$=".gord.laag"]', kaart).forEach(sel => sel.classList.toggle('verplicht', sel.classList.contains('verplicht') && !p.gord.laag));
  $$('[data-bind$=".gord.links"]', kaart).forEach(inp => inp.classList.toggle('verplicht', !(parseMaat(p.gord.links) > 0)));
  const ki = $('.kleur-info', kaart); if (ki) ki.innerHTML = kleurInfoHTML(p);
  $$('[data-par]', kaart).forEach(inp => inp.classList.toggle('afwijkend', eff(p, inp.dataset.par).afw));
  $$('[data-zijde]', kaart).forEach(sel => sel.classList.toggle('verplicht', zijdeVerplicht(p) && !p.zijde));
  $$('[data-zijde-deel]', kaart).forEach(sel => sel.classList.toggle('verplicht', zijdeVerplicht(p) && !deelZijde(p, Number(sel.dataset.zijdeDeel))));
  $$('[data-zijde-ster]', kaart).forEach(st => st.hidden = !zijdeVerplicht(p));
  $$('[data-bind$=".naastLinks"]', kaart).forEach(inp => inp.classList.toggle('verplicht', !(parseMaat(p.naastLinks) > 0)));
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
function telProducten(k) { return k.ruimtes.reduce((a, r) => a + r.ramen.reduce((b, w) => b + w.producten.reduce((c, p) => c + naastN(p), 0), 0), 0); }
function renderLijst() {
  const alle = Object.values(DB.klanten).filter(k => !k.verwijderd);
  const isNieuw = k => k.bron === 'winkel' && !k.gezien;
  const FILTERS = { alles: ['Alles', () => true], meten: ['Nog te meten', k => !k.afgerond], offerte: ['Offerte nog maken', offerteOpen], winkel: ['Nieuw van winkel', isNieuw] };
  const f = FILTERS[lijstFilter] ? lijstFilter : 'alles';
  const lijst = alle.filter(FILTERS[f][1]).sort((a, b) => (isNieuw(b) - isNieuw(a)) || (b.datum || '').localeCompare(a.datum || '') || b.updated - a.updated);
  app().innerHTML = kop('Meetformulier') + `
  <main class="inhoud">
    <div class="acties">
      <button class="knop primair" onclick="maakKlant()">+ Nieuwe meting</button>
      <input type="search" placeholder="Zoek klant…" oninput="filterLijst(this.value)" class="zoek">
    </div>
    <div class="chips filters">${Object.entries(FILTERS).map(([key, [l, fn]]) => `<button class="${key === f ? 'actief' : ''}" onclick="lijstFilter='${key}';route()">${l} <b>${alle.filter(fn).length}</b></button>`).join('')}</div>
    <ul class="lijst" id="klantlijst">
      ${lijst.map(k => `<li class="${isNieuw(k) ? 'nieuw-winkel' : ''}" data-zoek="${esc((k.naam + ' ' + k.adres + ' ' + k.pcplaats + ' ' + k.offertenr).toLowerCase())}">
        <a href="#/k/${k.id}"><strong>${isNieuw(k) ? '<span class="tag">Nieuw van winkel</span> ' : ''}${esc(k.naam || '(geen naam)')}</strong>
        <span>${esc(k.adres)} ${esc(k.pcplaats)}</span>
        <small>${datumNL(k.datum)}${k.offertenr ? ' · offerte ' + esc(k.offertenr) : ''} · ${k.ruimtes.length} ruimtes · ${telProducten(k)} producten · ${statusTekst(k)} ${k.updated > k.syncedAt ? '· <em class="niet-sync">niet gesynchroniseerd</em>' : ''}</small></a></li>`).join('') || '<li class="leeg">Nog geen metingen.</li>'}
    </ul>
    ${(() => { const weg = Object.values(DB.klanten).filter(k => k.verwijderd).sort((a, b) => b.updated - a.updated); return weg.length ? `<details class="kaart prullenbak"><summary>Verwijderde metingen (${weg.length})</summary><ul class="lijst">${weg.map(k => `<li class="rij-knop"><span><strong>${esc(k.naam || '(geen naam)')}</strong> <small>${datumNL(k.datum)}${k.offertenr ? ' · offerte ' + esc(k.offertenr) : ''}</small></span><button class="mini" onclick="herstelKlant('${k.id}')">Terugzetten</button></li>`).join('')}</ul></details>` : ''; })()}
    <div class="acties onder">
      <a class="knop" href="#/instellingen">Instellingen</a>
      <a class="knop" href="#/leeg">Lege printversie</a>
    </div>
  </main>`;
  updateBadge();
}
let lijstFilter = 'alles';
function filterLijst(q) { q = q.toLowerCase(); $$('#klantlijst li[data-zoek]').forEach(li => li.hidden = !li.dataset.zoek.includes(q)); }
function maakKlant() { const k = nieuweKlant(); DB.klanten[k.id] = k; gewijzigd(k); location.hash = '#/k/' + k.id; }

/* ---------- Klant ---------- */
const RUIMTE_SNEL = ['Woonkamer', 'Keuken', 'Eetkamer', 'Slaapkamer', 'Kinderkamer', 'Werkkamer', 'Badkamer', 'Hal', 'Overloop', 'Zolder', 'Serre'];
function renderKlant(k) {
  if (k.bron === 'winkel' && !k.gezien) { k.gezien = Date.now(); gewijzigd(k); }
  app().innerHTML = kop(k.naam || 'Nieuwe meting', '#/') + `
  <main class="inhoud">
    ${k.bron === 'winkel' ? `<section class="kaart wens-kaart"><b>Klaargezet door de winkel</b>${k.aangenomenDoor ? ' · ' + esc(k.aangenomenDoor) : ''}${k.gewensteDatum ? ' · gewenst ' + datumNL(k.gewensteDatum) : ''}${k.wens ? `<div class="wens">${esc(k.wens).replace(/\n/g, '<br>')}</div>` : ''}</section>` : ''}
    ${k.afgerond ? offerteKaart(k) : ''}
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
      <a class="knop" href="#/k/${k.id}/historie">Geschiedenis &amp; meetlogboek</a>
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
function verwijderRuimte(i) { const k = huidigeKlant, ru = k.ruimtes[i]; if (!confirm(`Ruimte "${ru.naam}" met ${ru.ramen.length} ramen verwijderen?`)) return; metOngedaan(k, `voor verwijderen ruimte ${ru.naam}`, `Ruimte "${ru.naam}" verwijderd.`, () => { k.ruimtes.splice(i, 1); gewijzigd(k); renderKlant(k); }); }
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
function verwijderKlant() { const k = huidigeKlant; if (!confirm('Deze hele meting verwijderen?')) return; metOngedaan(k, 'voor verwijderen meting', `Meting ${k.naam || ''} verwijderd.`, () => { k.verwijderd = true; gewijzigd(k); location.hash = '#/'; }); }
function herstelKlant(id) { const k = DB.klanten[id]; if (!k) return; k.verwijderd = false; gewijzigd(k); melding(`Meting ${esc(k.naam || '')} teruggezet.`); route(); }

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
function metingStatus(k) {
  const heeft = k.ruimtes.some(r => r.ramen.some(w => w.producten.some(p => prodDef(p))));
  if (k.afgerond) return k.updated - k.afgerond > 3000 ? ['gewijzigd', 'gewijzigd na afronden'] : ['afgerond', `✓ afgerond ${datumNL(new Date(k.afgerond).toISOString().slice(0, 10))}`];
  if (!heeft) return k.bron === 'winkel' ? ['klaargezet', 'klaargezet door winkel'] : ['nieuw', 'nog te meten'];
  return ['bezig', 'bezig met meten'];
}
const OFFERTE = { zelf: 'Ik maak de offerte zelf', winkel: 'Offerte graag door de winkel', gemaakt: 'Offerte is gemaakt', geen: 'Geen offerte nodig (alleen meten)' };
function offerteTekst(k) {
  const o = k.offerte || {};
  if (!o.keuze) return '';
  if (o.keuze === 'gemaakt') return `offerte ${o.nr ? esc(o.nr) + ' ' : ''}gemaakt${o.door === 'winkel' ? ' door winkel' : ''}${o.verstuurd ? ' · verstuurd' : ''}`;
  return { zelf: 'offerte: ik maak hem', winkel: 'offerte gevraagd aan winkel', geen: 'geen offerte nodig' }[o.keuze];
}
const offerteOpen = k => !!k.afgerond && (!k.offerte || !k.offerte.keuze || k.offerte.keuze === 'zelf' || k.offerte.keuze === 'winkel');
function statusTekst(k) {
  const [c, t] = metingStatus(k), o = offerteTekst(k);
  return `<em class="st-${c}">${t}</em>${o ? ` · <em class="of-${(k.offerte || {}).keuze}">${o}</em>` : ''}`;
}
function offerteKaart(k) {
  const o = k.offerte || (k.offerte = { keuze: '' });
  return `<section class="kaart offerte-kaart"><h2>Offerte</h2>
    <div class="offerte-keuze">${Object.entries(OFFERTE).map(([v, l]) => `<label class="radio-rij"><input type="radio" name="offkeuze" value="${v}" data-bind="offerte.keuze" data-rerender ${o.keuze === v ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    ${o.keuze === 'winkel' ? `<label class="veld"><span>Notitie voor de winkel</span><input data-bind="offerte.notitie" value="${esc(o.notitie || '')}" placeholder="bijv. spoed, klant wil voor de kerst"></label>` : ''}
    ${o.keuze === 'gemaakt' ? `<div class="raster2"><label class="veld"><span>Offertenummer</span><input data-bind="offerte.nr" value="${esc(o.nr || '')}"></label>
      <label class="veld vink-veld"><input type="checkbox" data-bind="offerte.verstuurd" ${o.verstuurd ? 'checked' : ''}> Verstuurd naar klant</label></div>
      ${o.door === 'winkel' ? `<p class="uitleg">Gemaakt door de winkel${o.wie ? ' (' + esc(o.wie) + ')' : ''}${o.datum ? ' op ' + datumNL(o.datum) : ''}.</p>` : ''}` : ''}
  </section>`;
}
// offerte-wijziging vastleggen met tijd (voor samenvoegen met wat de winkel doet)
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset || !/^offerte\./.test(el.dataset.bind || '') || !huidigeKlant) return;
  const k = huidigeKlant, o = k.offerte; o.t = Date.now();
  if (el.dataset.bind === 'offerte.keuze') { o.door = 'inmeter'; if (o.keuze === 'gemaakt') { if (!o.nr) o.nr = k.offertenr || ''; if (!o.datum) o.datum = vandaag(); } }
  if (el.dataset.bind === 'offerte.nr' && o.nr && !k.offertenr) k.offertenr = o.nr;
  offerteGewijzigd(k);
}, true);
// offerte aanpassen telt niet als 'meting gewijzigd na afronden'
function offerteGewijzigd(k) {
  const schoon = k.afgerond && k.updated - k.afgerond <= 3000;
  k.updated = Date.now(); if (schoon) k.afgerond = k.updated;
  bewaarLokaal(k); planSync(); updateBadge();
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
    ${offerteKaart(k)}
    <div class="acties onder">
      <button class="knop primair" onclick="rondAf(${fout.length})">${fout.length ? 'Toch afronden' : '✓ Meting afronden'}</button>
      <a class="knop" href="#/k/${k.id}/overzicht">Overzicht &amp; print</a>
    </div>
  </main>`;
  updateBadge();
}
function rondAf(nFout) {
  if (nFout && !confirm(`Er staan nog ${nFout} punten open. Toch afronden?`)) return;
  const k = huidigeKlant; k.afgerond = Date.now(); gewijzigd(k); k.afgerond = k.updated; bewaarLokaal(k);
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
  if (!Array.isArray(p.naastZijde)) p.naastZijde = [];
  while (p.naastZijde.length < 4) p.naastZijde.push('');
  if (!Array.isArray(p.naastBedLengte)) p.naastBedLengte = [];
  while (p.naastBedLengte.length < 4) p.naastBedLengte.push('');
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
      ${kleurLater(p) ? `<div class="veld"><span>Kleur</span><div class="kleur-later">${KLEUR_LATER}</div></div>`
        : a.fam ? `<label class="veld"><span>Kleurnummer</span><input data-kleur data-live data-bind="${pre}.kleurnr" value="${esc(p.kleurnr)}" inputmode="numeric" autocomplete="off" placeholder="bijv. 0260"></label>`
               : `<label class="veld"><span>Kleur</span><input data-bind="${pre}.kleur" value="${esc(p.kleur)}"></label>`}
      <label class="veld"><span>Prijsklasse ${a.fam ? '<small>(leeg = via kleurnummer)</small>' : ''}</span>${select(pre + '.pk', (a.pk || '').split(',').map(s => s.trim()).filter(Boolean), p.pk, 'data-live', a.fam ? 'automatisch' : '—')}</label>
    </div>${kleurLaterVink(p, pre)}<div class="kleur-info">${kleurInfoHTML(p)}</div>`;

  } else if (t.modus === 'gordijn') {
    blok += kleurLater(p) ? `<div class="veld"><span>Kleur</span><div class="kleur-later">${KLEUR_LATER}</div></div>` : `<label class="veld"><span>Kleur(nummer)</span><input data-bind="${pre}.kleur" value="${esc(p.kleur)}"></label>`;
    blok += kleurLaterVink(p, pre);
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
    const meetrij = (label, as) => `<div class="meetrij"><span class="meetlabel">${label}</span>${[0, 1, 2].map(i => `<label class="meet-cel"><small>${puntNaam(p, as, i)}</small><input data-meet data-live data-bind="${pre}.${as}.${i}" value="${esc(p[as][i])}" inputmode="decimal" placeholder="mm" autocomplete="off" class="meet"></label>`).join('')}</div>`;
    const r = bereken(p);
    blok += `<div class="raster2">
      ${t.calc === 'zon' ? `<div class="veld"><span>Montage</span><div class="segment">
        <label><input type="radio" name="m${sleutel}" value="in" data-bind="${pre}.montage" data-rerender ${p.montage === 'in' ? 'checked' : ''}> In de dag</label>
        <label><input type="radio" name="m${sleutel}" value="op" data-bind="${pre}.montage" data-rerender ${p.montage === 'op' ? 'checked' : ''}> Op de dag</label>
      </div></div>` : ''}
      ${t.calc === 'zon' && p.montage === 'in' && !alsBestel(p) ? `<label class="veld"><span>Naast elkaar in deze dag <small>(1 = gewoon)</small></span>${select(pre + '.naast', ['1', '2', '3', '4'], String(naastAantal(p)), 'data-rerender', null)}</label>` : ''}
      ${naastN(p) === 2 ? `<div class="veld"><span>Verdeling</span><div class="segment">
        <label><input type="radio" name="n${sleutel}" value="gelijk" data-bind="${pre}.naastIndeling" data-rerender ${p.naastIndeling !== 'ongelijk' ? 'checked' : ''}> Gelijk (naad in het midden)</label>
        <label><input type="radio" name="n${sleutel}" value="ongelijk" data-bind="${pre}.naastIndeling" data-rerender ${p.naastIndeling === 'ongelijk' ? 'checked' : ''}> Ongelijk</label>
      </div></div>` : ''}
      ${naastN(p) === 2 && p.naastIndeling === 'ongelijk' ? `<label class="veld"><span>Dagmaat linkerdeel (strak, mm) <b class="verplicht-ster">*</b> <small>linkerkant dag → naad</small></span><input data-meet data-live data-bind="${pre}.naastLinks" value="${esc(p.naastLinks || '')}" inputmode="decimal" autocomplete="off" class="${parseMaat(p.naastLinks) > 0 ? '' : 'verplicht'}"></label>` : ''}
      <label class="veld"><span>Bevestiging</span>${select(pre + '.bevestiging', CONFIG.bevestiging, p.bevestiging)}</label>
      <label class="veld"><span>Montagehoogte (mm) <b class="verplicht-ster">*</b> <small>vloer → bevestiging</small></span><input data-meet data-live data-mh data-bind="${pre}.montagehoogte" value="${esc(p.montagehoogte || '')}" inputmode="decimal" autocomplete="off" class="${parseMaat(p.montagehoogte) > 0 ? '' : 'verplicht'}"></label>
      ${t.calc === 'zon' && naastN(p) === 1 ? `<label class="veld"><span>Bedieningszijde <b class="verplicht-ster" data-zijde-ster ${zijdeVerplicht(p) ? '' : 'hidden'}>*</b> <small>(niet op offerte)</small></span>${select(pre + '.zijde', CONFIG.zijde, p.zijde, `data-live data-zijde class="${zijdeVerplicht(p) && !p.zijde ? 'verplicht' : ''}"`)}</label>` : ''}
      ${t.calc === 'zon' && zijdeOpties(p).length && naastN(p) === 1 ? `<label class="veld"><span>Bedieningslengte (mm) <small>(niet op offerte)</small></span><input data-meet data-live data-bind="${pre}.bedLengte" value="${esc(p.bedLengte || '')}" inputmode="decimal" autocomplete="off"></label>` : ''}
      ${t.calc === 'zon' && zijdeOpties(p).length && naastN(p) > 1 ? Array.from({ length: naastN(p) }, (_, i) => `<label class="veld"><span>Bedieningslengte deel ${i + 1} (${positie(naastN(p), i)}) <small>mm</small></span><input data-meet data-live data-bind="${pre}.naastBedLengte.${i}" value="${esc((p.naastBedLengte || [])[i] || '')}" inputmode="decimal" autocomplete="off"></label>`).join('') : ''}
      ${naastN(p) > 1 ? Array.from({ length: naastN(p) }, (_, i) => `<label class="veld"><span>Bediening deel ${i + 1} (${positie(naastN(p), i)}) <b class="verplicht-ster" data-zijde-ster ${zijdeVerplicht(p) ? '' : 'hidden'}>*</b></span>${select(`${pre}.naastZijde.${i}`, CONFIG.zijde, deelZijde(p, i), `data-live data-zijde-deel="${i}" class="${zijdeVerplicht(p) && !deelZijde(p, i) ? 'verplicht' : ''}"`)}</label>`).join('') : ''}
    </div>
    <div class="veld"><span>Ingevoerde maat is</span><div class="segment">
        <label><input type="radio" name="ms${sleutel}" value="strak" data-bind="${pre}.maatSoort" data-rerender ${!alsBestel(p) ? 'checked' : ''}> Strak – app rekent</label>
        <label><input type="radio" name="ms${sleutel}" value="bestel" data-bind="${pre}.maatSoort" data-rerender ${alsBestel(p) ? 'checked' : ''}> Al bestelmaat – app rekent niets</label>
      </div></div>
    <div class="${alsBestel(p) ? 'bestel-invoer' : 'strak-blok'}">
      <div class="strak-titel">${alsBestel(p) ? 'INGEVOERD ALS BESTELMAAT – app rekent niets' : 'GEMETEN (strak) – niet bestellen'} <small>mm · ${!alsBestel(p) && t.calc === 'zon' && p.montage === 'in' ? '3-puntsmeting aanbevolen, kleinste telt' : 'kleinste telt'}</small></div>
      ${meetrij(naastActief(p) ? 'Totale dag' : lB, 'B')}${meetrij(lH, 'H')}
      <div class="live-som" data-livesom>${liveSomHTML(p)}</div>
    </div>
    <details class="correcties" ${alsBestel(p) ? 'hidden' : ''}><summary>Correcties (standaard ingevuld)</summary>
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
function kleurLaterVink(p, pre) {
  if (String(p.kleurnr || '').trim() || String(p.kleur || '').trim()) return '';
  return `<label class="veld vink-veld"><input type="checkbox" data-bind="${pre}.kleurLater" data-rerender ${p.kleurLater ? 'checked' : ''}> Klant kiest kleur later (in de winkel)</label>`;
}
function kleurInfoHTML(p) {
  const k = kleurInfo(p);
  if (!k) return '';
  if (k.fout) return `<div class="waarschuwing">⚠ Kleurnummer ${esc(k.nr)} niet gevonden bij ${esc(p.art)}</div>`;
  return `<div class="kleur-ok">${esc(k.kwaliteit)} · <b>${esc(p.pk || k.pk)}</b>${p.pk && p.pk !== k.pk ? ` <span class="tag">handmatig (kleur = ${esc(k.pk)})</span>` : ''}${k.plisse ? ` · <b class="plisse">plissé ${esc(k.plisse)} mm</b>` : ''}</div>`;
}
// direct onder de meetvelden: wat de app met de ingetikte maat doet
function liveSomHTML(p) {
  const r = bereken(p); if (!r || r.t.calc === 'los') return '';
  if (r.alsBestel) return r.B == null && r.H == null ? '' : `<b>Wordt zo besteld:</b> ${r.B ?? '—'} × ${r.H ?? '—'}`;
  const regels = [];
  if (r.naastRegels) regels.push(`Breedte: dag ${r.naast.dag} → ${r.naast.ongelijk ? `links ${r.naast.delen[0]} + rechts ${r.naast.delen[1]}` : `${r.naast.n} × ${r.naast.delen[0]}`} (speling ${r.naast.speling})`);
  else if (r.uitB) regels.push('Breedte: ' + r.uitB);
  if (r.uitH) regels.push('Hoogte: ' + r.uitH);
  return regels.length ? `<b>App rekent → bestelmaat</b><br>${regels.map(esc).join('<br>')}` : '';
}
function resultaatHTML(p) {
  const r = bereken(p);
  if (!r) return '';
  const meldingen = `${r.afwijkend.length ? `<div class="let-op">Afwijkend van standaard: ${esc(r.afwijkend.join(', '))}</div>` : ''}
    ${r.waarsch.map(w => `<div class="waarschuwing">⚠ ${esc(w)}</div>`).join('')}
    ${r.info ? `<div class="info">${esc(r.info)}</div>` : ''}${r.info2 ? `<div class="info">Let op: ${esc(r.info2)}</div>` : ''}${r.info3 ? `<div class="info">${esc(r.info3)}</div>` : ''}${r.info4 ? `<div class="let-op">${esc(r.info4)}</div>` : ''}${r.delen ? `<div class="info">Verdeling: links ${r.delen[0]} mm · rechts ${r.delen[1]} mm</div>` : ''}`;
  if (r.t.calc === 'los') return meldingen;
  if (r.naast && r.naast.delen) return `<div class="bestel ${r.hand.B || r.hand.H ? 'hand' : ''}">
      <div class="bestel-label">${esc(naastTekst(r)).toUpperCase()} – ${r.naast.n} PRODUCTEN${r.hand.B || r.hand.H ? ' <span class="tag">handmatig</span>' : ''}</div>
      <div class="delen">${r.naast.delen.map((b, i) => `<div class="deel"><div class="bestel-label">Deel ${i + 1} – ${positie(r.naast.n, i)} · BESTELMAAT <small>mm</small></div><div class="bestel-maat">${b} × ${r.H ?? '—'}</div>${deelZijde(p, i) ? `<small>bediening ${esc(deelZijde(p, i).toLowerCase())}</small>` : ''}</div>`).join('')}</div>
      <table class="naast-som">${r.naastRegels.map(([a, b], i) => `<tr class="${i === 2 ? 'nadruk' : ''}"><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</table>
      <div class="bestel-uitleg">${r.hand.B ? esc(r.uitB) + '<br>' : ''}${esc(r.uitH)}</div>
    </div>${meldingen}`;
  return `<div class="bestel ${r.hand.B || r.hand.H ? 'hand' : ''}">
      <div class="bestel-label">BESTELMAAT <small>mm</small>${r.hand.B || r.hand.H ? ' <span class="tag">handmatig</span>' : ''}</div>
      <div class="bestel-maat">${fmtMaat(r)}</div>
      ${r.naast ? `<div class="bestel-naast">${esc(naastTekst(r))}</div>` : ''}
      <div class="bestel-uitleg">${esc(r.uitB)}${r.uitH ? '<br>' + esc(r.uitH) : ''}</div>
    </div>${meldingen}`;
}
function prodVan(sleutel) { const [ri, wi, pi] = sleutel.split('.').map(Number); return [huidigeKlant.ruimtes[ri].ramen[wi], pi]; }
function bevestigProduct(s) { const [w, pi] = prodVan(s); delete w.producten[pi].overgenomen; gewijzigd(huidigeKlant); route(); }
function leegProduct(s) { if (!confirm('Overgenomen gegevens wissen en dit product leeg maken?')) return; const k = huidigeKlant; metOngedaan(k, 'voor leegmaken product', 'Product leeg gemaakt.', () => { const [w, pi] = prodVan(s); const oud = w.producten[pi]; const n = nieuwProduct(); n.montagehoogte = oud.montagehoogte; n.B = oud.B; n.H = oud.H; w.producten[pi] = n; gewijzigd(k); route(); }); }
function maakProduct(ri, wi) { huidigeKlant.ruimtes[ri].ramen[wi].producten.push(nieuwProduct()); gewijzigd(huidigeKlant); route(); }
function dupliceerProduct(s) { const [w, pi] = prodVan(s); const c = kopie(w.producten[pi]); c.id = uid(); c.overgenomen = `product ${pi + 1} van raam ${w.nr}`; w.producten.splice(pi + 1, 0, c); gewijzigd(huidigeKlant); route(); }
function verwijderProduct(s) { if (!confirm('Product verwijderen?')) return; const k = huidigeKlant; const [w, pi] = prodVan(s); const t = prodDef(w.producten[pi]); metOngedaan(k, `voor verwijderen product (raam ${w.nr})`, `${t ? t.naam : 'Product'} verwijderd.`, () => { w.producten.splice(pi, 1); gewijzigd(k); route(); }); }
function kopieerRaam(ri, wi) {
  const ru = huidigeKlant.ruimtes[ri]; const c = kopie(ru.ramen[wi]);
  const bronNr = ru.ramen[wi].nr;
  c.id = uid(); c.nr = String(ru.ramen.length + 1); c.fotos = []; c.producten.forEach(p => { p.id = uid(); if (p.art) p.overgenomen = `${ru.naam} raam ${bronNr}`; p.B = ['', '', '']; p.H = ['', '', '']; p.montagehoogte = ''; p.hand = { B: '', H: '', reden: '' }; });
  ru.ramen.push(c); gewijzigd(huidigeKlant); location.hash = `#/k/${huidigeKlant.id}/raam/${c.id}`;
}
function verwijderRaam(ri, wi) { if (!confirm('Dit raam verwijderen?')) return; const k = huidigeKlant; const w = k.ruimtes[ri].ramen[wi]; metOngedaan(k, `voor verwijderen raam ${w.nr} (${k.ruimtes[ri].naam})`, `Raam ${w.nr} verwijderd.`, () => { k.ruimtes[ri].ramen.splice(wi, 1); gewijzigd(k); location.hash = '#/k/' + k.id; }); }

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
  // foto blijft op het toestel bewaard, zodat hij via Geschiedenis terug kan
  const k = huidigeKlant, w = k.ruimtes[ri].ramen[wi];
  metOngedaan(k, `voor verwijderen foto (raam ${w.nr})`, 'Foto verwijderd.', () => { w.fotos.splice(fi, 1); gewijzigd(k); route(); });
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
function printbonHTML(k, opt = {}) {
  const bijlage = !!opt.bijlage, fotos = opt.fotos !== false;
  const ruimtes = k.ruimtes.filter(r => r.ramen.some(w => w.producten.some(p => prodDef(p))));
  const totaal = 1 + ruimtes.length + (bijlage ? 1 : 0);
  const kopje = (nr, sub) => `<div class="blad-kop"><img src="logo.png" alt="Edison Interieur"><div class="blad-kop-tekst"><b>${esc(k.naam)}</b> · ${esc(k.adres)}, ${esc(k.pcplaats)}${k.offertenr ? ' · Offerte ' + esc(k.offertenr) : ''}<br>${esc(sub)}</div><div class="bladnr">Blad ${nr} van ${totaal}</div></div>`;
  const voet = `<div class="blad-voet">Alle maten in mm. Maten op dit formulier zijn <b>BESTELMATEN</b>. Ingemeten ${datumNL(k.datum)}.</div>`;
  let html = `<div class="print">
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
            <tbody>${w.producten.filter(p => prodDef(p)).map(p => printRijen(p, bereken(p))).join('')}
            </tbody></table>
          ${w.opmerking ? `<div class="raam-opm">${esc(w.opmerking)}</div>` : ''}
          ${fotos && w.fotos.length ? `<div class="print-fotos">${w.fotos.map(f => `<img data-foto="${f.id}" alt="">`).join('')}</div>` : ''}
        </div>`).join('')}
      ${voet}</section>`;
  });
  if (bijlage) {
    html += `<section class="blad bijlage">${kopje(totaal, 'Bijlage')}
      <h2 class="bijlage-titel">BIJLAGE – GEMETEN MATEN – NIET BESTELLEN</h2>
      <p class="bijlage-uitleg">Dit zijn de strakke (gemeten) maten. Bestel altijd op de bestelmaat van de ruimtebladen.</p>
      <table class="tabel grijs"><thead><tr><th>Ruimte</th><th>Raam</th><th>Product</th><th>Montage</th><th>Breedte 1 / 2 / 3</th><th>Hoogte 1 / 2 / 3</th><th>Strak</th><th>Berekening</th></tr></thead><tbody>
      ${ruimtes.flatMap(ru => ru.ramen.flatMap(w => w.producten.map(p => [p, bereken(p)]).filter(([, r]) => r && r.t.calc !== 'los' && !r.alsBestel).map(([p, r]) => `<tr><td>${esc(ru.naam)}</td><td>${esc(w.nr)}</td><td>${esc(r.t.naam)}</td><td>${r.t.calc === 'zon' ? (p.montage === 'in' ? 'In' : 'Op') : ''}</td><td>${p.B.map(v => esc(v) || '–').join(' / ')}</td><td>${p.H.map(v => esc(v) || '–').join(' / ')}</td><td>${fmtStrak(r)}</td><td><small>${esc(r.uitB)}${r.uitH ? '<br>' + esc(r.uitH) : ''}</small></td></tr>`))).join('')}
      </tbody></table></section>`;
  }
  return html + '</div>';
}
function renderOverzicht(k) {
  const ruimtes = k.ruimtes.filter(r => r.ramen.some(w => w.producten.some(p => prodDef(p))));
  const fouten = ruimtes.flatMap(ru => ru.ramen.flatMap(w => w.producten.map(p => bereken(p)).filter(r => r && r.waarsch.length).map(r => `${ru.naam} raam ${w.nr}: ${r.waarsch.join(' ')}`)));
  let html = kop('Overzicht', '#/k/' + k.id) + `
  <div class="werkbalk no-print">
    <button class="knop primair" onclick="window.print()">Printen / PDF</button>
    <button class="knop" onclick="kopieerExcel()">Kopieer voor Excel</button>
    <label class="schakel"><input type="checkbox" ${werkprint ? 'checked' : ''} onchange="werkprint=this.checked;route()"> Werkprint (met bijlage gemeten maten)</label>
    ${fouten.length ? `<div class="waarschuwing breed">⚠ ${fouten.length} product(en) met een melding:<br>${fouten.map(esc).join('<br>')}</div>` : ''}
  </div>
  <div class="print-houder">${printbonHTML(k, { bijlage: werkprint })}</div>`;
  app().innerHTML = html;
  schaalPrint(); laadFotos(); updateBadge();
}
function printRijen(p, r) {
  if (r.naast && r.naast.delen) {
    const n = r.naast.n;
    return r.naast.delen.map((b, i) => `
              <tr class="${i < n - 1 ? 'deel-rij' : ''}"><td><b>${esc(r.t.naam)}</b><br><b class="deel-tag">deel ${i + 1} van ${n} · ${positie(n, i)}</b><br><small>${esc(p.cat)}</small>${p.plaatsen === 'Nee' ? '<br><small>klant plaatst zelf</small>' : ''}</td>
                <td>In de dag${p.bevestiging ? '<br><small>' + esc(p.bevestiging) + '</small>' : ''}${parseMaat(p.montagehoogte) > 0 ? '<br><small>Mh ' + parseMaat(p.montagehoogte) + ' mm</small>' : '<br><small class="fout">Mh ontbreekt</small>'}</td>
                <td class="kol-bestel"><span class="bestel-print">${b} × ${r.H ?? '—'}</span>${r.hand.B || r.hand.H ? '<br><span class="tag">handmatig: ' + esc(p.hand.reden || 'geen reden') + '</span>' : ''}${i === n - 1 ? `<br><small>${esc(naastTekst(r))}: samen ${r.naast.som} mm · speling ${r.naast.speling} mm</small><div class="dag-strak">${esc(dagStrakTekst(r))}</div>` : ''}</td>
                <td>${kleurLater(p) ? `<b class="kleur-later">${KLEUR_LATER}</b>` : esc(kleurTekst(p))}${effPk(p) ? '<br><small>' + esc(effPk(p)) + '</small>' : ''}</td>
                <td><small>${esc(uitvoeringTekst(p, i))}${p.opmerking && i === 0 ? '<br><i>' + esc(p.opmerking) + '</i>' : ''}</small></td></tr>`).join('') +
      `<tr class="strak-rij no-print"><td colspan="5"><button class="mini" onclick="this.parentNode.classList.toggle('open')">Toon gemeten maten</button>
                <span class="strak-detail">GEMETEN – NIET BESTELLEN: ${fmtStrak(r)} mm · ${esc(r.uitB)}${r.uitH ? ' · ' + esc(r.uitH) : ''}</span></td></tr>`;
  }
  return `
              <tr><td><b>${esc(r.t.naam)}</b><br><small>${esc(p.cat)}</small>${p.plaatsen === 'Nee' ? '<br><small>klant plaatst zelf</small>' : ''}</td>
                <td>${r.t.calc === 'zon' ? (p.montage === 'in' ? 'In de dag' : 'Op de dag') : ''}${p.bevestiging ? '<br><small>' + esc(p.bevestiging) + '</small>' : ''}${r.t.calc !== 'los' ? (parseMaat(p.montagehoogte) > 0 ? '<br><small>Mh ' + parseMaat(p.montagehoogte) + ' mm</small>' : '<br><small class="fout">Mh ontbreekt</small>') : ''}</td>
                <td class="kol-bestel">${r.t.calc === 'los' ? `${esc(p.aantal)}×` : (r.naast && r.naast.delen ? (r.naast.ongelijk ? `<span class="bestel-print klein">L ${r.naast.delen[0]} × ${r.H ?? '—'}</span><br><span class="bestel-print klein">R ${r.naast.delen[1]} × ${r.H ?? '—'}</span>` : `<span class="bestel-print klein">${r.naast.n} × (${r.B} × ${r.H ?? '—'})</span>`) : `<span class="bestel-print">${fmtMaat(r)}</span>`)}${r.alsBestel ? '<br><span class="tag">door inmeter als bestelmaat ingevoerd</span>' : ''}${r.naast ? `<br><b>${esc(naastTekst(r))}</b>${r.naast.som ? `<br><small>samen ${r.naast.som} mm · speling ${r.naast.speling} mm</small>` : ''}<div class="dag-strak">${esc(dagStrakTekst(r))}</div>` : ''}${r.hand.B || r.hand.H ? '<br><span class="tag">handmatig: ' + esc(p.hand.reden || 'geen reden') + '</span>' : ''}${r.afwijkend.length ? '<br><small class="afw">afwijkend: ' + esc(r.afwijkend.join(', ')) + '</small>' : ''}</td>
                <td>${kleurLater(p) ? `<b class="kleur-later">${KLEUR_LATER}</b>` : esc(kleurTekst(p))}${effPk(p) ? '<br><small>' + esc(effPk(p)) + '</small>' : ''}</td>
                <td><small>${esc(uitvoeringTekst(p))}${p.opmerking ? '<br><i>' + esc(p.opmerking) + '</i>' : ''}</small></td></tr>
              ${r.t.calc !== 'los' && !r.alsBestel ? `<tr class="strak-rij no-print"><td colspan="5"><button class="mini" onclick="this.parentNode.classList.toggle('open')">Toon gemeten maten</button>
                <span class="strak-detail">GEMETEN – NIET BESTELLEN: ${fmtStrak(r)} mm · ${esc(r.uitB)}${r.uitH ? ' · ' + esc(r.uitH) : ''}</span></td></tr>` : ''}`;
}
function samenvatting(ru) {
  const telling = {};
  ru.ramen.forEach(w => w.producten.forEach(p => { const t = prodDef(p); if (t) telling[t.naam] = (telling[t.naam] || 0) + (t.calc === 'los' ? Number(p.aantal) || 1 : naastN(p)); }));
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
        const zet = (rij, n) => { const s = JSON.stringify(rij); invoer.set(s, { rij, n: (invoer.get(s)?.n || 0) + n }); };
        if (r.naast && r.naast.delen && r.naast.ongelijk) r.naast.delen.forEach(b => { const d = rij.slice(); d[4] = b; zet(d, 1); });
        else zet(rij, r.t.calc === 'los' ? (Number(p.aantal) || 1) : (r.naast && r.naast.delen ? r.naast.n : 1));
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
const exportTekst = ex => ex.regels.map(r => r.map(v => String(v ?? '').replace(/[\t\n\r]/g, ' ')).join('\t')).join('\n');
async function kopieerExcel() {
  const k = huidigeKlant; const ex = exportRegels(k); const L = CAT.limieten;
  const te = [];
  if (ex.aantalInvoer > L.invoer) te.push(`${ex.aantalInvoer} productregels (Invoer heeft er ${L.invoer})`);
  if (ex.aantalGord > L.gordijnen) te.push(`${ex.aantalGord} gordijnregels (tab Gordijnen heeft er ${L.gordijnen})`);
  if (ex.aantalRuimtes > L.ruimtes) te.push(`${ex.aantalRuimtes} ruimtes (Invoer heeft er ${L.ruimtes})`);
  const tekst = exportTekst(ex);
  let ok = false;
  try { await navigator.clipboard.writeText(tekst); ok = true; } catch (e) {}
  if (!ok) { const ta = document.createElement('textarea'); ta.value = tekst; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); }
  let m = ok ? `Gekopieerd: ${ex.aantalInvoer} productregels, ${ex.aantalGord} gordijnen, ${ex.aantalRuimtes} ruimtes.<br>Excel: tab <b>Import</b> → cel A1 → plakken → macro <b>ImporteerMeting</b>.<br>Makkelijker: in Excel macro <b>HaalMeting</b>, dan hoef je niet te plakken.` : 'Kopiëren lukte niet.';
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
        ${[['overlap', 'Overlap gordijn (stel)'], ['overlapStuk', 'Overlap gordijn (stuk)'], ['vloerafstand', 'Gordijn net boven de grond (−)'], ['opGrond', 'Gordijn op de grond (+)'], ['vensterbank', 'Gordijn tot vensterbank (−)'], ['vitrageExtra', 'Extra vitrage tweede laag (−)'], ['aftrekB', 'Aftrek breedte in de dag'], ['aftrekH', 'Aftrek hoogte in de dag'], ['overmaatB', 'Overmaat breedte op de dag'], ['overmaatH', 'Overmaat hoogte op de dag']].map(([k, l]) => `<label class="veld"><span>${l}</span><input data-ibind="waarden.${k}" data-num value="${esc(w[k])}" inputmode="decimal"></label>`).join('')}
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
      ${DB.inst.laatsteSync ? `<p class="uitleg">Laatste sync: <b>${(DB.inst.laatsteSync.ms / 1000).toFixed(1).replace('.', ',')} s</b> · ${DB.inst.laatsteSync.verstuurd} verstuurd · ${DB.inst.laatsteSync.niets ? 'niets nieuws' : DB.inst.laatsteSync.opgehaald + ' opgehaald'}${DB.inst.laatsteSync.fotos ? ' · ' + DB.inst.laatsteSync.fotos + " foto's" : ''} · ${tijdNL(DB.inst.laatsteSync.t)}</p>` : ''}
    </section>
    <section class="kaart">
      <h2>Winkel-toegang</h2>
      <p class="uitleg">De winkel gebruikt een eigen, simpele pagina met een eigen wachtwoord. Daarmee kunnen ze alleen opdrachten klaarzetten, de lijst en printbonnen bekijken en een offerte afvinken. Je metingen kunnen ze niet wijzigen.</p>
      <div class="acties"><button class="knop" onclick="maakWinkelToegang()">Winkel-link maken / vernieuwen</button></div>
      <div id="winkel-link"></div>
    </section>
    <section class="kaart">
      <h2>Catalogus (producten, kleurnummers, opties)</h2>
      <p class="uitleg">Nu: ${esc(CAT.bron)} · ${Object.values(CAT.kleuren).reduce((a, f) => a + Object.keys(f).length, 0)} kleurnummers.<br>Nieuwe prijslijst? Draai in je master de macro <b>StuurCatalogus</b>. De app haalt hem daarna vanzelf op. Deze knop is alleen nodig als je de tabs met de hand in de Sheet hebt geplakt.</p>
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
async function maakWinkelToegang() {
  if (!confirm('Nieuw winkelwachtwoord maken? Een eventueel oud winkelwachtwoord werkt daarna niet meer.')) return;
  try {
    const j = await post({ action: 'winkel_sleutel' });
    const link = new URL('winkel.html', location.href).href + '#koppel=' + encodeURIComponent(btoa(JSON.stringify({ url: DB.inst.url, ww: j.sleutel })));
    $('#winkel-link').innerHTML = `<p><b>Winkelwachtwoord:</b> <code>${esc(j.sleutel)}</code></p>
      <p class="uitleg">Open deze link één keer op de winkelcomputer. Daarna staat de koppeling erin. Deel hem alleen met collega's.</p>
      <textarea readonly rows="3" class="link-vak" onclick="this.select()">${esc(link)}</textarea>
      <div class="acties"><button class="knop" id="kopieer-winkel-link">Kopieer link</button></div>`;
    $('#kopieer-winkel-link').onclick = () => navigator.clipboard.writeText(link).then(() => melding('Link gekopieerd.'), () => melding('Kopiëren lukte niet; selecteer de link en kopieer zelf.', true));
  } catch (e) { melding('Lukt niet: ' + e.message, true); }
}
function zorgType(id) { if (!DB.inst.aftrekPerType[id]) DB.inst.aftrekPerType[id] = { B: '', H: '' }; }
async function testVerbinding() {
  try { const j = await post({ action: 'test' }); melding('Verbinding werkt: ' + (j.bericht || 'ok') + '. Metingen worden opgehaald…'); DB.inst.laatstePull = 0; bewaarLokaal([]); sync(); }
  catch (e) { melding('Verbinding mislukt: ' + e.message, true); }
}
async function haalCatalogus(stil) {
  try {
    if (!stil) melding('Catalogus ophalen…');
    const j = await post({ action: 'catalogus' });
    const c = j.catalogus;
    if (!c || !c.categorieen || !c.categorieen.length) throw new Error('geen catalogus gevonden in de Sheet');
    CAT = c; localStorage.setItem('emf_cat', JSON.stringify(c));
    melding(`${stil ? 'Nieuwe prijslijst binnen' : 'Catalogus bijgewerkt'}: ${c.categorieen.length} productgroepen, ${Object.values(c.kleuren).reduce((a, f) => a + Object.keys(f).length, 0)} kleurnummers.`);
    const bezig = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (!stil || !bezig) route();
    return true;
  } catch (e) { if (!stil) melding('Catalogus ophalen mislukt: ' + e.message, true); return false; }
}
function herstelCatalogus() { localStorage.removeItem('emf_cat'); CAT = CATALOGUS_STANDAARD; route(); }
function exporteer() {
  const blob = new Blob([JSON.stringify({ klanten: DB.klanten, inst: { ...DB.inst, sleutel: '' } }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `meetformulier-backup-${vandaag()}.json`; a.click();
}
async function importeer(input) {
  try { const d = JSON.parse(await input.files[0].text()); Object.keys(d.klanten || {}).forEach(id => { if (DB.klanten[id]) snapshot(DB.klanten[id], 'voor back-up terugzetten'); }); Object.assign(DB.klanten, d.klanten || {}); Object.values(DB.klanten).forEach(k => k.syncedAt = 0); bewaarLokaal(); melding('Back-up teruggezet.'); planSync(); }
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

/* ---------- Geschiedenis: snapshots, meetlogboek, ongedaan maken ----------
   Alles staat eerst op het toestel (IndexedDB, werkt offline) en gaat bij het
   synchroniseren ook naar de Sheet (tabs Historie en Meetlog). */
const histDB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('emf-historie', 2);
    r.onupgradeneeded = ev => {
      const d = r.result, t = r.transaction;
      if (ev.oldVersion < 1) { d.createObjectStore('snaps', { keyPath: 'id' }).createIndex('klant', 'klant'); d.createObjectStore('log', { keyPath: 'id' }).createIndex('klant', 'klant'); }
      // v2: index op 'sent', zodat de wachtrij zonder alles door te lezen te vinden is
      ['snaps', 'log'].forEach(n => { const st = t.objectStore(n); if (!st.indexNames.contains('sent')) st.createIndex('sent', 'sent'); });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
  return {
    put: (s, o) => tx(s, 'readwrite', st => st.put(o)),
    putAlle: (s, arr) => tx(s, 'readwrite', st => { arr.forEach(o => st.put(o)); return null; }),
    vanKlant: (s, id) => tx(s, 'readonly', st => st.index('klant').getAll(id)),
    alle: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    wachtrij: (s, max) => tx(s, 'readonly', st => st.index('sent').getAll(IDBKeyRange.only(0), max))
  };
})();
const SNAP_INTERVAL = 10 * 60 * 1000, BEWAAR_ALLES = 30 * 864e5;
const laatsteSnap = {}; // klant-id -> { t, vgl }
const snapVergelijk = k => { const c = kopie(k); delete c.updated; delete c.syncedAt; delete c.excel; return JSON.stringify(c); };
// bewaart een volledige kopie van de meting (alleen als er iets veranderd is)
async function snapshot(k, reden) {
  if (!k || (!k.naam && !k.ruimtes.length)) return;
  const t = Date.now(), vgl = snapVergelijk(k), c = kopie(k); delete c.excel;
  const json = JSON.stringify(c), naam = k.naam, ruimtes = k.ruimtes.length, producten = telProducten(k);
  try {
    if (!laatsteSnap[k.id]) {
      const eerdere = await histDB.vanKlant('snaps', k.id);
      const nieuwste = eerdere.sort((a, b) => b.t - a.t)[0];
      laatsteSnap[k.id] = nieuwste ? { t: nieuwste.t, vgl: nieuwste.vgl || '' } : { t: 0, vgl: '' };
    }
    if (laatsteSnap[k.id].vgl === vgl) { laatsteSnap[k.id].t = t; return; }
    laatsteSnap[k.id] = { t, vgl };
    await histDB.put('snaps', { id: uid(), klant: k.id, naam, t, reden, ruimtes, producten, json, vgl, sent: 0 });
  } catch (e) { console.log('snapshot mislukt', e); }
}
function snapPeriodiek(k) { const l = laatsteSnap[k.id]; if (!l || Date.now() - l.t > SNAP_INTERVAL) snapshot(k, 'automatisch (elke 10 min)'); }

// meetlogboek: elke ingetikte maat, nooit gewist
function plekVan(k, pad) {
  const d = pad.split('.'); const plek = []; let p = null, rest = d;
  if (d[0] === 'ruimtes') {
    const ru = k.ruimtes[+d[1]]; plek.push(ru ? ru.naam || 'ruimte' : 'ruimte'); rest = d.slice(2);
    if (d[2] === 'ramen') {
      const w = ru && ru.ramen[+d[3]]; plek.push('raam ' + (w ? w.nr : '?')); rest = d.slice(4);
      if (d[4] === 'producten') { p = w && w.producten[+d[5]]; const t = p && prodDef(p); plek.push(t ? t.naam : 'product ' + (+d[5] + 1)); rest = d.slice(6); }
    }
  }
  const [a, b] = rest;
  const veld = a === 'B' ? `${p && naastN(p) > 1 ? 'totale dag' : 'breedte'} (${p ? puntNaam(p, 'B', +b) : +b + 1 + 'e'})` : a === 'H' ? `hoogte (${p ? puntNaam(p, 'H', +b) : +b + 1 + 'e'})`
    : a === 'hand' ? 'handmatige ' + (b === 'B' ? 'breedte' : 'hoogte') : a === 'naastBedLengte' ? `bedieningslengte deel ${+b + 1}` : ({ bedLengte: 'bedieningslengte', montagehoogte: 'montagehoogte', naastLinks: 'dagmaat linkerdeel', kozijndiepte: 'kozijndiepte', kleurnr: 'kleurnummer' }[a] || rest.join('.'));
  return { plek: plek.join(' · '), veld };
}
function logMaat(k, el) {
  const oud = el.dataset.oud || '', nieuw = el.value;
  if (oud === nieuw) return;
  el.dataset.oud = nieuw;
  const { plek, veld } = plekVan(k, el.dataset.bind);
  histDB.put('log', { id: uid(), klant: k.id, naam: k.naam, t: Date.now(), plek, veld, oud, nieuw, sent: 0 }).catch(() => {});
}

// ongedaan maken na verwijderen
let ongedaan = null;
function metOngedaan(k, reden, tekst, actie) {
  const voor = JSON.stringify(k);
  snapshot(k, reden);
  actie();
  ongedaan = { id: k.id, json: voor };
  melding(`${esc(tekst)} <button class="mini" onclick="maakOngedaan(event)">Ongedaan maken</button>`, false, 10000);
}
function maakOngedaan(e) {
  if (e) e.stopPropagation();
  if (!ongedaan) return;
  const k = JSON.parse(ongedaan.json); ongedaan = null;
  if (DB.klanten[k.id]) snapshot(DB.klanten[k.id], 'voor ongedaan maken');
  k.updated = Date.now(); DB.klanten[k.id] = k;
  if (huidigeKlant && huidigeKlant.id === k.id) huidigeKlant = k;
  bewaarLokaal(k); planSync(); updateBadge();
  const m = $('#melding'); if (m) m.className = 'no-print';
  if (location.hash === '#/' && !k.verwijderd) location.hash = '#/k/' + k.id; else route();
  melding('Ongedaan gemaakt.');
}

// naar de Sheet (werkt ook als het Apps Script nog niet bijgewerkt is: dan blijft het op het toestel)
let historieFout = '';
// wat er nog naar de Sheet moet (via de index, niet alles doorlezen)
async function historieWachtrij() {
  try { return { snaps: await histDB.wachtrij('snaps', 5), logs: await histDB.wachtrij('log', 300) }; }
  catch (e) { return { snaps: [], logs: [] }; }
}
async function markeerHistorieVerstuurd(w) {
  w.snaps.forEach(x => { x.sent = 1; }); w.logs.forEach(x => { x.sent = 1; });
  if (w.snaps.length) await histDB.putAlle('snaps', w.snaps);
  if (w.logs.length) await histDB.putAlle('log', w.logs);
}
async function syncHistorie() {
  try {
    for (let ronde = 0; ronde < 5; ronde++) {
      const { snaps, logs } = await historieWachtrij();
      if (!snaps.length && !logs.length) break;
      await post({ action: 'historie', snaps: snaps.map(({ sent, vgl, ...x }) => x), logs: logs.map(({ sent, ...x }) => x) });
      snaps.forEach(x => { x.sent = 1; }); logs.forEach(x => { x.sent = 1; });
      await histDB.putAlle('snaps', snaps); await histDB.putAlle('log', logs);
    }
    historieFout = '';
  } catch (e) { historieFout = e.message; }
}
// na 30 dagen: per klant één snapshot per dag bewaren (alleen als hij al in de Sheet staat)
async function ruimHistorieOp() {
  try {
    const grens = Date.now() - BEWAAR_ALLES, gezien = {};
    const oud = (await histDB.alle('snaps')).filter(s => s.t < grens).sort((a, b) => b.t - a.t);
    for (const s of oud) { const sl = s.klant + '|' + new Date(s.t).toISOString().slice(0, 10); if (gezien[sl] && s.sent) await histDB.del('snaps', s.id); else gezien[sl] = 1; }
  } catch (e) {}
}

const tijdNL = t => { const d = new Date(t); return `${datumNL(d.toISOString().slice(0, 10))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
async function renderHistorie(k) {
  app().innerHTML = kop('Geschiedenis', '#/k/' + k.id) + `
  <main class="inhoud">
    <section class="kaart"><h2>${esc(k.naam || 'Meting')} – versies</h2>
      <p class="uitleg">Volledige kopieën van deze meting: bij openen, elke 10 minuten tijdens het werken en altijd vlak voor verwijderen of terugzetten. Terugzetten bewaart eerst de huidige versie, dus het is altijd ongedaan te maken.</p>
      <div id="snap-bekijk"></div><div id="snaps">Laden…</div></section>
    <section class="kaart"><h2>Meetlogboek</h2>
      <p class="uitleg">Elke maat die je hebt ingetikt, met tijd. Wordt nooit gewist. Nieuwste bovenaan.</p>
      <div id="meetlog">Laden…</div></section>
  </main>`;
  updateBadge();
  const lok = { snaps: await histDB.vanKlant('snaps', k.id).catch(() => []), logs: await histDB.vanKlant('log', k.id).catch(() => []) };
  toonHistorie(k, lok, null);
  if (DB.inst.url && DB.inst.sleutel && navigator.onLine) {
    try { const j = await post({ action: 'historie_lijst', klantId: k.id }); if (location.hash === `#/k/${k.id}/historie`) toonHistorie(k, lok, j); }
    catch (e) { const el = $('#snaps'); if (el) el.insertAdjacentHTML('afterbegin', `<p class="uitleg">Versies in de Sheet nu niet bereikbaar (${esc(e.message)}). Je ziet de versies op dit toestel.</p>`); }
  }
}
function toonHistorie(k, lok, srv) {
  const snaps = new Map(), logs = new Map();
  (srv && srv.snaps || []).forEach(s => snaps.set(s.id, { ...s, server: true }));
  lok.snaps.forEach(s => snaps.set(s.id, { ...s, lokaal: true }));
  (srv && srv.logs || []).forEach(l => logs.set(l.id, l));
  lok.logs.forEach(l => logs.set(l.id, l));
  const S = [...snaps.values()].sort((a, b) => b.t - a.t), L = [...logs.values()].sort((a, b) => b.t - a.t);
  const sEl = $('#snaps'), lEl = $('#meetlog'); if (!sEl || !lEl) return;
  sEl.innerHTML = S.length ? `<table class="tabel historie"><thead><tr><th>Tijd</th><th>Moment</th><th>Inhoud</th><th></th></tr></thead><tbody>${S.map(s => `<tr><td>${tijdNL(s.t)}</td><td>${esc(s.reden)}</td><td>${s.ruimtes} ruimtes · ${s.producten} producten</td><td class="knoppen"><button class="mini" onclick="bekijkSnap('${s.id}')">Bekijk</button><button class="mini" onclick="zetSnapTerug('${s.id}')">Terugzetten</button></td></tr>`).join('')}</tbody></table>` : '<p class="uitleg">Nog geen versies.</p>';
  lEl.innerHTML = L.length ? `<table class="tabel historie"><thead><tr><th>Tijd</th><th>Plek</th><th>Veld</th><th>Was</th><th>Werd</th></tr></thead><tbody>${L.map(l => `<tr><td>${tijdNL(l.t)}</td><td>${esc(l.plek)}</td><td>${esc(l.veld)}</td><td>${esc(l.oud) || '<small>leeg</small>'}</td><td><b>${esc(l.nieuw) || '<small>leeg</small>'}</b></td></tr>`).join('')}</tbody></table>` : '<p class="uitleg">Nog geen maten ingetikt sinds deze functie bestaat.</p>';
}
async function haalSnap(id) {
  const lokaal = await histDB.get('snaps', id).catch(() => null);
  if (lokaal) return lokaal;
  const j = await post({ action: 'historie_snap', id });
  return j.snap;
}
async function bekijkSnap(id) {
  const el = $('#snap-bekijk'); el.innerHTML = 'Laden…';
  try {
    const s = await haalSnap(id), k = JSON.parse(s.json);
    const rijen = k.ruimtes.flatMap(ru => ru.ramen.flatMap(w => w.producten.map(p => { const r = bereken(p); return r ? `<tr><td>${esc(ru.naam)}</td><td>${esc(w.nr)}</td><td>${esc(r.t.naam)}</td><td>${(p.B || []).map(v => esc(v) || '–').join(' / ')}</td><td>${(p.H || []).map(v => esc(v) || '–').join(' / ')}</td><td><b>${fmtMaat(r)}</b></td></tr>` : ''; })));
    el.innerHTML = `<div class="snap-weergave"><div class="snap-kop"><b>Versie van ${tijdNL(s.t)}</b> – ${esc(s.reden)} <button class="mini" onclick="this.closest('.snap-weergave').remove()">Sluiten</button></div>
      <table class="tabel"><thead><tr><th>Ruimte</th><th>Raam</th><th>Product</th><th>Breedte strak</th><th>Hoogte strak</th><th>Bestelmaat</th></tr></thead><tbody>${rijen.join('') || '<tr><td colspan="6">Geen producten</td></tr>'}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<p class="waarschuwing">Versie niet te laden: ${esc(e.message)}</p>`; }
}
async function zetSnapTerug(id) {
  const k = huidigeKlant; if (!k) return;
  try {
    const s = await haalSnap(id);
    if (!confirm(`Meting terugzetten naar de versie van ${tijdNL(s.t)}?\n\nDe huidige versie wordt eerst bewaard, dus je kunt altijd terug.`)) return;
    await snapshot(k, 'voor terugzetten');
    const n = JSON.parse(s.json); n.id = k.id; n.updated = Date.now(); n.syncedAt = 0; n.verwijderd = false;
    DB.klanten[k.id] = n; huidigeKlant = n; bewaarLokaal(n); planSync(); updateBadge();
    melding(`Teruggezet naar de versie van ${tijdNL(s.t)}.`);
    location.hash = '#/k/' + k.id;
  } catch (e) { melding('Terugzetten mislukt: ' + e.message, true); }
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
  // kant-en-klare regels voor de Excel-macro HaalMeting
  try { c.excel = exportTekst(exportRegels(k)); } catch (e) { c.excel = ''; }
  // printbon voor de winkelweergave (alleen afgeronde metingen, zonder foto's)
  try { c.printbon = k.afgerond && !k.verwijderd ? printbonHTML(k, { fotos: false }) : ''; } catch (e) { c.printbon = ''; }
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
// verwerkt wat de server terugstuurt (klanten van andere toestellen, winkel, instellingen)
function verwerkOphalen(j, geraakt) {
  let veranderd = false;
  for (const r of j.klanten || []) {
    const lok = DB.klanten[r.id];
    if (!lok || (r.updated > lok.updated && lok.updated <= lok.syncedAt)) { if (lok) snapshot(lok, 'voor bijwerken vanaf ander toestel'); const k = JSON.parse(r.json); delete k.excel; delete k.printbon; k.syncedAt = k.updated; DB.klanten[k.id] = k; geraakt.add(k); veranderd = true; }
  }
  for (const o of j.opdrachten || []) {
    if (DB.klanten[o.id]) continue;
    const k = nieuweKlant(); Object.assign(k, { id: o.id, naam: o.naam || '', adres: o.adres || '', pcplaats: o.pcplaats || '', telefoon: o.telefoon || '', email: o.email || '', bron: 'winkel', wens: o.wens || '', aangenomenDoor: o.door || '', gewensteDatum: o.datum || '', datum: o.datum || vandaag() });
    DB.klanten[k.id] = k; geraakt.add(k); veranderd = true;
  }
  for (const st of j.winkelVerwijderd || []) {
    const k = DB.klanten[st.id]; if (!k || k.verwijderd || k.afgerond) continue;
    if (k.ruimtes.some(r => r.ramen.some(w => w.producten.some(p => prodDef(p))))) continue;
    snapshot(k, 'voor verwijderen door winkel'); k.verwijderd = true; k.updated = Date.now(); geraakt.add(k); veranderd = true;
  }
  for (const st of j.winkelStatus || []) {
    const k = DB.klanten[st.id]; if (!k) continue;
    const o = k.offerte || {};
    if ((o.t || 0) < st.t) { k.offerte = { ...o, keuze: 'gemaakt', nr: st.nr || o.nr || '', datum: st.datum || vandaag(), door: 'winkel', wie: st.wie || '', t: st.t }; if (st.nr && !k.offertenr) k.offertenr = st.nr; const schoon = k.afgerond && k.updated - k.afgerond <= 3000; k.updated = Date.now(); if (schoon) k.afgerond = k.updated; geraakt.add(k); veranderd = true; }
  }
  const si = j.instellingen;
  if (si && si.updated > DB.inst.updated && DB.inst.updated <= DB.inst.syncedAt) {
    DB.inst.waarden = { ...CONFIG.standaard, ...si.waarden }; DB.inst.aftrekPerType = si.aftrekPerType || {}; DB.inst.updated = DB.inst.syncedAt = si.updated; veranderd = true;
  }
  return veranderd;
}
// foto's na de maten: per ronde een paar, zodat maten nooit op foto's hoeven te wachten
async function uploadFotos(max) {
  let n = 0;
  for (const k of Object.values(DB.klanten)) {
    for (const f of alleFotos(k)) {
      if (n >= max) return n;
      if (f.driveId) continue;
      const rec = await fotoDB.get(f.id).catch(() => null); if (!rec) continue;
      const j = await post({ action: 'foto', klantId: k.id, klantNaam: k.naam, fotoId: f.id, dataUrl: rec.data });
      f.driveId = j.driveId; offerteGewijzigd(k); n++; // telt niet als 'meting gewijzigd'
    }
  }
  return n;
}
let syncVersie = 2; // 2 = alles in één verzoek; 1 = oude server, losse verzoeken
async function sync(handmatig) {
  if (syncBezig) return;
  if (!DB.inst.url || !DB.inst.sleutel) { if (handmatig) location.hash = '#/instellingen'; return; }
  if (!navigator.onLine) { updateBadge(); if (handmatig) melding('Geen verbinding. Wordt later verstuurd.'); return; }
  if (syncVersie === 1) return syncLos(handmatig);
  syncBezig = true; updateBadge();
  const start = Date.now(), geraakt = new Set();
  let veranderd = false, verstuurd = 0, opgehaald = 0, fotos = 0;
  try {
    // 1. versturen + ophalen in één verzoek
    const klanten = Object.values(DB.klanten).filter(k => k.updated > k.syncedAt).slice(0, 15);
    const stempels = new Map(klanten.map(k => [k.id, k.updated]));
    const instStempel = DB.inst.updated > DB.inst.syncedAt ? DB.inst.updated : 0;
    const hist = await historieWachtrij();
    // versies die dit toestel in de laatste minuten zelf verstuurde: die hoeft de server niet terug te sturen
    const bekend = {}; Object.values(DB.klanten).forEach(k => { if (k.syncedAt && k.syncedAt === k.updated && Date.now() - k.updated < 10 * 60000) bekend[k.id] = k.updated; });
    const verzoek = { action: 'sync', sinds: DB.inst.laatstePull || 0, klanten: klanten.map(metBerekening), bekend };
    if (instStempel) verzoek.inst = { waarden: DB.inst.waarden, aftrekPerType: DB.inst.aftrekPerType, updated: instStempel };
    if (hist.snaps.length || hist.logs.length) verzoek.historie = { snaps: hist.snaps.map(({ sent, vgl, ...x }) => x), logs: hist.logs.map(({ sent, ...x }) => x) };
    let j;
    try { j = await post(verzoek); }
    catch (e) { if (/Onbekende actie/.test(e.message)) { syncVersie = 1; syncBezig = false; return syncLos(handmatig); } throw e; }
    const ok = new Set(j.opgeslagen || []);
    for (const k of klanten) if (ok.has(k.id)) { k.syncedAt = stempels.get(k.id); geraakt.add(k); veranderd = true; verstuurd++; }
    if (instStempel) DB.inst.syncedAt = instStempel;
    if (verzoek.historie) await markeerHistorieVerstuurd(hist);
    if (!j.niets) { opgehaald = (j.klanten || []).length + (j.opdrachten || []).length; if (verwerkOphalen(j, geraakt)) veranderd = true; }
    DB.inst.laatstePull = j.serverTijd || Date.now();
    bewaarLokaal([...geraakt]);
    // 2. foto's (na de maten)
    fotos = await uploadFotos(3);
    // 3. nieuwe prijslijst via macro StuurCatalogus? Dan vanzelf ophalen.
    const ct = Number(j.catalogusTijd) || 0;
    if (ct && ct > (Number(localStorage.getItem('emf_cat_tijd')) || 0)) {
      if (await haalCatalogus(true)) localStorage.setItem('emf_cat_tijd', String(ct));
    }
    syncFout = '';
    DB.inst.laatsteSync = { ms: Date.now() - start, t: Date.now(), verstuurd, opgehaald, fotos, niets: !!j.niets };
    bewaarLokaal([]);
    if (handmatig) melding('Gesynchroniseerd.');
    // nog meer te doen (meer dan 15 klanten, foto's, of gewijzigd tijdens het versturen)? Snel nog een ronde.
    if (aantalOpen() || fotos >= 3) { clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(), 1000); }
  } catch (e) {
    syncFout = e.message; if (handmatig) melding('Synchroniseren mislukt: ' + e.message, true);
  } finally {
    syncBezig = false; updateBadge();
    const bezig = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (veranderd && !bezig && !huidigeKlant) route();
  }
}
// terugval voor een server zonder 'sync' (oude Apps Script)
async function syncLos(handmatig) {
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
      k.syncedAt = stempel; bewaarLokaal(); veranderd = true; // lijst bijwerken (label 'niet gesynchroniseerd')
    }
    if (DB.inst.updated > DB.inst.syncedAt) {
      const stempel = DB.inst.updated;
      await post({ action: 'instellingen_opslaan', inst: { waarden: DB.inst.waarden, aftrekPerType: DB.inst.aftrekPerType, updated: stempel } });
      DB.inst.syncedAt = stempel;
    }
    const j = await post({ action: 'lijst', sinds: DB.inst.laatstePull || 0 });
    for (const r of j.klanten || []) {
      const lok = DB.klanten[r.id];
      if (!lok || (r.updated > lok.updated && lok.updated <= lok.syncedAt)) { if (lok) snapshot(lok, 'voor bijwerken vanaf ander toestel'); const k = JSON.parse(r.json); delete k.excel; delete k.printbon; k.syncedAt = k.updated; DB.klanten[k.id] = k; veranderd = true; }
    }
    // nieuwe opdrachten van de winkel
    for (const o of j.opdrachten || []) {
      if (DB.klanten[o.id]) continue;
      const k = nieuweKlant(); Object.assign(k, { id: o.id, naam: o.naam || '', adres: o.adres || '', pcplaats: o.pcplaats || '', telefoon: o.telefoon || '', email: o.email || '', bron: 'winkel', wens: o.wens || '', aangenomenDoor: o.door || '', gewensteDatum: o.datum || '', datum: o.datum || vandaag() });
      DB.klanten[k.id] = k; veranderd = true;
    }
    // door de winkel verwijderd (alleen als er nog geen maten in staan)
    for (const st of j.winkelVerwijderd || []) {
      const k = DB.klanten[st.id]; if (!k || k.verwijderd || k.afgerond) continue;
      if (k.ruimtes.some(r => r.ramen.some(w => w.producten.some(p => prodDef(p))))) continue;
      snapshot(k, 'voor verwijderen door winkel'); k.verwijderd = true; k.updated = Date.now(); veranderd = true;
    }
    // offerte afgevinkt door de winkel
    for (const st of j.winkelStatus || []) {
      const k = DB.klanten[st.id]; if (!k) continue;
      const o = k.offerte || {};
      if ((o.t || 0) < st.t) { k.offerte = { ...o, keuze: 'gemaakt', nr: st.nr || o.nr || '', datum: st.datum || vandaag(), door: 'winkel', wie: st.wie || '', t: st.t }; if (st.nr && !k.offertenr) k.offertenr = st.nr; const schoon = k.afgerond && k.updated - k.afgerond <= 3000; k.updated = Date.now(); if (schoon) k.afgerond = k.updated; veranderd = true; }
    }
    const si = j.instellingen;
    if (si && si.updated > DB.inst.updated && DB.inst.updated <= DB.inst.syncedAt) {
      DB.inst.waarden = { ...CONFIG.standaard, ...si.waarden }; DB.inst.aftrekPerType = si.aftrekPerType || {}; DB.inst.updated = DB.inst.syncedAt = si.updated; veranderd = true;
    }
    DB.inst.laatstePull = j.serverTijd || Date.now();
    await syncHistorie();
    // nieuwe prijslijst via macro StuurCatalogus? Dan vanzelf ophalen.
    const ct = Number(j.catalogusTijd) || 0;
    if (ct && ct > (Number(localStorage.getItem('emf_cat_tijd')) || 0)) {
      if (await haalCatalogus(true)) localStorage.setItem('emf_cat_tijd', String(ct));
    }
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
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60000);
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
setTimeout(ruimHistorieOp, 5000);
