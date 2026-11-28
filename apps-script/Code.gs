/**
 * Edison Meetformulier – Google Apps Script (koppeling met Google Sheet + Drive)
 *
 * Installatie: zie STAPPENPLAN. Kort:
 *  1. Maak een Google Sheet, Extensies > Apps Script, plak dit bestand.
 *  2. Voer eenmalig de functie "installeer" uit en geef toestemming.
 *  3. Kopieer de sleutel uit het uitvoeringslogboek.
 *  4. Implementeren > Nieuwe implementatie > Web-app
 *     (Uitvoeren als: Ik, Toegang: Iedereen).
 */

const TAB_KLANTEN = 'Klanten';
const TAB_REGELS = 'Regels';
const TAB_INST = 'Instellingen';
const MAP_NAAM = "Edison Meetformulier – foto's";
const STUK = 45000; // max tekens per cel (Sheets-limiet is 50.000)

const KOP_KLANTEN = ['id', 'Naam', 'Adres', 'Postcode/plaats', 'Datum', 'Offertenr', 'Telefoon', 'E-mail', 'Ruimtes', 'Producten', 'Bijgewerkt (app)', 'Ontvangen (server)', 'Verwijderd', 'JSON'];
const KOP_REGELS = ['klant-id', 'Klant', 'Offertenr', 'Ruimte', 'Raam', 'Categorie', 'Artikel', 'Montage', 'BESTELMAAT B', 'BESTELMAAT H', 'Handmatig', 'Reden', 'Strak B', 'Strak H', 'Kleur', 'Prijsklasse', 'Uitvoering / opties', 'Plaatsen', 'Opmerking'];

/* ---------- eenmalige installatie ---------- */
function installeer() {
  const ss = SpreadsheetApp.getActive();
  zorgTab(ss, TAB_KLANTEN, KOP_KLANTEN);
  zorgTab(ss, TAB_REGELS, KOP_REGELS);
  zorgTab(ss, TAB_INST, ['JSON', 'Bijgewerkt']);
  const props = PropertiesService.getScriptProperties();
  let sleutel = props.getProperty('SLEUTEL');
  if (!sleutel) { sleutel = Utilities.getUuid().replace(/-/g, ''); props.setProperty('SLEUTEL', sleutel); }
  fotoMap();
  Logger.log('Installatie klaar. Je sleutel is: ' + sleutel);
}
function nieuweSleutel() {
  const s = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('SLEUTEL', s);
  Logger.log('Nieuwe sleutel: ' + s + ' (vul deze opnieuw in op al je toestellen)');
}
const TAB_CACHE = {}; // per verzoek: elk tabblad maar één keer controleren
function zorgTab(ss, naam, kop) {
  if (TAB_CACHE[naam]) return TAB_CACHE[naam];
  let sh = ss.getSheetByName(naam);
  if (!sh) sh = ss.insertSheet(naam);
  if (sh.getLastRow() === 0) { sh.appendRow(kop); sh.setFrozenRows(1); sh.getRange(1, 1, 1, kop.length).setFontWeight('bold').setBackground('#BDB39B'); }
  return TAB_CACHE[naam] = sh;
}
// Sheets weigert schrijven voorbij de laatste rij/kolom van het raster: vooraf ruimte maken (in stappen van 1000 rijen)
function zorgRuimte(sh, rij, kol) {
  if (sh.getMaxRows() < rij) sh.insertRowsAfter(sh.getMaxRows(), Math.max(rij - sh.getMaxRows(), 1000));
  if (kol && sh.getMaxColumns() < kol) sh.insertColumnsAfter(sh.getMaxColumns(), kol - sh.getMaxColumns());
}
// kolommen als tekst opmaken (JSON-stukken, datums, nummers): één keer per rastergrootte i.p.v. bij elke regel
function tekstKolommen(sh, blokken) {
  const props = PropertiesService.getScriptProperties();
  const sleutel = 'FMT_' + sh.getName(), stand = sh.getMaxRows() + 'x' + sh.getMaxColumns();
  if (props.getProperty(sleutel) === stand) return;
  blokken.forEach(b => { const tot = Math.min(b[1] || sh.getMaxColumns(), sh.getMaxColumns()); if (tot >= b[0]) sh.getRange(1, b[0], sh.getMaxRows(), tot - b[0] + 1).setNumberFormat('@'); });
  props.setProperty(sleutel, stand);
}

/* ---------- web-app ---------- */
function doGet(e) {
  if (e && e.parameter && e.parameter.excel) return excelActie(e);
  return uit({ ok: true, bericht: 'Edison Meetformulier – koppeling actief' });
}

