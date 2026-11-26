/* =========================================================
   Edison Meetformulier – configuratie
   Hier pas je producten, opties en standaardwaarden aan.
   Alle maten in MILLIMETER.
   ========================================================= */

const CONFIG = {
  versie: '1.0.0',

  // Standaardwaarden (zijn in de app onder Instellingen aan te passen;
  // wat hier staat is alleen de beginwaarde bij eerste gebruik)
  standaard: {
    plooi: 'Enkele plooi',
    overlap: 50,        // mm, opgeteld bij railbreedte (gordijnen)
    vloerafstand: 10,   // mm, afgetrokken van hoogte (gordijnen)
    aftrekB: 10,        // mm, aftrek breedte bij montage IN de dag
    aftrekH: 0,         // mm, aftrek hoogte bij montage IN de dag
    overmaatB: 0,       // mm, extra breedte bij montage OP de dag (totaal)
    overmaatH: 0,       // mm, extra hoogte bij montage OP de dag (totaal)
    matenInOfferte: true
  },

  // Afwijkende aftrek in de dag per product (mm). Niet genoemd = standaard.
  aftrekPerType: {
    'tru-fit':  { B: 0, H: 0 },
    'raamhor':  { B: 0, H: 0 },
    'hordeur':  { B: 0, H: 0 },
    'schuifhor':{ B: 0, H: 0 },
    'draaihor': { B: 0, H: 0 }
  },

  ondergrond: ['Beton', 'Hout', 'Gips / gipsplaat', 'Steen', 'Kunststof kozijn', 'Aluminium kozijn', 'Onbekend'],
  obstakels: ['Radiator', 'Vensterbank', 'Raamklink', 'Stopcontact', 'Leiding', 'Draai-kiepraam', 'Schuin plafond'],
  bevestiging: ['Wand', 'Plafond', 'Kozijn', 'Glaslat', 'In de nis (boven)'],

  // calc: 'stof'  = breedte + overlap, hoogte − vloerafstand
  //       'zon'   = in de dag: − aftrek, op de dag: + overmaat
  //       'lengte'= alleen lengte (rail/roede), regel als 'zon'
  producten: [
    // ---------- STOF ----------
    { id: 'overgordijn', naam: 'Overgordijn', groep: 'Stof', calc: 'stof', velden: ['plooi', 'plooifactor', 'uitvoering', 'voering', 'onderkant', 'ophanging'] },
    { id: 'vitrage',     naam: 'Vitrage',     groep: 'Stof', calc: 'stof', velden: ['plooi', 'plooifactor', 'uitvoering', 'onderkant', 'ophanging'] },
    { id: 'inbetween',   naam: 'Inbetween',   groep: 'Stof', calc: 'stof', velden: ['plooi', 'plooifactor', 'uitvoering', 'voering', 'onderkant', 'ophanging'] },
    { id: 'gordijnrail', naam: 'Gordijnrail', groep: 'Stof', calc: 'lengte', velden: ['railtype', 'railbediening', 'bocht', 'runners'] },
    { id: 'roede',       naam: 'Roede',       groep: 'Stof', calc: 'lengte', velden: ['diameter', 'eindknop', 'steunen'] },

    // ---------- BINNENZONWERING ----------
    { id: 'rolgordijn',  naam: 'Rolgordijn',      groep: 'Binnenzonwering', calc: 'zon', velden: ['bediening', 'zijde', 'rolrichting', 'onderlat'] },
    { id: 'duorol',      naam: 'Duo-rolgordijn',  groep: 'Binnenzonwering', calc: 'zon', velden: ['bediening', 'zijde'] },
    { id: 'plisse',      naam: 'Plissé',          groep: 'Binnenzonwering', calc: 'zon', velden: ['systeem', 'bediening', 'zijde'] },
    { id: 'duette',      naam: 'Duette',          groep: 'Binnenzonwering', calc: 'zon', velden: ['systeem', 'plooimaat', 'bediening', 'zijde'] },
    { id: 'vouwgordijn', naam: 'Vouwgordijn',     groep: 'Binnenzonwering', calc: 'zon', velden: ['bediening', 'zijde', 'voering'] },
    { id: 'paneel',      naam: 'Paneelgordijn',   groep: 'Binnenzonwering', calc: 'zon', velden: ['panelen', 'pakket', 'bediening'] },
    { id: 'lamellen',    naam: 'Verticale lamellen', groep: 'Binnenzonwering', calc: 'zon', velden: ['lamelbreedte', 'pakket', 'bediening', 'zijde'] },
    { id: 'jaloezie-hout', naam: 'Jaloezie hout', groep: 'Binnenzonwering', calc: 'zon', velden: ['lamelHout', 'ladder', 'bediening', 'zijde'] },
    { id: 'jaloezie-alu',  naam: 'Jaloezie aluminium', groep: 'Binnenzonwering', calc: 'zon', velden: ['lamelAlu', 'bediening', 'zijde'] },
    { id: 'shutters',    naam: 'Shutters',        groep: 'Binnenzonwering', calc: 'zon', velden: ['panelen', 'shutterlamel', 'indeling', 'frame'] },
    { id: 'tru-fit',     naam: 'Tru-fit',         groep: 'Binnenzonwering', calc: 'zon', velden: ['trufitType', 'bediening'] },

    // ---------- HORREN ----------
    { id: 'raamhor',     naam: 'Raamhor',          groep: 'Horren', calc: 'zon', velden: ['hortype', 'gaas'] },
    { id: 'hordeur',     naam: 'Plissé hordeur',   groep: 'Horren', calc: 'zon', velden: ['opening', 'drempel', 'gaas'] },
    { id: 'schuifhor',   naam: 'Schuifhor',        groep: 'Horren', calc: 'zon', velden: ['opening', 'gaas'] },
    { id: 'draaihor',    naam: 'Draaihor',         groep: 'Horren', calc: 'zon', velden: ['draairichting', 'gaas'] }
  ],

  // Optievelden. type: select | text
  velden: {
    plooi:        { label: 'Plooi', type: 'select', opties: ['Enkele plooi', 'Dubbele plooi', 'Driedubbele plooi', 'Wave', 'Ringen', 'Plooiband', 'Lussen', 'Ploeterplooi'], std: 'plooi' },
    plooifactor:  { label: 'Plooifactor', type: 'text', placeholder: 'bijv. 2,0' },
    uitvoering:   { label: 'Uitvoering', type: 'select', opties: ['2-delig (midden open)', '1-delig naar links', '1-delig naar rechts', 'Vast'] },
    voering:      { label: 'Voering', type: 'select', opties: ['Geen', 'Standaard', 'Verduisterend', 'Thermisch'] },
    onderkant:    { label: 'Onderkant', type: 'select', opties: ['Vloerafstand (standaard)', 'Op de vloer', 'Slepend', 'Vensterbank'] },
    ophanging:    { label: 'Ophanging', type: 'select', opties: ['Rail', 'Roede', 'Bestaande rail', 'Bestaande roede'] },
    railtype:     { label: 'Railtype', type: 'text', placeholder: 'bijv. KS, GD' },
    railbediening:{ label: 'Bediening', type: 'select', opties: ['Hand', 'Trekstok', 'Koord', 'Elektrisch'] },
    bocht:        { label: 'Bocht', type: 'select', opties: ['Geen', 'Links', 'Rechts', 'Beide'] },
    runners:      { label: 'Runners/glijders', type: 'text' },
    diameter:     { label: 'Diameter', type: 'select', opties: ['16 mm', '20 mm', '25 mm', '28 mm', '35 mm'] },
    eindknop:     { label: 'Eindknop', type: 'text' },
    steunen:      { label: 'Steunen', type: 'select', opties: ['Wand', 'Plafond', 'Nis'] },
    bediening:    { label: 'Bediening', type: 'select', opties: ['Ketting', 'Koord', 'Stang', 'Greep (handbediend)', 'Veer', 'Elektrisch (accu)', 'Elektrisch (net)'] },
    zijde:        { label: 'Bedieningszijde', type: 'select', opties: ['Rechts', 'Links', 'Midden'] },
    rolrichting:  { label: 'Rolrichting', type: 'select', opties: ['Normaal (stof achter)', 'Omgekeerd (stof voor)'] },
    onderlat:     { label: 'Onderlat', type: 'text' },
    systeem:      { label: 'Systeem', type: 'select', opties: ['Vrijhangend', 'Gespannen', 'Top-down/bottom-up', 'Day & Night', 'Geleid'] },
    plooimaat:    { label: 'Plooimaat', type: 'select', opties: ['25 mm', '32 mm', '45 mm', '64 mm'] },
    panelen:      { label: 'Aantal panelen', type: 'text', placeholder: 'bijv. 4' },
    pakket:       { label: 'Pakket', type: 'select', opties: ['Links', 'Rechts', 'Midden', 'Links + rechts'] },
    lamelbreedte: { label: 'Lamelbreedte', type: 'select', opties: ['89 mm', '127 mm'] },
    lamelHout:    { label: 'Lamelbreedte', type: 'select', opties: ['25 mm', '35 mm', '50 mm', '65 mm'] },
    lamelAlu:     { label: 'Lamelbreedte', type: 'select', opties: ['16 mm', '25 mm', '35 mm', '50 mm'] },
    ladder:       { label: 'Ladder', type: 'select', opties: ['Ladderkoord', 'Ladderband'] },
    shutterlamel: { label: 'Lamel', type: 'select', opties: ['47 mm', '63 mm', '76 mm', '89 mm', '114 mm'] },
    indeling:     { label: 'Indeling', type: 'text', placeholder: 'bijv. L-R, LL-RR' },
    frame:        { label: 'Frame', type: 'text' },
    trufitType:   { label: 'Type', type: 'select', opties: ['Plissé', 'Duette', 'Jaloezie'] },
    hortype:      { label: 'Type', type: 'select', opties: ['Inzethor', 'Rolhor', 'Vaste hor', 'Opzethor'] },
    gaas:         { label: 'Gaas', type: 'select', opties: ['Grijs', 'Zwart', 'Pollen', 'Huisdier'] },
    opening:      { label: 'Opening', type: 'select', opties: ['Naar links', 'Naar rechts', 'Midden'] },
    drempel:      { label: 'Drempel', type: 'select', opties: ['Standaard', 'Vlak (laag)', 'Geen'] },
    draairichting:{ label: 'Draairichting', type: 'select', opties: ['Links', 'Rechts'] }
  }
};
