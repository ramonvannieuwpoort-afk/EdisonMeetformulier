Attribute VB_Name = "MeetImport"
Option Explicit

' =====================================================================
'  Edison Meetformulier - import naar tab Invoer en tab Gordijnen
'
'  Werkwijze:
'   1. App: klant openen > "Kopieer voor Excel"
'   2. Excel: tab Import > klik cel A1 > plakken (Cmd+V)
'   3. Macro ImporteerMeting draaien
'
'  Bestaat tab Import nog niet? Draai dan eerst MaakImportTab.
' =====================================================================

Private Const INV_EERSTE As Long = 16
Private Const INV_LAATSTE As Long = 36
Private Const GORD_EERSTE As Long = 6
Private Const GORD_LAATSTE As Long = 13
Private Const RUIMTE_EERSTE As Long = 4
Private Const RUIMTE_LAATSTE As Long = 11

Public Sub MaakImportTab()
    Dim ws As Worksheet
    Set ws = ImportBlad(True)
    ws.Activate
    ws.Range("A1").Select
    MsgBox "Tab Import staat klaar." & vbCr & vbCr & _
           "Klik in cel A1 en plak (Cmd+V) wat je in de app met 'Kopieer voor Excel' hebt gekopieerd. " & _
           "Draai daarna de macro ImporteerMeting.", vbInformation, "Meetformulier"
End Sub

Private Function ImportBlad(ByVal maak As Boolean) As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("Import")
    On Error GoTo 0
    If ws Is Nothing And maak Then
        Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        ws.Name = "Import"
        ws.Cells.NumberFormat = "@"
        ws.Range("A1").Value = "Plak hier in cel A1 wat je in de app met 'Kopieer voor Excel' hebt gekopieerd. Draai daarna macro ImporteerMeting."
    End If
    Set ImportBlad = ws
End Function