function doPost(e) {
  if (e && e.parameter && e.parameter.excel) return excelActie(e);
  try {
    const d = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const sleutel = props.getProperty('SLEUTEL'), winkel = props.getProperty('WINKELSLEUTEL');
    // winkelwachtwoord: alleen de beperkte winkelacties, nooit de metingen zelf
    if (winkel && d.key === winkel && d.key !== sleutel) {
      if (WINKEL_LEZEN.indexOf(d.action) >= 0) return uit(winkelActie(d)); // alleen lezen: geen slot nodig
      return metSlot(() => { const r = winkelActie(d); markeerWijziging(); return uit(r); });
    }
    if (!sleutel || d.key !== sleutel) return uit({ ok: false, fout: 'Ongeldige sleutel' });
    // alleen lezen: geen slot, zodat niemand op een ander toestel hoeft te wachten
    switch (d.action) {
      case 'sync': return uit(syncActie(d));
      case 'test': return uit({ ok: true, bericht: 'Sheet "' + SpreadsheetApp.getActive().getName() + '" bereikbaar' });
      case 'lijst': return uit(lijst(Number(d.sinds) || 0));
      case 'catalogus': return uit({ ok: true, catalogus: catalogus() });
      case 'historie_lijst': return uit(historieLijst(d.klantId));
      case 'historie_snap': return uit({ ok: true, snap: historieSnap(d.id) });
    }
    return metSlot(() => {
      switch (d.action) {
        case 'opslaan': markeerWijziging(); opslaan(d.klant); markeerWijziging(); return uit({ ok: true });
        case 'foto': return uit({ ok: true, driveId: bewaarFoto(d) });
        case 'instellingen_opslaan': markeerWijziging(); bewaarInst(d.inst); return uit({ ok: true });
        case 'historie': bewaarHistorie(d); return uit({ ok: true });
        case 'winkel_sleutel': return uit({ ok: true, sleutel: nieuweWinkelSleutel() });
        default: return uit({ ok: false, fout: 'Onbekende actie' });
      }
    });
  } catch (err) {
    return uit({ ok: false, fout: String(err && err.message || err) });
  }
}
const WINKEL_LEZEN = ['w_test', 'w_lijst', 'w_printbon'];
function metSlot(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
// tijdstip van de laatste wijziging; zo kan een 'is er iets nieuws?'-vraag direct antwoord krijgen
function markeerWijziging() { PropertiesService.getScriptProperties().setProperty('LAATST_GEWIJZIGD', String(Date.now())); }

/* ---------- sync: versturen + ophalen in één verzoek ---------- */
function syncActie(d) {
  const props = PropertiesService.getScriptProperties();
  const klanten = d.klanten || [], hist = d.historie || {};
  const opgeslagen = [];
  if (klanten.length || d.inst || (hist.snaps || []).length || (hist.logs || []).length) {
    metSlot(() => {
      if (klanten.length || d.inst) markeerWijziging();
      const ctx = { ss: SpreadsheetApp.getActive() };
      klanten.forEach(k => { opslaan(k, ctx); opgeslagen.push(k.id); });
      if (d.inst) bewaarInst(d.inst);
      if ((hist.snaps || []).length || (hist.logs || []).length) bewaarHistorie(hist);
      if (klanten.length || d.inst) markeerWijziging();
    });
  }
  const sinds = Number(d.sinds) || 0;
  const laatst = Number(props.getProperty('LAATST_GEWIJZIGD')) || 0;
  const basis = { ok: true, opgeslagen: opgeslagen, catalogusTijd: Number(props.getProperty('CAT_TIJD')) || 0 };
  // niets nieuws sinds de vorige keer (behalve wat we zelf net stuurden)? Dan direct terug.
  if (sinds && laatst && !opgeslagen.length && laatst < sinds) { basis.niets = true; basis.serverTijd = Date.now() - 5000; return basis; }
  const l = lijst(sinds, new Set(opgeslagen), d.bekend || {});
  Object.keys(l).forEach(k => { basis[k] = l[k]; });
  return basis;
}

function uit(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- klanten ---------- */
function opslaan(k, ctx) {
  ctx = ctx || {};
  const ss = ctx.ss || (ctx.ss = SpreadsheetApp.getActive());
  const sh = ctx.sh || (ctx.sh = zorgTab(ss, TAB_KLANTEN, KOP_KLANTEN));
  bewaarPrintbon(ss, k, ctx);
  delete k.printbon;
  const json = JSON.stringify(k);
  const stukken = [];
  for (let i = 0; i < json.length; i += STUK) stukken.push(json.slice(i, i + STUK));
  const producten = k.ruimtes.reduce((a, r) => a + r.ramen.reduce((b, w) => b + w.producten.length, 0), 0);
  const rij = [k.id, k.naam, k.adres, k.pcplaats, k.datum || '', k.offertenr, k.telefoon, k.email, k.ruimtes.length, producten,
    new Date(k.updated), new Date(), k.verwijderd ? 'ja' : ''].concat(stukken);

  if (!ctx.ids) ctx.ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  if (!ctx.breed) ctx.breed = sh.getLastColumn();
  let idx = ctx.ids.indexOf(k.id);
  if (idx < 0) { ctx.ids.push(k.id); idx = ctx.ids.length - 1; }
  const nr = idx + 2;
  // hele rij in één keer schrijven; lege cellen erachter wissen oude JSON-stukken
  const breedte = Math.max(ctx.breed, rij.length);
  while (rij.length < breedte) rij.push('');
  ctx.breed = breedte;
  zorgRuimte(sh, nr, breedte);
  tekstKolommen(sh, [[5, 5], [14]]); // datum (yyyy-mm-dd) en JSON-stukken als tekst
  sh.getRange(nr, 1, 1, breedte).setValues([rij]);
  schrijfStatus(ss, k, ctx);
  schrijfRegels(ss, k, ctx);
}

function leesKlantRij(rij) {
  return rij.slice(13).filter(String).join('');
}

function lijst(sinds, uitsluiten, bekend) {
  const ss = SpreadsheetApp.getActive();
  const sh = zorgTab(ss, TAB_KLANTEN, KOP_KLANTEN);
  const uitvoer = { ok: true, serverTijd: Date.now() - 5000, klanten: [] };
  const n = sh.getLastRow() - 1;
  const ids = new Set();
  if (n > 0) {
    const meta = sh.getRange(2, 1, n, 12).getValues(); // zonder JSON
    const nodig = [];
    meta.forEach((r, i) => {
      if (!r[0]) return; ids.add(r[0]);
      const ontvangen = r[11] instanceof Date ? r[11].getTime() : 0;
      const bijgewerkt = r[10] instanceof Date ? r[10].getTime() : 0;
      // overslaan: net zelf verstuurd, of het toestel heeft precies deze versie al
      if (ontvangen >= sinds && !(uitsluiten && uitsluiten.has(r[0])) && !(bekend && bekend[r[0]] === bijgewerkt)) nodig.push(i);
    });
    if (nodig.length) {
      const breed = sh.getLastColumn();
      const alle = nodig.length > 15 ? sh.getRange(2, 1, n, breed).getValues() : null;
      nodig.forEach(i => {
        const r = alle ? alle[i] : sh.getRange(i + 2, 1, 1, breed).getValues()[0];
        const json = leesKlantRij(r); if (!json) return;
        uitvoer.klanten.push({ id: r[0], updated: r[10] instanceof Date ? r[10].getTime() : 0, json: json });
      });
    }
  }
  const wst = wstRijen(ss);
  uitvoer.opdrachten = openOpdrachten(ss, ids);
  uitvoer.winkelStatus = laatsteWinkelStatus(ss, wst);
  uitvoer.winkelVerwijderd = winkelVerwijderd(ss, wst);
  uitvoer.catalogusTijd = Number(PropertiesService.getScriptProperties().getProperty('CAT_TIJD')) || 0;
  const si = ss.getSheetByName(TAB_INST);
  if (si && si.getLastRow() > 1) {
    const v = si.getRange(2, 1).getValue();
    if (v) uitvoer.instellingen = JSON.parse(v);
  }
  return uitvoer;
}

/* ---------- regels (plat overzicht per product) ---------- */
function schrijfRegels(ss, k, ctx) {
  const sh = zorgTab(ss, TAB_REGELS, KOP_REGELS);
  // oude regels van deze klant verwijderen, per aaneengesloten blok (van onder naar boven)
  if (sh.getLastRow() > 1) {
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    let i = ids.length - 1;
    while (i >= 0) {
      if (ids[i][0] !== k.id) { i--; continue; }
      let j = i; while (j > 0 && ids[j - 1][0] === k.id) j--;
      sh.deleteRows(j + 2, i - j + 1);
      i = j - 1;
    }
  }
  if (k.verwijderd) return;
  const rijen = [];
  k.ruimtes.forEach(ru => ru.ramen.forEach(w => w.producten.forEach(p => {
    const b = p.berekend; if (!b) return;
    rijen.push([k.id, k.naam, k.offertenr, ru.naam, w.nr, p.cat, p.art, b.calc === 'zon' ? (p.montage === 'in' ? 'In de dag' : 'Op de dag') : '',
      b.B == null ? '' : b.B, b.H == null ? '' : b.H, b.hand ? 'ja' : '', (p.hand && p.hand.reden) || '',
      b.sB == null ? '' : b.sB, b.sH == null ? '' : b.sH, b.kleur || '', b.pk || '', b.uitvoering || '', p.plaatsen || '', p.opmerking || '']);
  })));
  if (rijen.length) { const nr = sh.getLastRow() + 1; zorgRuimte(sh, nr + rijen.length - 1); sh.getRange(nr, 1, rijen.length, KOP_REGELS.length).setValues(rijen); }
}

/* ---------- foto's ---------- */
function fotoMap() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('MAP');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const map = DriveApp.createFolder(MAP_NAAM);
  props.setProperty('MAP', map.getId());
  return map;
}
function bewaarFoto(d) {
  const hoofd = fotoMap();
  const naam = (d.klantNaam || 'Zonder naam') + ' – ' + d.klantId;
  const it = hoofd.getFoldersByName(naam);
  const map = it.hasNext() ? it.next() : hoofd.createFolder(naam);
  const base64 = d.dataUrl.split(',')[1];
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', d.fotoId + '.jpg');
  return map.createFile(blob).getId();
}

/* ---------- instellingen ---------- */
function bewaarInst(inst) {
  const sh = zorgTab(SpreadsheetApp.getActive(), TAB_INST, ['JSON', 'Bijgewerkt']);
  sh.getRange(2, 1, 1, 2).setValues([[JSON.stringify(inst), new Date(inst.updated)]]);
}

/* ---------- catalogus uit geplakte master-tabs ---------- */
// Plak uit je master de tabs Artikelen, Opties, Kleuren en Lijsten (hele blad, vanaf A1)
// in tabbladen met precies dezelfde naam in deze Sheet.
function catalogus() {
  const ss = SpreadsheetApp.getActive();
  const lees = naam => { const sh = ss.getSheetByName(naam); if (!sh) throw new Error('Tabblad "' + naam + '" ontbreekt in de Sheet'); return sh.getDataRange().getDisplayValues(); };
  // Lijsten is optioneel (verborgen tab in de master); zonder Lijsten gelden de vaste lijsten hieronder
  const lij = ss.getSheetByName('Lijsten') ? lees('Lijsten').slice(1) : [];
  const art = lees('Artikelen').slice(1), opt = lees('Opties').slice(1), kl = lees('Kleuren').slice(1);
  const VAST = [[], ['Pk S', 'Pk E', 'Pk 0', 'Pk 1', 'Pk 2', 'Pk 3', 'Pk 4', 'Pk 5', 'Pk 6', 'Pk A', 'Pk B', 'Pk C'], [], ['Stel', 'Stuk'], ['Nee', 'Ja'],
    ['Automatisch', 'Standaard', 'Velours/black-out'], ['Geen', 'Rails 15 mm wit', 'Rails 25 mm wit', 'Wave rails (plaatsen)', 'Roede (plaatsen)'], ['Vast', 'Los'], ['Smalspoor', 'Breedspoor']];
  const kol = i => { const v = lij.map(r => r[i]).filter(String); return v.length ? v : VAST[i]; };
  const uniekA = []; art.forEach(r => { if (r[0] && uniekA.indexOf(r[0]) < 0) uniekA.push(r[0]); });
  const cats = lij.length ? kol(0) : uniekA;
  const gordijn = lij.length ? kol(2) : uniekA.filter(c => c.indexOf('Gordijnstof') === 0);
  const artikelen = {};
  art.forEach(r => { if (!r[0] || !r[1]) return; const o = { a: r[1] };
    [['e', 2], ['t', 4], ['let', 6], ['pk', 9], ['og', 10], ['sb', 11], ['mp', 13], ['bo', 15], ['fam', 16]].forEach(([k, i]) => { if (r[i]) o[k] = r[i]; });
    if (o.sb) o.sb = Number(o.sb) || o.sb;
    (artikelen[r[0]] = artikelen[r[0]] || []).push(o); });
  const opties = {};
  opt.forEach(r => { if (!r[0] || !r[1]) return; const o = { o: r[1], r: r[2] }; if (r[4]) o.max = Number(r[4]); if (r[7]) o.vanaf = Number(r[7]); (opties[r[0]] = opties[r[0]] || []).push(o); });
  const kleuren = {};
  // kleurnummer van 1-3 cijfers aanvullen tot 4 (zoals de app en de importmacro doen)
  const nr = v => { const t = String(v).trim(); return /^\d{1,3}$/.test(t) ? ('0000' + t).slice(-4) : t; };
  kl.forEach(r => { if (!r[0] || !r[1]) return; (kleuren[r[0]] = kleuren[r[0]] || {})[nr(r[1])] = [r[2], r[3], r[4] ? Number(r[4]) : '']; });
  // maximale maten uit tab Matrix (optioneel): per product en prijsklasse [[hoogte-stap, max breedte]]
  const maxm = {};
  const mx = ss.getSheetByName('Matrix');
  if (mx) {
    const grid = {};
    mx.getDataRange().getValues().slice(1).forEach(r => {
      if (!r[0] || r[1] === '' || r[2] === '') return;
      const g = grid[r[0]] = grid[r[0]] || {}; const d = g[r[3]] = g[r[3]] || {};
      const h = Number(r[2]), b = Number(r[1]); d[h] = Math.max(d[h] || 0, b);
    });
    Object.keys(grid).forEach(prod => {
      const tab = {};
      Object.keys(grid[prod]).forEach(pk => { tab[pk] = Object.keys(grid[prod][pk]).map(Number).sort((a, b) => a - b).map(h => [h, grid[prod][pk][h]]); });
      const vals = Object.keys(tab).map(k => JSON.stringify(tab[k]));
      maxm[prod] = vals.every(v => v === vals[0]) ? { '*': tab[Object.keys(tab)[0]] } : tab;
    });
  }
  const modus = c => gordijn.indexOf(c) >= 0 ? 'gordijn' : ((c.indexOf('Luxaflex') === 0 && c !== 'Luxaflex reparaties' && c !== 'Luxaflex PowerView accessoires') || c === 'Dutch Design') ? 'zon' : 'los';
  return {
    bron: 'Google Sheet – ' + Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd'),
    categorieen: cats.filter(c => c !== 'Voering').map(c => ({ naam: c, modus: modus(c) })),
    artikelen: artikelen, opties: opties, kleuren: kleuren, max: maxm,
    lijsten: { plooi: ['Enkele plooi', 'Dubbele plooi', 'Tri-plooi', 'Wave', 'Ringen'], stelstuk: kol(3), janee: kol(4), confectie: kol(5), rails: kol(6), voeren: kol(7), runners: kol(8), prijsklassen: kol(1), voering: (artikelen['Voering'] || []).map(a => a.a) },
    limieten: { invoer: 21, gordijnen: 8, ruimtes: 8 }
  };
}

/* ---------- koppeling met de offerte-Excel (macro's HaalMeting en StuurCatalogus) ----------
   Excel praat via curl met deze web-app. Antwoord = platte tekst:
   eerste regel "OK" (eventueel met tab + info) of "FOUT<tab>melding", daarna de gegevens.  */
const MASTER_TABS = ['Artikelen', 'Opties', 'Kleuren', 'Lijsten'];
const schoon = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
function tekstUit(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }

function excelActie(e) {
  const p = e.parameter;
  try {
    const sleutel = PropertiesService.getScriptProperties().getProperty('SLEUTEL');
    if (!sleutel || p.key !== sleutel) return tekstUit('FOUT\tOngeldige sleutel');
    const leest = ['test', 'lijst', 'meting'].indexOf(p.excel) >= 0;
    const lock = leest ? null : LockService.getScriptLock();
    if (lock) lock.waitLock(20000);
    try {
      switch (p.excel) {
        case 'test': return tekstUit('OK\tSheet "' + schoon(SpreadsheetApp.getActive().getName()) + '" bereikbaar');
        case 'lijst': return tekstUit(excelLijst());
        case 'meting': return tekstUit(excelMeting(p.id));
        case 'tab': return tekstUit(schrijfMasterTab(p.tab, e.postData ? e.postData.contents : ''));
        case 'catalogus_klaar': {
          const c = catalogus();
          PropertiesService.getScriptProperties().setProperty('CAT_TIJD', String(Date.now()));
          markeerWijziging();
          const nk = Object.keys(c.kleuren).reduce((a, f) => a + Object.keys(c.kleuren[f]).length, 0);
          return tekstUit('OK\t' + c.categorieen.length + ' productgroepen, ' + nk + ' kleurnummers');
        }
        default: return tekstUit('FOUT\tOnbekende actie');
      }
    } finally { if (lock) lock.releaseLock(); }
  } catch (err) {
    return tekstUit('FOUT\t' + schoon(err && err.message || err));
  }
}

// één klantrij (met JSON) opzoeken zonder het hele tabblad te lezen
function klantRijVan(id) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB_KLANTEN);
  if (!sh || sh.getLastRow() < 2 || !id) return null;
  const i = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().findIndex(r => r[0] === id);
  return i < 0 ? null : sh.getRange(i + 2, 1, 1, sh.getLastColumn()).getValues()[0];
}
function klantRijen() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB_KLANTEN);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}

