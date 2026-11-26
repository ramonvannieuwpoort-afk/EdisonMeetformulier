# Update naar versie 2 – koppeling met je offerte-Excel

Je doet dit eenmalig, in drie delen. Reken op ongeveer 20 minuten.

## Eerst lezen: valkuilen

- **Plak altijd in de tab Import, nooit rechtstreeks in Invoer.** Plakken in Invoer wist de keuzelijsten.
- **De macro moet in het bestand staan waarmee je nieuwe offertes begint**, dus je sjabloon (.xltm) of je master (.xlsm). Anders zit hij niet in je nieuwe offertes.
- **Maximaal 21 productregels, 8 gordijnen en 8 ruimtes.** Past een meting niet, dan stopt de macro en verandert er niets.
- **Producten in oude testmetingen** moet je opnieuw kiezen, omdat de productlijst nu uit je master komt. Verwijder de testklant gewoon.

## Deel 1 – GitHub (de app)

1. Ga naar je repository `meetformulier` en klik op **Add file → Upload files**.
2. Sleep **alle bestanden behalve de mappen `apps-script` en `excel`** erin. Het nieuwe bestand `catalogus.js` hoort er ook bij. Bestaande bestanden worden overschreven.
3. Klik op **Commit changes** en wacht 1 à 2 minuten.
4. Sluit de app op je iPhone volledig af (omhoog vegen in de app-kiezer) en open hem opnieuw. Doe dat eventueel twee keer. Onderaan bij **Instellingen** moet nu **Versie 2.0.0** staan.

## Deel 2 – Apps Script (de Sheet)

1. Open je Sheet en kies **Extensies → Apps Script**.
2. Vervang alle code in `Code.gs` door de nieuwe `apps-script/Code.gs` en klik op **opslaan**.
3. Kies **Implementeren → Implementaties beheren**, klik op het **potlood**, kies bij Versie **Nieuwe versie** en klik op **Implementeren**. De URL blijft hetzelfde.

## Deel 3 – Excel (de importmacro)

1. Open het bestand waarmee je nieuwe offertes begint.
2. Open de VBA-editor via **Tools → Macro → Visual Basic Editor**, of met Fn + Option + F11.
3. Klik links op **VBAProject (jouw bestand)** en kies **File → Import File…**. Kies `excel/MeetImport.bas`. Links verschijnt een module **MeetImport**.
4. Sluit de editor. Kies **Tools → Macro → Macros…**, selecteer **MaakImportTab** en klik op **Run**. Er komt een nieuwe tab **Import** bij.
5. Sla het bestand op in dezelfde indeling als het al had (.xltm of .xlsm).
6. Optioneel: zet een knop op Invoer via **Insert → Shape**, klik met rechts op de vorm en kies **Assign Macro → ImporteerMeting**.

## Elke offerte

1. **App:** open de klant en tik op **Kopieer voor Excel**. Dit doe je het makkelijkst op de laptop. Vanaf je iPhone kan het ook via het gedeelde klembord (hetzelfde Apple ID en Handoff aan).
2. **Excel:** begin een nieuwe offerte. Ga naar tab **Import**, klik op cel **A1** en plak met **Cmd+V**.
3. Draai **Tools → Macro → Macros… → ImporteerMeting**.
4. Controleer de kolom **Controle** op Invoer en Gordijnen, zet de datum vast (Cmd + ;) en ga verder zoals je gewend bent.

## Nieuwe prijslijst (jaarlijks)

1. Werk je master bij zoals altijd.
2. Kopieer de tabs **Artikelen**, **Opties** en **Kleuren** (hele blad, vanaf A1) naar tabbladen met **precies dezelfde naam** in de Google Sheet van de app.
3. Ga in de app naar **Instellingen → Catalogus ophalen uit Sheet**. Doe dat op elk toestel.