Public Sub ImporteerMeting()
    Dim wsI As Worksheet, inv As Worksheet, gor As Worksheet
    Set wsI = ImportBlad(False)
    If wsI Is Nothing Then
        MaakImportTab
        Exit Sub
    End If
    If Trim$(CStr(wsI.Range("A1").Value)) <> "EDISON-MEETFORMULIER" Then
        MsgBox "In tab Import staat in cel A1 geen meting." & vbCr & vbCr & _
               "Kopieer in de app met 'Kopieer voor Excel' en plak in cel A1 van tab Import.", vbExclamation, "Meetformulier"
        wsI.Activate
        Exit Sub
    End If

    Set inv = ThisWorkbook.Worksheets("Invoer")
    Set gor = ThisWorkbook.Worksheets("Gordijnen")

    Dim laatste As Long, r As Long, soort As String
    Dim nInv As Long, nGor As Long, nRui As Long
    laatste = LaatsteRij(wsI)
    For r = 1 To laatste
        soort = Trim$(CStr(wsI.Cells(r, 1).Value))
        If soort = "INVOER" Then nInv = nInv + 1
        If soort = "GORDIJN" Then nGor = nGor + 1
        If soort = "RUIMTE" Then nRui = nRui + 1
    Next r

    If nInv > INV_LAATSTE - INV_EERSTE + 1 Or nGor > GORD_LAATSTE - GORD_EERSTE + 1 Or nRui > RUIMTE_LAATSTE - RUIMTE_EERSTE + 1 Then
        MsgBox "Deze meting past niet op het offerteblad:" & vbCr & vbCr & _
               nInv & " productregels (max " & (INV_LAATSTE - INV_EERSTE + 1) & ")" & vbCr & _
               nGor & " gordijnen (max " & (GORD_LAATSTE - GORD_EERSTE + 1) & ")" & vbCr & _
               nRui & " ruimtes (max " & (RUIMTE_LAATSTE - RUIMTE_EERSTE + 1) & ")" & vbCr & vbCr & _
               "Er is niets veranderd.", vbCritical, "Meetformulier"
        Exit Sub
    End If

    If Application.WorksheetFunction.CountA(inv.Range("B16:C36")) > 0 _
       Or Application.WorksheetFunction.CountA(gor.Range("D6:E13")) > 0 _
       Or Application.WorksheetFunction.CountA(inv.Range("T4:T11")) > 0 Then
        If MsgBox("Invoer en/of Gordijnen bevatten al gegevens." & vbCr & vbCr & _
                  "Wissen en vervangen door deze meting?", vbYesNo + vbQuestion, "Meetformulier") <> vbYes Then Exit Sub
    End If

    Dim oudeCalc As Long
    oudeCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fout

    WisInvoer inv
    WisGordijnen gor

    Dim ri As Long, ii As Long, gi As Long, meldingen As String, kleur As String
    ri = RUIMTE_EERSTE: ii = INV_EERSTE: gi = GORD_EERSTE

    For r = 1 To laatste
        soort = Trim$(CStr(wsI.Cells(r, 1).Value))
        Select Case soort
        Case "KLANT"
            ZetTekst inv.Range("C3"), wsI.Cells(r, 2).Value
            ZetTekst inv.Range("C4"), wsI.Cells(r, 3).Value
            ZetTekst inv.Range("C5"), wsI.Cells(r, 4).Value
            ZetTekst inv.Range("C6"), Telefoon(wsI.Cells(r, 5).Value)
            ZetTekst inv.Range("C7"), wsI.Cells(r, 6).Value
            If Trim$(CStr(wsI.Cells(r, 7).Value)) <> "" Then inv.Range("C9").Value = Getal(wsI.Cells(r, 7).Value, True)

        Case "RUIMTE"
            inv.Cells(ri, "T").Value = CStr(wsI.Cells(r, 2).Value)
            ri = ri + 1

        Case "INVOER"
            ' B ruimte | C categorie | D artikel | E kleurnr | F aantal | G breedte | H hoogte | I prijsklasse | J-L opties | M plaatsen
            If Not ArtikelBestaat(CStr(wsI.Cells(r, 3).Value), CStr(wsI.Cells(r, 4).Value)) Then
                meldingen = meldingen & vbCr & "- Regel " & ii & ": artikel '" & wsI.Cells(r, 4).Value & "' niet gevonden bij " & wsI.Cells(r, 3).Value
            End If
            inv.Cells(ii, 1).Value = CStr(wsI.Cells(r, 2).Value)
            inv.Cells(ii, 2).Value = CStr(wsI.Cells(r, 3).Value)
            inv.Cells(ii, 3).Value = CStr(wsI.Cells(r, 4).Value)
            kleur = Trim$(CStr(wsI.Cells(r, 5).Value))
            If kleur <> "" And IsNumeric(kleur) And Len(kleur) < 4 Then kleur = Right$("0000" & kleur, 4)
            If kleur <> "" Then inv.Cells(ii, 4).Value = kleur
            inv.Cells(ii, 5).Value = Getal(wsI.Cells(r, 6).Value, False)
            inv.Cells(ii, 6).Value = Getal(wsI.Cells(r, 7).Value, False)
            inv.Cells(ii, 7).Value = Getal(wsI.Cells(r, 8).Value, False)
            ZetTekst inv.Cells(ii, 8), wsI.Cells(r, 9).Value
            ZetTekst inv.Cells(ii, 9), wsI.Cells(r, 10).Value
            ZetTekst inv.Cells(ii, 10), wsI.Cells(r, 11).Value
            ZetTekst inv.Cells(ii, 11), wsI.Cells(r, 12).Value
            If Trim$(CStr(wsI.Cells(r, 13).Value)) <> "" Then inv.Cells(ii, 12).Value = CStr(wsI.Cells(r, 13).Value)
            ii = ii + 1

        Case "GORDIJN"
            ' B ruimte | C aantal | D stofcat | E stof | F kleur | G breedte | H hoogte | I stel/stuk | J plooi | K halve banen
            ' L confectie | M loodkoord | N voering | O voering kleur | P voeren | Q instomen | R rapport | S rails | T runners | U bochten | V inhangen
            If Not ArtikelBestaat(CStr(wsI.Cells(r, 4).Value), CStr(wsI.Cells(r, 5).Value)) Then
                meldingen = meldingen & vbCr & "- Gordijn " & (gi - GORD_EERSTE + 1) & ": stof '" & wsI.Cells(r, 5).Value & "' niet gevonden"
            End If
            gor.Cells(gi, "B").Value = CStr(wsI.Cells(r, 2).Value)
            gor.Cells(gi, "C").Value = Getal(wsI.Cells(r, 3).Value, False)
            gor.Cells(gi, "D").Value = CStr(wsI.Cells(r, 4).Value)
            gor.Cells(gi, "E").Value = CStr(wsI.Cells(r, 5).Value)
            ZetTekst gor.Cells(gi, "F"), wsI.Cells(r, 6).Value
            gor.Cells(gi, "H").Value = Getal(wsI.Cells(r, 7).Value, False)
            gor.Cells(gi, "I").Value = Getal(wsI.Cells(r, 8).Value, False)
            ZetTekst gor.Cells(gi, "J"), wsI.Cells(r, 9).Value
            ZetTekst gor.Cells(gi, "K"), wsI.Cells(r, 10).Value
            ZetTekst gor.Cells(gi, "M"), wsI.Cells(r, 11).Value
            ZetTekst gor.Cells(gi, "O"), wsI.Cells(r, 12).Value
            ZetTekst gor.Cells(gi, "P"), wsI.Cells(r, 13).Value
            ZetTekst gor.Cells(gi, "Q"), wsI.Cells(r, 14).Value
            ZetTekst gor.Cells(gi, "R"), wsI.Cells(r, 15).Value
            ZetTekst gor.Cells(gi, "S"), wsI.Cells(r, 16).Value
            ZetTekst gor.Cells(gi, "T"), wsI.Cells(r, 17).Value
            gor.Cells(gi, "U").Value = Getal(wsI.Cells(r, 18).Value, False)
            ZetTekst gor.Cells(gi, "V"), wsI.Cells(r, 19).Value
            ZetTekst gor.Cells(gi, "W"), wsI.Cells(r, 20).Value
            gor.Cells(gi, "Y").Value = Getal(wsI.Cells(r, 21).Value, False)
            ZetTekst gor.Cells(gi, "Z"), wsI.Cells(r, 22).Value
            gi = gi + 1
        End Select
    Next r

    wsI.Cells.ClearContents
    wsI.Range("A1").Value = "Geimporteerd op " & Format(Now, "dd-mm-yyyy hh:nn") & ". Plak hier (cel A1) de volgende meting."

    Application.Calculation = oudeCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.Calculate

    ' automatische controle: kolom Controle op Invoer (S) en Gordijnen (AJ)
    Dim ctrl As String, cv As String, nCtrl As Long
    For r = INV_EERSTE To INV_EERSTE + nInv - 1
        cv = Trim$(CStr(inv.Cells(r, 19).Text))
        If cv <> "" And UCase$(cv) <> "OK" Then
            ctrl = ctrl & vbCr & "- Invoer regel " & r & " (" & inv.Cells(r, 3).Value & "): " & cv
            nCtrl = nCtrl + 1
        End If
    Next r
    For r = GORD_EERSTE To GORD_EERSTE + nGor - 1
        cv = Trim$(CStr(gor.Cells(r, 36).Text))
        If cv <> "" And UCase$(cv) <> "OK" Then
            ctrl = ctrl & vbCr & "- Gordijn " & (r - GORD_EERSTE + 1) & " (" & gor.Cells(r, "E").Value & "): " & cv
            nCtrl = nCtrl + 1
        End If
    Next r

    inv.Activate
    inv.Range("A16").Select

    MsgBox "Meting geimporteerd:" & vbCr & _
           nInv & " productregels op Invoer" & vbCr & _
           nGor & " gordijnen op Gordijnen" & vbCr & _
           nRui & " ruimtes" & vbCr & vbCr & _
           IIf(nCtrl = 0, "Controle: alle regels OK.", "Controle: " & nCtrl & " regel(s) vragen aandacht:" & ctrl) & _
           IIf(meldingen <> "", vbCr & vbCr & "Let op:" & meldingen, ""), _
           IIf(meldingen <> "" Or nCtrl > 0, vbExclamation, vbInformation), "Meetformulier"
    Exit Sub