// alle metingen, nieuwste eerst: id | naam | offertenr | datum | adres
function excelLijst() {
  let zonder = 0;
  const rijen = leesStatus(SpreadsheetApp.getActive()).filter(k => {
    if (k.verwijderd) return false;
    if (!k.excel) { zonder++; return false; }
    return true;
  }).sort((a, b) => b.ontvangen - a.ontvangen)
    .map(k => [k.id, k.naam, k.offertenr, k.datum, [k.adres, k.pcplaats].filter(String).join(', ')].map(schoon).join('\t'));
  return ['OK\t' + zonder].concat(rijen).join('\n');
}

function excelMeting(id) {
  if (!id) return 'FOUT\tGeen meting gekozen';
  const r = klantRijVan(id);
  if (!r) return 'FOUT\tMeting niet gevonden';
  const k = JSON.parse(leesKlantRij(r));
  if (!k.excel) return 'FOUT\tDeze meting is nog niet bijgewerkt. Open de app even op je telefoon of laptop, dan wordt hij opnieuw verstuurd.';
  return 'OK\n' + k.excel;
}

// een tab uit de master overnemen (tekst met tabs, niet-ASCII als %XX gecodeerd)
function schrijfMasterTab(naam, body) {
  if (MASTER_TABS.indexOf(naam) < 0) return 'FOUT\tOnbekend tabblad ' + schoon(naam);
  const tekst = decodeURIComponent(body || '');
  const rijen = tekst.split('\n').map(l => l.replace(/\r$/, '').split('\t'));
  while (rijen.length && rijen[rijen.length - 1].every(v => v === '')) rijen.pop();
  if (rijen.length < 2) return 'FOUT\tTabblad ' + naam + ' is leeg';
  const kol = rijen.reduce((m, r) => Math.max(m, r.length), 0);
  rijen.forEach(r => { while (r.length < kol) r.push(''); });
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(naam) || ss.insertSheet(naam);
  sh.clear();
  if (sh.getMaxRows() < rijen.length) sh.insertRowsAfter(sh.getMaxRows(), rijen.length - sh.getMaxRows());
  if (sh.getMaxColumns() < kol) sh.insertColumnsAfter(sh.getMaxColumns(), kol - sh.getMaxColumns());
  const bereik = sh.getRange(1, 1, rijen.length, kol);
  bereik.setNumberFormat('@'); // als tekst bewaren, zodat er niets wordt omgezet
  bereik.setValues(rijen);
  return 'OK\t' + (rijen.length - 1) + ' regels';
}

