/* =========================================================
   Edison Meetformulier – configuratie
   Producten, kleurnummers en opties komen uit catalogus.js
   (= je master-offerte). Hier staan alleen de meetinstellingen.
   Alle maten in MILLIMETER.
   ========================================================= */

const CONFIG = {
  versie: '2.8.0',

  // Beginwaarden (aan te passen in de app onder Instellingen)
  standaard: {
    overlapStuk: 0,     // mm, overlap bij een gordijn als stuk
    overlap: 50,        // mm, opgeteld bij railbreedte (gordijnen) – Excel rekent rails = breedte − 50
    vloerafstand: 10,   // mm, gordijn net boven de grond: kortste hoogte − dit
    opGrond: 50,        // mm, gordijn op de grond: langste hoogte + dit
    vensterbank: 10,    // mm, gordijn tot de vensterbank: kortste hoogte − dit
    vitrageExtra: 5,    // mm, extra korter voor een vitrage achter een overgordijn (alleen boven grond/vensterbank)
    aftrekB: 10,        // mm, aftrek breedte bij montage IN de dag
    aftrekH: 0,         // mm, aftrek hoogte bij montage IN de dag
    overmaatB: 0,       // mm, extra breedte bij montage OP de dag (totaal)
    overmaatH: 0        // mm, extra hoogte bij montage OP de dag (totaal)
  },

  // Afwijkende aftrek in de dag. Sleutel = categorie uit de master, of 'TruFit'
  // (geldt zodra een TruFit-optie is gekozen). Niet genoemd = standaard.
  aftrekPerType: {
    'TruFit': { B: 0, H: 0 },
    'Luxaflex horren': { B: 0, H: 0 }
  },

  ondergrond: ['Beton', 'Hout', 'Gips / gipsplaat', 'Steen', 'Kunststof kozijn', 'Aluminium kozijn', 'Onbekend'],
  obstakels: ['Radiator', 'Vensterbank', 'Raamklink', 'Stopcontact', 'Leiding', 'Draai-kiepraam', 'Schuin plafond'],
  bevestiging: ['Wand', 'Plafond', 'Kozijn', 'Glaslat', 'In de nis (boven)'],
  zijde: ['Rechts', 'Links', 'Midden', 'Links + rechts'],

  // Adres opzoeken (PDOK, gratis overheidsdienst). Zoekt bij voorkeur rond Amsterdam.
  adres: { lat: 52.37, lon: 4.89 }
};