Fout:
    Application.Calculation = oudeCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    MsgBox "Er ging iets mis bij het importeren (regel " & r & " van tab Import):" & vbCr & Err.Description & vbCr & vbCr & _
           "Controleer Invoer en Gordijnen; draai de import eventueel opnieuw.", vbCritical, "Meetformulier"
End Sub

Private Sub WisInvoer(ByVal inv As Worksheet)
    Dim r As Long
    inv.Range("A" & INV_EERSTE & ":N" & INV_LAATSTE).ClearContents
    For r = INV_EERSTE To INV_LAATSTE
        inv.Cells(r, 12).Value = "Ja"
    Next r
    inv.Range("T" & RUIMTE_EERSTE & ":T" & RUIMTE_LAATSTE).ClearContents
End Sub

Private Sub WisGordijnen(ByVal gor As Worksheet)
    Dim r As Long
    gor.Range("B" & GORD_EERSTE & ":AA" & GORD_LAATSTE).ClearContents
    For r = GORD_EERSTE To GORD_LAATSTE
        gor.Cells(r, "C").Value = 1
        gor.Cells(r, "J").Value = "Stel"
        gor.Cells(r, "K").Value = "Enkele plooi"
        gor.Cells(r, "M").Value = "Nee"
        gor.Cells(r, "O").Value = "Automatisch"
        gor.Cells(r, "P").Value = "Nee"
        gor.Cells(r, "S").Value = "Vast"
        gor.Cells(r, "T").Value = "Nee"
        gor.Cells(r, "V").Value = "Geen"
        gor.Cells(r, "Z").Value = "Ja"
    Next r