/* ---------- geschiedenis: snapshots (tab Historie) en meetlogboek (tab Meetlog) ---------- */
const TAB_HIST = 'Historie', TAB_LOG = 'Meetlog';
const KOP_HIST = ['id', 'klant-id', 'Klant', 'Tijd', 'Moment', 'Ruimtes', 'Producten', 'JSON'];
const KOP_LOG = ['id', 'klant-id', 'Klant', 'Tijd', 'Plek', 'Veld', 'Was', 'Werd'];
const BEWAAR_ALLES_DAGEN = 30;

function idsVan(sh) { return sh.getLastRow() > 1 ? new Set(sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0])) : new Set(); }

function bewaarHistorie(d) {
  const ss = SpreadsheetApp.getActive();
  const sh = zorgTab(ss, TAB_HIST, KOP_HIST), sl = zorgTab(ss, TAB_LOG, KOP_LOG);
  const hIds = idsVan(sh);
  (d.snaps || []).forEach(s => {
    if (!s || !s.id || hIds.has(s.id)) return;
    const json = String(s.json || ''), stukken = [];
    for (let i = 0; i < json.length; i += STUK) stukken.push(json.slice(i, i + STUK));
    const rij = [s.id, s.klant, s.naam || '', new Date(s.t), s.reden || '', s.ruimtes || 0, s.producten || 0].concat(stukken);
    const nr = sh.getLastRow() + 1;
    zorgRuimte(sh, nr, rij.length);
    tekstKolommen(sh, [[8]]);
    sh.getRange(nr, 1, 1, rij.length).setValues([rij]);
  });
  const lIds = idsVan(sl);
  const logs = (d.logs || []).filter(l => l && l.id && !lIds.has(l.id))
    .map(l => [l.id, l.klant, l.naam || '', new Date(l.t), l.plek || '', l.veld || '', String(l.oud == null ? '' : l.oud), String(l.nieuw == null ? '' : l.nieuw)]);
  if (logs.length) {
    const nr = sl.getLastRow() + 1;
    zorgRuimte(sl, nr + logs.length - 1);
    tekstKolommen(sl, [[7, 8]]);
    sl.getRange(nr, 1, logs.length, KOP_LOG.length).setValues(logs);
  }
  ruimHistorieOp(sh);
}

