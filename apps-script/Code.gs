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
function zorgTab(ss, naam, kop) {
  let sh = ss.getSheetByName(naam);
  if (!sh) sh = ss.insertSheet(naam);
  if (sh.getLastRow() === 0) { sh.appendRow(kop); sh.setFrozenRows(1); sh.getRange(1, 1, 1, kop.length).setFontWeight('bold').setBackground('#BDB39B'); }
  return sh;
}

/* ---------- web-app ---------- */
function doGet() { return uit({ ok: true, bericht: 'Edison Meetformulier – koppeling actief' }); }

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const sleutel = PropertiesService.getScriptProperties().getProperty('SLEUTEL');
    if (!sleutel || d.key !== sleutel) return uit({ ok: false, fout: 'Ongeldige sleutel' });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      switch (d.action) {
        case 'test': return uit({ ok: true, bericht: 'Sheet "' + SpreadsheetApp.getActive().getName() + '" bereikbaar' });
        case 'opslaan': opslaan(d.klant); return uit({ ok: true });
        case 'foto': return uit({ ok: true, driveId: bewaarFoto(d) });
        case 'lijst': return uit(lijst(Number(d.sinds) || 0));
        case 'catalogus': return uit({ ok: true, catalogus: catalogus() });
        case 'instellingen_opslaan': bewaarInst(d.inst); return uit({ ok: true });
        default: return uit({ ok: false, fout: 'Onbekende actie' });
      }
    } finally { lock.releaseLock(); }
  } catch (err) {
    return uit({ ok: false, fout: String(err && err.message || err) });
  }
}
function uit(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- klanten ---------- */
function opslaan(k) {
  const ss = SpreadsheetApp.getActive();
  const sh = zorgTab(ss, TAB_KLANTEN, KOP_KLANTEN);
  const json = JSON.stringify(k);
  const stukken = [];
  for (let i = 0; i < json.length; i += STUK) stukken.push(json.slice(i, i + STUK));
  const producten = k.ruimtes.reduce((a, r) => a + r.ramen.reduce((b, w) => b + w.producten.length, 0), 0);
  const rij = [k.id, k.naam, k.adres, k.pcplaats, k.datum, k.offertenr, k.telefoon, k.email, k.ruimtes.length, producten,
    new Date(k.updated), new Date(), k.verwijderd ? 'ja' : ''].concat(stukken);

  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  const idx = ids.indexOf(k.id);
  const nr = idx >= 0 ? idx + 2 : sh.getLastRow() + 1;
  // oude JSON-stukken leegmaken
  const breedte = Math.max(sh.getLastColumn(), rij.length);
  sh.getRange(nr, 1, 1, breedte).clearContent();
  sh.getRange(nr, 1, 1, rij.length).setValues([rij]);
  sh.getRange(nr, 5).setNumberFormat('@');
  // tekst in Datum-kolom houden we als tekst (yyyy-mm-dd)
  sh.getRange(nr, 5).setValue(k.datum);
  schrijfRegels(ss, k);
}

function leesKlantRij(rij) {
  return rij.slice(13).filter(String).join('');
}

function lijst(sinds) {
  const ss = SpreadsheetApp.getActive();
  const sh = zorgTab(ss, TAB_KLANTEN, KOP_KLANTEN);
  const uitvoer = { ok: true, serverTijd: Date.now() - 5000, klanten: [] };
  if (sh.getLastRow() > 1) {
    const data = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    data.forEach(r => {
      const ontvangen = r[11] instanceof Date ? r[11].getTime() : 0;
      if (ontvangen < sinds) return;
      const json = leesKlantRij(r);
      if (!json) return;
      const k = JSON.parse(json);
      uitvoer.klanten.push({ id: k.id, updated: k.updated, json: json });
    });
  }
  const si = ss.getSheetByName(TAB_INST);
  if (si && si.getLastRow() > 1) {
    const v = si.getRange(2, 1).getValue();
    if (v) uitvoer.instellingen = JSON.parse(v);
  }
  return uitvoer;
}

/* ---------- regels (plat overzicht per product) ---------- */
function schrijfRegels(ss, k) {
  const sh = zorgTab(ss, TAB_REGELS, KOP_REGELS);
  sh.getRange(1, 1, 1, KOP_REGELS.length).setValues([KOP_REGELS]);
  // oude regels van deze klant verwijderen (van onder naar boven)
  if (sh.getLastRow() > 1) {
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (let i = ids.length - 1; i >= 0; i--) if (ids[i][0] === k.id) sh.deleteRow(i + 2);
  }
  if (k.verwijderd) return;
  const rijen = [];
  k.ruimtes.forEach(ru => ru.ramen.forEach(w => w.producten.forEach(p => {
    const b = p.berekend; if (!b) return;
    rijen.push([k.id, k.naam, k.offertenr, ru.naam, w.nr, p.cat, p.art, b.calc === 'zon' ? (p.montage === 'in' ? 'In de dag' : 'Op de dag') : '',
      b.B == null ? '' : b.B, b.H == null ? '' : b.H, b.hand ? 'ja' : '', (p.hand && p.hand.reden) || '',
      b.sB == null ? '' : b.sB, b.sH == null ? '' : b.sH, b.kleur || '', b.pk || '', b.uitvoering || '', p.plaatsen || '', p.opmerking || '']);
  })));
  if (rijen.length) sh.getRange(sh.getLastRow() + 1, 1, rijen.length, KOP_REGELS.length).setValues(rijen);
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
  kl.forEach(r => { if (!r[0] || !r[1]) return; (kleuren[r[0]] = kleuren[r[0]] || {})[String(r[1])] = [r[2], r[3], r[4] ? Number(r[4]) : '']; });
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