End Sub

Private Sub ZetTekst(ByVal cel As Range, ByVal waarde As Variant)
    Dim s As String
    s = Trim$(CStr(waarde))
    If s = "" Then
        cel.ClearContents
    Else
        cel.Value = s
    End If
End Sub

Private Function Getal(ByVal waarde As Variant, ByVal tekstAlsGeenGetal As Boolean) As Variant
    Dim s As String
    s = Trim$(CStr(waarde))
    If s = "" Then
        Getal = Empty
    ElseIf IsNumeric(s) Then
        Getal = CDbl(Val(Replace(s, ",", ".")))
    ElseIf tekstAlsGeenGetal Then
        Getal = s
    Else
        Getal = Empty
    End If
End Function

Private Function LaatsteRij(ByVal ws As Worksheet) As Long
    ' laatste gevulde rij in kolom A (stopt na 50 lege rijen)
    Dim r As Long, leeg As Long
    r = 1
    Do While leeg < 50 And r < 20000
        If Trim$(CStr(ws.Cells(r, 1).Value)) = "" Then
            leeg = leeg + 1
        Else
            leeg = 0
            LaatsteRij = r
        End If
        r = r + 1
    Loop
End Function

Private Function Telefoon(ByVal waarde As Variant) As String
    ' Excel maakt van 0612345678 soms 612345678: voorloopnul terugzetten
    Dim s As String
    s = Trim$(CStr(waarde))
    If s <> "" And IsNumeric(s) And Left$(s, 1) <> "0" And Len(s) = 9 Then s = "0" & s
    Telefoon = s
End Function

Private Function ArtikelBestaat(ByVal cat As String, ByVal art As String) As Boolean
    Dim a As Worksheet, r As Long, laatste As Long
    Set a = ThisWorkbook.Worksheets("Artikelen")
    laatste = LaatsteRij(a)
    For r = 2 To laatste
        If CStr(a.Cells(r, 1).Value) = cat Then
            If CStr(a.Cells(r, 2).Value) = art Then
                ArtikelBestaat = True
                Exit Function
            End If
        End If
    Next r
End Function