function historieLijst(klantId) {
  const ss = SpreadsheetApp.getActive(), uitvoer = { ok: true, snaps: [], logs: [] };
  const sh = ss.getSheetByName(TAB_HIST);
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(r => {
    if (r[1] === klantId) uitvoer.snaps.push({ id: r[0], t: r[3] instanceof Date ? r[3].getTime() : 0, reden: r[4], ruimtes: r[5], producten: r[6] });
  });
  const sl = ss.getSheetByName(TAB_LOG);
  if (sl && sl.getLastRow() > 1) sl.getRange(2, 1, sl.getLastRow() - 1, 8).getValues().forEach(r => {
    if (r[1] === klantId) uitvoer.logs.push({ id: r[0], t: r[3] instanceof Date ? r[3].getTime() : 0, plek: r[4], veld: r[5], oud: String(r[6]), nieuw: String(r[7]) });
  });
  return uitvoer;
}

function historieSnap(id) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB_HIST);
  if (!sh || sh.getLastRow() < 2) throw new Error('Versie niet gevonden');
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]);
  const i = ids.indexOf(id);
  if (i < 0) throw new Error('Versie niet gevonden');
  const r = sh.getRange(i + 2, 1, 1, sh.getLastColumn()).getValues()[0];
  return { id: r[0], t: r[3] instanceof Date ? r[3].getTime() : 0, reden: r[4], ruimtes: r[5], producten: r[6], json: r.slice(7).filter(String).join('') };
}

