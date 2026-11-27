# Stappenplan versie 2.5 – alles automatisch, geen knippen en plakken

Je doet dit eenmalig, in drie delen. Reken op ongeveer 30 minuten. Doe de delen in deze volgorde.

Daarna gaat het zo:

- **Offerte maken:** in Excel klik je op **Meting ophalen**, kiest de klant en Invoer en Gordijnen staan gevuld.
- **Nieuwe prijslijst:** in je master draai je **StuurCatalogus**. De app haalt de prijslijst vanzelf op.
- **Updates van mij:** de app én het Apps Script gaan vanzelf live. Alleen een nieuwe Excel-macro importeer je nog zelf.

## Eerst lezen: valkuilen

- **Open na de update de app één keer op het toestel waar je metingen op staan.** Alle metingen worden dan opnieuw verstuurd, nu met de gegevens voor Excel erbij. Wacht tot het label "✓ Gesynchroniseerd" toont. Een meting die dat nog niet heeft gehad, staat niet in de lijst in Excel.
- **De bestandsnaam en de map van het hulpscript moeten precies kloppen** (deel 2, stap 2). Anders meldt Excel "hulpscript niet gevonden".
- **De web-app-URL en de sleutel staan in Excel op je Mac, niet in het bestand.** Ze komen dus nooit in de collega-versie of in een offerte. Op een andere Mac vul je ze opnieuw in.
- **"Kopieer voor Excel" en plakken blijven werken**, als reserve.

## Deel 1 – Apps Script automatisch bijwerken (GitHub)

Hiermee zet GitHub een nieuwe versie van het script zelf live. Dat gebeurt meteen ook voor deze update.

1. **Apps Script API aanzetten.** Ga naar `https://script.google.com/home/usersettings` en zet **Google Apps Script API** op **Aan**.
2. **Node.js installeren** (eenmalig, nodig voor het inloggen). Ga naar `nodejs.org`, download de **LTS**-versie voor macOS en installeer het .pkg-bestand.
3. **Inloggen.** Open **Terminal** (Cmd+spatie, typ Terminal) en plak:
   ```
   npx @google/clasp@2.4.2 login
   ```
   Typ `y` als er gevraagd wordt om iets te installeren. Je browser opent. Kies het Google-account van de Sheet en klik op **Toestaan**. In Terminal staat dan "Authorization successful".
4. **Inlogcode kopiëren.** Plak in Terminal:
   ```
   pbcopy < ~/.clasprc.json
   ```
   De code staat nu op je klembord. Plak hem nergens anders dan in stap 5.
5. **Drie geheimen in GitHub zetten.** Ga naar je repository → **Settings → Secrets and variables → Actions → New repository secret**. Maak er drie:
   - Naam `CLASPRC_JSON`, waarde: plakken (Cmd+V) wat je in stap 4 kopieerde.
   - Naam `SCRIPT_ID`, waarde: open je Apps Script, klik links op het **tandwiel (Projectinstellingen)** en kopieer de **Script-ID**.
   - Naam `DEPLOYMENT_ID`, waarde: het stuk tussen `/s/` en `/exec` in je web-app-URL. Uit `https://script.google.com/macros/s/AKfy…xyz/exec` kopieer je dus `AKfy…xyz`.
6. **Eerste keer draaien.** Ga in je repository naar **Actions → Apps Script bijwerken → Run workflow → Run workflow**. Na ongeveer een minuut staat er een groen vinkje. Het nieuwe script staat nu live, met dezelfde URL.

Rood kruisje? Klik erop en kijk bij de stap die rood is. Meestal is één van de drie geheimen niet helemaal goed geplakt, of staat de Apps Script API (stap 1) nog uit.

## Deel 2 – Excel

1. **Bestanden downloaden.** Ga naar je repository en klik op **Code → Download ZIP**. Pak het zip-bestand uit. Je hebt uit de map `excel` twee bestanden nodig: `EdisonMeet.applescript` en `MeetKoppeling.bas`.
2. **Hulpscript op zijn plek zetten.** Kies in Finder **Go → Go to Folder…** (Shift+Cmd+G) en plak:
   ```
   ~/Library/Application Scripts/com.microsoft.Excel
   ```
   Bestaat die map niet, ga dan naar `~/Library/Application Scripts` en maak een map met precies de naam `com.microsoft.Excel`. Kopieer `EdisonMeet.applescript` erin.
3. **Macro importeren.** Open het bestand waarmee je nieuwe offertes begint (sjabloon .xltm of master .xlsm). Open de VBA-editor via **Tools → Macro → Visual Basic Editor**. Klik links op **VBAProject (jouw bestand)** en kies **File → Import File…** → `MeetKoppeling.bas`. De module **MeetImport** blijft gewoon staan; die is nog nodig.
4. **Koppeling invullen.** Sluit de editor. Kies **Tools → Macro → Macros…** → **KoppelingInstellen** → **Run**. Plak de web-app-URL en de sleutel, dezelfde als in de app. Je hoort te zien: "Koppeling werkt".
5. **Knop maken.** Ga naar tab **Invoer** en kies **Insert → Shape**. Teken een vorm en typ er `Meting ophalen` in. Klik er met rechts op → **Assign Macro…** → **HaalMeting** → **OK**.
6. Sla het bestand op in dezelfde indeling als het al had (.xltm of .xlsm).

## Deel 3 – App

Hier hoef je niets te doen. De app staat al op versie 2.5.0. Sluit hem op je iPhone één keer helemaal af (omhoog vegen in de app-kiezer) en open hem opnieuw. Onderaan bij **Instellingen** staat dan **Versie 2.5.0**. Wacht tot het label "✓ Gesynchroniseerd" toont (zie valkuilen). Doe hetzelfde op je iPad en laptop.

## Testen

- [ ] Nieuwe offerte → knop **Meting ophalen** → je ziet je laatste metingen. Kies er één met het nummer, of typ een stukje van de naam of het offertenummer. Invoer en Gordijnen worden gevuld en je krijgt de controlemelding zoals altijd.
- [ ] Master → **Tools → Macro → Macros… → StuurCatalogus**. Je krijgt per tab het aantal regels te zien. Open de app daarna: binnen een minuut verschijnt "Nieuwe prijslijst binnen".

## Elke offerte

1. Begin een nieuwe offerte.
2. Klik op **Meting ophalen** en kies de klant.
3. Controleer de kolom **Controle**, zet de datum vast (Cmd + ;) en ga verder zoals je gewend bent.

## Nieuwe prijslijst (jaarlijks)

1. Werk je master bij zoals altijd.
2. Draai in de master **StuurCatalogus**. Klaar: de app haalt hem vanzelf op, op elk toestel.

## Als er iets mis is

- **"Hulpscript niet gevonden":** controleer de map en de naam uit deel 2, stap 2. De naam moet precies `EdisonMeet.applescript` zijn.
- **"Ongeldige sleutel":** draai **KoppelingInstellen** opnieuw en plak de sleutel uit de app (Instellingen → Koppeling Google Sheet).
- **"Onverwacht antwoord":** de web-app-URL klopt niet. Draai **KoppelingInstellen** en controleer of de URL eindigt op `/exec`.
- **Een meting staat niet in de lijst:** open de app op het toestel waar je hebt gemeten en wacht tot "✓ Gesynchroniseerd".
