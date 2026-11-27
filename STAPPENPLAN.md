# Stappenplan Edison Meetformulier

Je doet dit eenmalig, in vier delen. Reken op ongeveer 30 minuten.

## Eerst lezen: valkuilen

- **Gebruik op iPhone en iPad alleen het app-icoon op je beginscherm, nooit een Safari-tabblad.** iOS houdt de gegevens van de Safari-tab en die van het icoon gescheiden. Een meting in de tab zie je dus niet terug in de app.
- **Gegevens staan eerst alleen op je toestel.** Pas als het label rechtsboven "✓ Gesynchroniseerd" toont, staan ze in je Sheet. Bij "wacht" of "⚠" nog niets weggooien of wissen.
- **Standaardwaarden die je moet controleren** (Instellingen): de aftrek in de hoogte bij montage in de dag staat op 0 mm. De overmaat op de dag staat op 0 mm. Tru-fit, horren en shutters staan op 0 mm aftrek.
- **Laser in meters zonder eenheid:** de app leest "1.195" als 1195 mm.
- **Het bladnummer** ("Blad x van y") telt per ruimte. Een ruimte met veel ramen loopt door op een volgende pagina zonder nieuwe kop.

## Deel 1 – Google Sheet en Apps Script

1. Ga naar drive.google.com, kies **Nieuw → Google Spreadsheets** en noem het bestand `Edison Meetformulier – database`.
2. Kies in de Sheet **Extensies → Apps Script**.
3. Verwijder de voorbeeldcode in `Code.gs` en plak de volledige inhoud van `apps-script/Code.gs`. Klik op het **diskette-icoon** om op te slaan.
4. Kies bovenin in het functiemenu **installeer** en klik op **Uitvoeren**.
   - Klik op **Rechten controleren** en kies je account.
   - Je krijgt de melding "Google heeft deze app niet geverifieerd". Klik op **Geavanceerd → Ga naar … (onveilig) → Toestaan**. Dit klopt: het is je eigen script.
5. Onderin staat het **uitvoeringslogboek** met: `Je sleutel is: …`. **Kopieer die sleutel** en bewaar hem, bijvoorbeeld in je wachtwoordbeheer.
6. Klik op **Implementeren → Nieuwe implementatie**. Klik daarna op het **tandwiel** en kies **Web-app**.
   - Beschrijving: `v1`
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**. Dat is nodig omdat de app zonder Google-inlog werkt. De beveiliging zit in de sleutel.
7. Klik op **Implementeren** en kopieer de **Web-app-URL**. Die eindigt op `/exec`.

In de Sheet staan nu de tabbladen *Klanten*, *Regels* en *Instellingen*. In je Drive staat de map *Edison Meetformulier – foto's*.

## Deel 2 – GitHub Pages

1. Log in op github.com en kies **New repository**.
   - Naam: `meetformulier`
   - Zichtbaarheid: **Public**. Dat is nodig voor gratis GitHub Pages. De code is dan openbaar, maar er staan geen klantgegevens in.
2. Klik op **Add file → Upload files**. Sleep **alle bestanden behalve de map `apps-script`** erin: `index.html`, `app.js`, `config.js`, `style.css`, `sw.js`, `manifest.webmanifest`, `logo.png` en de drie icoon-png's. Klik op **Commit changes**.
3. Ga naar **Settings → Pages** en kies:
   - Source: **Deploy from a branch**
   - Branch: **main**, map **/ (root)**

   Klik op **Save**.
4. Na 1 à 2 minuten staat de app op `https://<jouw-gebruikersnaam>.github.io/meetformulier/`.

## Deel 3 – iPhone, iPad en laptop

1. Open de URL in **Safari**. Tik op **Deel** (vierkantje met pijl) en kies **Zet op beginscherm**.
2. Open de app **via het icoon**.
3. Ga naar **Instellingen → Koppeling Google Sheet** en plak de Web-app-URL en de sleutel. Tik op **Test verbinding**. Je hoort dan te zien: "Verbinding werkt".
4. Doe hetzelfde op je iPad.
5. Op de laptop open je de URL in Chrome of Safari en maak je een bladwijzer. Ook daar vul je de URL en de sleutel in.

De standaardwaarden synchroniseren tussen je toestellen. De URL en de sleutel vul je per toestel in.

## Deel 4 – Testen voordat je ermee de deur uit gaat

- [ ] Maak een testklant met een ruimte, een raam, een product en een foto.
- [ ] Wacht tot het label "✓ Gesynchroniseerd" toont. Controleer daarna in de Sheet de tabbladen *Klanten* en *Regels*, en de foto in de Drive-map.
- [ ] Test offline: zet vliegtuigmodus aan en maak een meting. Het label toont dan "Offline · 1 wacht". Zet vliegtuigmodus uit. Binnen een minuut verschijnt "✓ Gesynchroniseerd".
- [ ] Open de testklant op je iPad. Hij verschijnt vanzelf.
- [ ] Ga naar **Overzicht & print → Printen / PDF** en controleer de A4-opmaak en de linkermarge voor de perforatie.
- [ ] Test **Kopieer voor offerte**: open de offerte-Excel, klik op cel **B14** en plak met **Edit → Paste** (Cmd+V).
- [ ] Print **Lege printversie** voor de map, als reserve.
- [ ] Verwijder de testklant (**Meting verwijderen**). In de Sheet krijgt hij dan "ja" in de kolom *Verwijderd*.

## Later: onderhoud

- **Producten of opties aanpassen:** bewerk `config.js` op GitHub met het potlood-icoon. Verhoog daarna in `sw.js` de regel `VERSIE` (bijvoorbeeld `emf-1.0.1`). Zonder die stap blijven toestellen de oude versie gebruiken. Sluit de app op je telefoon daarna één keer helemaal af en open hem opnieuw.
- **Het script aanpassen:** gaat automatisch zodra je `STAPPENPLAN-AUTOMATISCH.md` (deel 1) hebt gedaan. Daarvoor: plak de nieuwe code en sla op. Kies dan **Implementeren → Implementaties beheren → potlood → Versie: Nieuwe versie → Implementeren**. De URL blijft hetzelfde.
- **Sleutel uitgelekt of telefoon kwijt:** voer in Apps Script de functie `nieuweSleutel` uit en vul de nieuwe sleutel in op je toestellen.
- **Back-up:** via **Instellingen → Download back-up**. De Sheet is ook al een back-up.
- **Laser met toetsenbordmodus:** tik in het eerste maatveld en meet. Na het versturen springt de cursor zelf naar het volgende veld.