// één keer per dag: snapshots ouder dan 30 dagen terugbrengen tot één per klant per dag
function ruimHistorieOp(sh) {
  const props = PropertiesService.getScriptProperties();
  if (Date.now() - (Number(props.getProperty('HIST_OPRUIM')) || 0) < 864e5) return;
  props.setProperty('HIST_OPRUIM', String(Date.now()));
  if (sh.getLastRow() < 2) return;
  const grens = Date.now() - BEWAAR_ALLES_DAGEN * 864e5, gezien = {}, weg = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map((r, i) => ({ i, klant: r[1], t: r[3] instanceof Date ? r[3].getTime() : 0 }))
    .sort((a, b) => b.t - a.t)
    .forEach(x => {
      if (!x.t || x.t >= grens) return;
      const sl = x.klant + '|' + Utilities.formatDate(new Date(x.t), 'Europe/Amsterdam', 'yyyy-MM-dd');
      if (gezien[sl]) weg.push(x.i); else gezien[sl] = true;
    });
  weg.sort((a, b) => b - a).forEach(i => sh.deleteRow(i + 2));
}

/* ---------- winkel: opdrachten klaarzetten, lijst, printbon, offerte afvinken ----------
   De winkel heeft een eigen wachtwoord (WINKELSLEUTEL). Daarmee kan alleen wat hieronder staat. */
const TAB_OPDR = 'Opdrachten', TAB_WST = 'WinkelStatus', TAB_PB = 'Printbon';
const KOP_OPDR = ['id', 'Aangemaakt', 'Door', 'Naam', 'Adres', 'Postcode/plaats', 'Telefoon', 'E-mail', 'Gewenste datum', 'Wens', 'Verwijderd'];
const KOP_WST = ['klant-id', 'Tijd', 'Offertenr', 'Door', 'Datum', 'Actie'];
const KOP_PB = ['klant-id', 'Klant', 'Bijgewerkt', 'HTML'];

function nieuweWinkelSleutel() {
  const tekens = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) { s += tekens[Math.floor(Math.random() * tekens.length)]; if (i === 3 || i === 7) s += '-'; }
  PropertiesService.getScriptProperties().setProperty('WINKELSLEUTEL', s);
  return s;
}

function bewaarPrintbon(ss, k, ctx) {
  ctx = ctx || {};
  const html = String(k.printbon || '');
  const sh = ss.getSheetByName(TAB_PB);
  if (!html && !sh) return;
  const pb = sh || zorgTab(ss, TAB_PB, KOP_PB);
  if (!ctx.pbIds) ctx.pbIds = pb.getLastRow() > 1 ? pb.getRange(2, 1, pb.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  const ids = ctx.pbIds;
  const idx = ids.indexOf(k.id);
  if (!html) { if (idx >= 0) { pb.deleteRow(idx + 2); ids.splice(idx, 1); } return; }
  return schrijfPrintbon(pb, k, html, idx, ids);
}
function schrijfPrintbon(sh, k, html, idx, ids) {
  const stukken = []; for (let i = 0; i < html.length; i += STUK) stukken.push(html.slice(i, i + STUK));
  if (idx < 0) { ids.push(k.id); idx = ids.length - 1; }
  const nr = idx + 2;
  const rij = [k.id, k.naam || '', new Date()].concat(stukken);
  if (!schrijfPrintbon.breed) schrijfPrintbon.breed = sh.getLastColumn();
  const breedte = Math.max(schrijfPrintbon.breed, rij.length);
  while (rij.length < breedte) rij.push(''); // lege cellen wissen oude stukken
  schrijfPrintbon.breed = breedte;
  zorgRuimte(sh, nr, breedte);
  tekstKolommen(sh, [[4]]);
  sh.getRange(nr, 1, 1, breedte).setValues([rij]);
}

function klantIds(ss) { const sh = ss.getSheetByName(TAB_KLANTEN); return sh && sh.getLastRow() > 1 ? new Set(sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0])) : new Set(); }

// opdrachten van de winkel die de inmeter nog niet heeft overgenomen
function openOpdrachten(ss, bekendeIds) {
  const sh = ss.getSheetByName(TAB_OPDR);
  if (!sh || sh.getLastRow() < 2) return [];
  const bekend = bekendeIds || klantIds(ss);
  return sh.getRange(2, 1, sh.getLastRow() - 1, KOP_OPDR.length).getDisplayValues()
    .filter(r => r[0] && !bekend.has(r[0]) && r[10] !== 'ja')
    .map(r => ({ id: r[0], aangemaakt: r[1], door: r[2], naam: r[3], adres: r[4], pcplaats: r[5], telefoon: r[6], email: r[7], datum: r[8], wens: r[9] }));
}

