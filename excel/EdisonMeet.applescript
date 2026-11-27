-- Edison Meetformulier – hulpscript voor Excel (macro's HaalMeting en StuurCatalogus)
--
-- Excel voor Mac mag vanuit een macro niet zelf het internet op. Dit script doet
-- dat voor de macro, met curl (zit standaard op elke Mac).
--
-- Zet dit bestand (naam precies EdisonMeet.applescript) in de map:
--   ~/Library/Application Scripts/com.microsoft.Excel/
-- Zie STAPPENPLAN-AUTOMATISCH.md.

on haal(param)
	-- param = URL, linefeed, en optioneel het pad van een bestand om mee te sturen
	set oud to AppleScript's text item delimiters
	set AppleScript's text item delimiters to linefeed
	set delen to text items of param
	set AppleScript's text item delimiters to oud
	set adres to item 1 of delen
	set bestand to ""
	if (count of delen) > 1 then set bestand to item 2 of delen
	set cmd to "/usr/bin/curl -sS -L --max-time 180 -H 'Content-Type: text/plain; charset=utf-8' "
	if bestand is "" then
		set cmd to cmd & "--data-binary '' "
	else
		set cmd to cmd & "--data-binary @" & quoted form of bestand & " "
	end if
	set cmd to cmd & quoted form of adres
	try
		return do shell script cmd without altering line endings
	on error foutmelding
		return "FOUT" & tab & "Geen verbinding met de Google Sheet: " & foutmelding
	end try
end haal
