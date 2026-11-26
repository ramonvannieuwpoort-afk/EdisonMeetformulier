/* =========================================================
   Edison Meetformulier – configuratie
   Producten, kleurnummers en opties komen uit catalogus.js
   (= je master-offerte). Hier staan alleen de meetinstellingen.
   Alle maten in MILLIMETER.
   ========================================================= */

const CONFIG = {
  versie: '2.2.2',

  // Beginwaarden (aan te passen in de app onder Instellingen)
  standaard: {
    overlap: 50,        // mm, opgeteld bij railbreedte (gordijnen) – Excel rekent rails = breedte − 50
    vloerafstand: 10,   // mm, afgetrokken van hoogte (gordijnen)
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