function wstRijen(ss) {
  const sh = ss.getSheetByName(TAB_WST);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, KOP_WST.length).getValues()
    .map(r => ({ id: r[0], t: r[1] instanceof Date ? r[1].getTime() : 0, nr: String(r[2]), wie: String(r[3]), datum: String(r[4]), actie: String(r[5] || '') }))
    .filter(x => x.id);
}
// laatste 'offerte gemaakt' per klant
function laatsteWinkelStatus(ss, rijen) {
  const per = {};
  (rijen || wstRijen(ss)).filter(x => !x.actie).forEach(x => { if (!per[x.id] || per[x.id].t < x.t) per[x.id] = x; });
  return Object.keys(per).map(k => per[k]);
}
// door de winkel verwijderde (nog niet ingemeten) opdrachten
function winkelVerwijderd(ss, rijen) { return (rijen || wstRijen(ss)).filter(x => x.actie === 'verwijderd').map(x => ({ id: x.id, t: x.t })); }

function winkelActie(d) {
  const ss = SpreadsheetApp.getActive();
  switch (d.action) {
    case 'w_test': return { ok: true, bericht: 'Winkel-koppeling werkt' };
    case 'w_lijst': return { ok: true, klanten: winkelLijst(ss) };
    case 'w_printbon': return { ok: true, html: winkelPrintbon(ss, d.id) };
    case 'w_opdracht': return { ok: true, id: winkelOpdracht(ss, d.opdracht || {}) };
    case 'w_offerte': winkelOfferte(ss, d); return { ok: true };
    case 'w_verwijder': winkelVerwijder(ss, d.id); return { ok: true };
    default: return { ok: false, fout: 'Niet toegestaan met het winkelwachtwoord' };
  }
}

function winkelLijst(ss) {
  const wst = wstRijen(ss);
  const status = {}; laatsteWinkelStatus(ss, wst).forEach(x => { status[x.id] = x; });
  const weg = new Set(winkelVerwijderd(ss, wst).map(x => x.id));
  const pb = ss.getSheetByName(TAB_PB);
  const metPrintbon = pb && pb.getLastRow() > 1 ? new Set(pb.getRange(2, 1, pb.getLastRow() - 1, 1).getValues().map(r => r[0])) : new Set();
  const uit = [], bekend = new Set();
  leesStatus(ss).forEach(k => {
    bekend.add(k.id);
    if (k.verwijderd || weg.has(k.id)) return;
    let o = k.offerte;
    const ws = status[k.id];
    if (ws && ws.t > (o.t || 0)) o = { keuze: 'gemaakt', nr: ws.nr, door: 'winkel', wie: ws.wie, datum: ws.datum, t: ws.t, verstuurd: false, notitie: '' };
    uit.push({ id: k.id, naam: k.naam, adres: k.adres, pcplaats: k.pcplaats, telefoon: k.telefoon, email: k.email, datum: k.datum, offertenr: k.offertenr || o.nr || '',
      meting: k.meting, offerte: { keuze: o.keuze || '', nr: o.nr || '', notitie: o.notitie || '', door: o.door || '', wie: o.wie || '', datum: o.datum || '', verstuurd: !!o.verstuurd },
      bron: k.bron, wens: k.wens, door: k.door, printbon: metPrintbon.has(k.id), t: k.ontvangen });
  });
  openOpdrachten(ss, bekend).forEach(o => uit.push({ id: o.id, naam: o.naam, adres: o.adres, pcplaats: o.pcplaats, telefoon: o.telefoon, email: o.email, datum: o.datum, offertenr: '',
    meting: 'klaargezet', opgehaald: false, offerte: {}, bron: 'winkel', wens: o.wens, door: o.door, printbon: false, t: Date.now() }));
  return uit;
}

function winkelPrintbon(ss, id) {
  const sh = ss.getSheetByName(TAB_PB);
  if (!sh || sh.getLastRow() < 2) throw new Error('Nog geen printbon');
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]);
  const i = ids.indexOf(id); if (i < 0) throw new Error('Nog geen printbon voor deze klant');
  return sh.getRange(i + 2, 1, 1, sh.getLastColumn()).getValues()[0].slice(3).filter(String).join('');
}

function winkelOpdracht(ss, o) {
  const tekst = v => String(v == null ? '' : v).slice(0, 2000);
  if (!tekst(o.naam).trim() || !tekst(o.adres).trim()) throw new Error('Naam en adres zijn verplicht');
  const sh = zorgTab(ss, TAB_OPDR, KOP_OPDR);
  const id = 'w' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const nr = sh.getLastRow() + 1;
  sh.getRange(1, 1, 1, KOP_OPDR.length).setValues([KOP_OPDR]);
  zorgRuimte(sh, nr); tekstKolommen(sh, [[1, KOP_OPDR.length]]);
  sh.getRange(nr, 1, 1, KOP_OPDR.length).setValues([[id, Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd HH:mm'), tekst(o.door), tekst(o.naam), tekst(o.adres), tekst(o.pcplaats), tekst(o.telefoon), tekst(o.email), tekst(o.datum), tekst(o.wens), '']]);
  return id;
}

function winkelOfferte(ss, d) {
  if (!d.id) throw new Error('Geen klant gekozen');
  if (!klantIds(ss).has(d.id)) throw new Error('Klant niet gevonden');
  const sh = zorgTab(ss, TAB_WST, KOP_WST);
  const nr = sh.getLastRow() + 1;
  sh.getRange(1, 1, 1, KOP_WST.length).setValues([KOP_WST]);
  zorgRuimte(sh, nr); tekstKolommen(sh, [[3, 5]]);
  sh.getRange(nr, 1, 1, KOP_WST.length).setValues([[d.id, new Date(), String(d.nr || '').slice(0, 50), String(d.wie || '').slice(0, 50), Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd'), '']]);
}

// winkel mag alleen opdrachten verwijderen waar nog geen maten in staan
function winkelVerwijder(ss, id) {
  if (!id) throw new Error('Geen opdracht gekozen');
  const so = ss.getSheetByName(TAB_OPDR);
  let gevonden = false;
  if (so && so.getLastRow() > 1) {
    const ids = so.getRange(2, 1, so.getLastRow() - 1, 1).getValues().map(r => r[0]);
    const i = ids.indexOf(id);
    if (i >= 0) { so.getRange(i + 2, 11).setValue('ja'); gevonden = true; }
  }
  const r = klantRijVan(id);
  if (r) {
    const k = JSON.parse(leesKlantRij(r) || '{}');
    const heeft = (k.ruimtes || []).some(ru => ru.ramen.some(w => w.producten.some(p => p.cat && p.art)));
    if (heeft || k.afgerond) throw new Error('Hier zijn al maten in gezet. Vraag de inmeter om hem te verwijderen.');
    const sh = zorgTab(ss, TAB_WST, KOP_WST);
    sh.getRange(1, 1, 1, KOP_WST.length).setValues([KOP_WST]);
    const nr = sh.getLastRow() + 1; zorgRuimte(sh, nr);
    sh.getRange(nr, 1, 1, KOP_WST.length).setValues([[id, new Date(), '', '', Utilities.formatDate(new Date(), 'Europe/Amsterdam', 'yyyy-MM-dd'), 'verwijderd']]);
    gevonden = true;
  }
  if (!gevonden) throw new Error('Opdracht niet gevonden');
}

/* ---------- Status: één regel per klant zonder JSON (snel lezen voor winkel en Excel) ---------- */
const TAB_STATUS = 'Status';
const KOP_STATUS = ['id', 'Naam', 'Adres', 'Postcode/plaats', 'Datum', 'Offertenr', 'Telefoon', 'E-mail', 'Meting', 'Offerte', 'Offerte nr', 'Notitie', 'Offerte door', 'Wie', 'Offerte datum', 'Verstuurd', 'Offerte tijd', 'Bron', 'Wens', 'Aangenomen door', 'Verwijderd', 'Ontvangen', 'Excel klaar'];
const STATUS_VERSIE = '1';

function statusRij(k) {
  const heeft = (k.ruimtes || []).some(ru => ru.ramen.some(w => w.producten.some(p => p.cat && p.art)));
  const o = k.offerte || {};
  return [k.id, k.naam || '', k.adres || '', k.pcplaats || '', k.datum || '', k.offertenr || '', k.telefoon || '', k.email || '',
    k.afgerond ? 'afgerond' : heeft ? 'bezig' : (k.bron === 'winkel' ? 'klaargezet' : 'nieuw'),
    o.keuze || '', o.nr || '', o.notitie || '', o.door || '', o.wie || '', o.datum || '', o.verstuurd ? 'ja' : '', String(o.t || ''),
    k.bron || '', k.wens || '', k.aangenomenDoor || '', k.verwijderd ? 'ja' : '', String(Date.now()), k.excel ? 'ja' : ''].map(v => String(v));
}

function schrijfStatus(ss, k, ctx) {
  ctx = ctx || {};
  const sh = zorgTab(ss, TAB_STATUS, KOP_STATUS);
  if (!ctx.stIds) ctx.stIds = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  let idx = ctx.stIds.indexOf(k.id);
  if (idx < 0) { ctx.stIds.push(k.id); idx = ctx.stIds.length - 1; }
  zorgRuimte(sh, idx + 2);
  tekstKolommen(sh, [[1, KOP_STATUS.length]]);
  sh.getRange(idx + 2, 1, 1, KOP_STATUS.length).setValues([statusRij(k)]);
}

// eenmalig (of na een wijziging in de opbouw) de Status-tab vullen vanuit de klantgegevens
function zorgStatus(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('STATUS_VERSIE') === STATUS_VERSIE && ss.getSheetByName(TAB_STATUS)) return;
  metSlot(() => {
    const sh = zorgTab(ss, TAB_STATUS, KOP_STATUS);
    sh.clear(); sh.getRange(1, 1, 1, KOP_STATUS.length).setValues([KOP_STATUS]);
    const rijen = klantRijen().filter(r => r[0]).map(r => {
      const json = leesKlantRij(r); if (!json) return null;
      const rij = statusRij(JSON.parse(json));
      rij[21] = String(r[11] instanceof Date ? r[11].getTime() : 0); // echte ontvangsttijd
      return rij;
    }).filter(Boolean);
    if (rijen.length) { zorgRuimte(sh, rijen.length + 1); tekstKolommen(sh, [[1, KOP_STATUS.length]]); sh.getRange(2, 1, rijen.length, KOP_STATUS.length).setValues(rijen); }
    props.setProperty('STATUS_VERSIE', STATUS_VERSIE);
  });
}

function leesStatus(ss) {
  zorgStatus(ss);
  const sh = ss.getSheetByName(TAB_STATUS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, KOP_STATUS.length).getValues().filter(r => r[0]).map(r => ({
    id: r[0], naam: r[1], adres: r[2], pcplaats: r[3], datum: r[4], offertenr: r[5], telefoon: r[6], email: r[7], meting: r[8],
    offerte: { keuze: r[9], nr: r[10], notitie: r[11], door: r[12], wie: r[13], datum: r[14], verstuurd: r[15] === 'ja', t: Number(r[16]) || 0 },
    bron: r[17], wens: r[18], door: r[19], verwijderd: r[20] === 'ja', ontvangen: Number(r[21]) || 0, excel: r[22] === 'ja'
  }));
}
