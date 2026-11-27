Attribute VB_Name = "MeetKoppeling"
Option Explicit

' =====================================================================
'  Edison Meetformulier - rechtstreekse koppeling met de Google Sheet
'
'  HaalMeting       meting kiezen en meteen importeren (geen plakken meer)
'  StuurCatalogus   tabs Artikelen/Opties/Kleuren/Lijsten naar de Sheet
'                   sturen; de app haalt de nieuwe prijslijst vanzelf op
'  KoppelingInstellen  web-app-URL en sleutel invullen (eenmalig per Mac)
'
'  Nodig: module MeetImport en het hulpscript EdisonMeet.applescript in
'  ~/Library/Application Scripts/com.microsoft.Excel/
'  URL en sleutel staan in de Excel-instellingen van deze Mac, niet in het
'  bestand. Ze komen dus nooit in de collega-versie of in een offerte.
' =====================================================================

Private Const HULPSCRIPT As String = "EdisonMeet.applescript"
Private Const INST_APP As String = "EdisonMeetformulier"
Private Const MAX_IN_LIJST As Long = 12

' ---------- instellen ----------
Public Sub KoppelingInstellen()
    Dim u As String, k As String, antw As String
    u = InputBox("Web-app-URL van je Apps Script (eindigt op /exec):", "Meetformulier - koppeling", _
                 GetSetting(INST_APP, "Koppeling", "URL", ""))
    If Trim$(u) = "" Then Exit Sub
    k = InputBox("Sleutel (dezelfde als in de app):", "Meetformulier - koppeling", _
                 GetSetting(INST_APP, "Koppeling", "Sleutel", ""))
    If Trim$(k) = "" Then Exit Sub
    SaveSetting INST_APP, "Koppeling", "URL", Trim$(u)
    SaveSetting INST_APP, "Koppeling", "Sleutel", Trim$(k)
    antw = Vraag("test", "", "")
    If IsOK(antw) Then
        MsgBox "Koppeling werkt: " & Info(antw), vbInformation, "Meetformulier"
    End If
End Sub

' ---------- meting ophalen ----------
Public Sub HaalMeting()
    Dim antw As String, regels() As String, i As Long, n As Long
    Application.StatusBar = "Metingen ophalen uit de Google Sheet..."
    antw = Vraag("lijst", "", "")
    Application.StatusBar = False
    If Not IsOK(antw) Then Exit Sub

    regels = Split(antw, vbLf)
    Dim ids() As String, tekst() As String, zoek() As String, d() As String
    ReDim ids(1 To UBound(regels) + 1): ReDim tekst(1 To UBound(regels) + 1): ReDim zoek(1 To UBound(regels) + 1)
    For i = 1 To UBound(regels)
        If Trim$(regels(i)) <> "" Then
            d = Split(regels(i) & vbTab & vbTab & vbTab & vbTab, vbTab)
            n = n + 1
            ids(n) = d(0)
            tekst(n) = DatumNL(d(3)) & "  " & d(1) & IIf(d(2) <> "", "  (offerte " & d(2) & ")", "")
            zoek(n) = d(1) & " " & d(2) & " " & d(4)
        End If
    Next i
    If n = 0 Then
        MsgBox "Er staan nog geen metingen in de Sheet die klaar zijn voor Excel." & vbCr & vbCr & _
               "Open de app even op je telefoon of laptop, zodat alles opnieuw wordt verstuurd.", vbExclamation, "Meetformulier"
        Exit Sub
    End If

    ' kiezen: nummer uit de lijst, of een stukje naam, adres of offertenummer
    Dim keus As String, gekozen As Long, toon() As Long, nToon As Long, prompt As String, j As Long
    ReDim toon(1 To n)
    For i = 1 To n: toon(i) = i: Next i
    nToon = n
    Do
        prompt = IIf(nToon = n, "Laatste metingen:", nToon & " gevonden:") & vbCr
        For j = 1 To IIf(nToon < MAX_IN_LIJST, nToon, MAX_IN_LIJST)
            prompt = prompt & j & ".  " & Left$(tekst(toon(j)), 60) & vbCr
        Next j
        If nToon > MAX_IN_LIJST Then prompt = prompt & "(en " & (nToon - MAX_IN_LIJST) & " oudere)" & vbCr
        prompt = prompt & vbCr & "Typ het nummer, of een stukje van de naam, het adres of het offertenummer:"
        keus = Trim$(InputBox(Left$(prompt, 1000), "Meting ophalen", "1"))
        If keus = "" Then Exit Sub

        If IsNumeric(keus) And Len(keus) <= 2 Then
            If CLng(keus) >= 1 And CLng(keus) <= nToon And CLng(keus) <= MAX_IN_LIJST Then
                gekozen = toon(CLng(keus))
                Exit Do
            End If
        End If
        Dim nieuw() As Long, nNieuw As Long
        ReDim nieuw(1 To n): nNieuw = 0
        For i = 1 To n
            If InStr(1, zoek(i), keus, vbTextCompare) > 0 Then nNieuw = nNieuw + 1: nieuw(nNieuw) = i
        Next i
        If nNieuw = 1 Then
            gekozen = nieuw(1)
            Exit Do
        ElseIf nNieuw = 0 Then
            MsgBox "Niets gevonden voor '" & keus & "'.", vbExclamation, "Meetformulier"
        Else
            For i = 1 To nNieuw: toon(i) = nieuw(i): Next i
            nToon = nNieuw
        End If
    Loop

    ' meting ophalen en in tab Import zetten
    Application.StatusBar = "Meting ophalen: " & tekst(gekozen)
    antw = Vraag("meting", "&id=" & UrlCode(ids(gekozen)), "")
    Application.StatusBar = False
    If Not IsOK(antw) Then Exit Sub

    regels = Split(Mid$(antw, InStr(antw, vbLf) + 1), vbLf)
    Dim nR As Long, nK As Long, cel() As String, vak() As String
    nR = UBound(regels) + 1
    For i = 0 To nR - 1
        cel = Split(regels(i), vbTab)
        If UBound(cel) + 1 > nK Then nK = UBound(cel) + 1
    Next i
    If nR < 2 Or nK < 1 Then
        MsgBox "De meting is leeg.", vbExclamation, "Meetformulier"
        Exit Sub
    End If
    ReDim vak(1 To nR, 1 To nK)
    For i = 0 To nR - 1
        cel = Split(regels(i), vbTab)
        For j = 0 To UBound(cel)
            vak(i + 1, j + 1) = cel(j)
        Next j
    Next i

    Dim ws As Worksheet
    Set ws = ImportTab()
    ws.Cells.ClearContents
    ws.Cells.NumberFormat = "@"
    ws.Range("A1").Resize(nR, nK).Value = vak

    ImporteerMeting
End Sub

' ---------- prijslijst naar de app ----------
Public Sub StuurCatalogus()
    Dim tabs As Variant, t As Variant, ws As Worksheet, antw As String, pad As String, verslag As String
    tabs = Array("Artikelen", "Opties", "Kleuren", "Lijsten")
    If MsgBox("De tabs Artikelen, Opties, Kleuren en Lijsten uit dit bestand naar de Google Sheet van de app sturen?" & vbCr & vbCr & _
              "De app haalt de nieuwe prijslijst daarna vanzelf op, op al je toestellen.", vbOKCancel + vbQuestion, "Meetformulier") <> vbOK Then Exit Sub

    pad = Environ("HOME") & "/edison-catalogus.txt"
    For Each t In tabs
        Set ws = Nothing
        On Error Resume Next
        Set ws = ThisWorkbook.Worksheets(CStr(t))
        On Error GoTo 0
        If ws Is Nothing Then
            If CStr(t) <> "Lijsten" Then
                MsgBox "Tab " & t & " niet gevonden in dit bestand. Er is niets verstuurd.", vbCritical, "Meetformulier"
                Exit Sub
            End If
        Else
            Application.StatusBar = "Tab " & t & " versturen..."
            If Not SchrijfTab(ws, pad) Then
                Application.StatusBar = False
                MsgBox "Tab " & t & " is leeg. Er is niets verstuurd.", vbCritical, "Meetformulier"
                Exit Sub
            End If
            antw = Vraag("tab", "&tab=" & UrlCode(CStr(t)), pad)
            If Not IsOK(antw) Then Application.StatusBar = False: Exit Sub
            verslag = verslag & vbCr & "- " & t & ": " & Info(antw)
        End If
    Next t

    Application.StatusBar = "Catalogus controleren..."
    antw = Vraag("catalogus_klaar", "", "")
    Application.StatusBar = False
    On Error Resume Next
    Kill pad
    On Error GoTo 0
    If Not IsOK(antw) Then Exit Sub
    MsgBox "Prijslijst verstuurd:" & verslag & vbCr & vbCr & "De app heeft nu " & Info(antw) & "." & vbCr & _
           "Toestellen halen hem op zodra de app opent of binnen een minuut.", vbInformation, "Meetformulier"
End Sub

' ---------- hulpjes ----------
Private Function Vraag(ByVal actie As String, ByVal extra As String, ByVal bestand As String) As String
    Dim u As String, k As String
    u = GetSetting(INST_APP, "Koppeling", "URL", "")
    k = GetSetting(INST_APP, "Koppeling", "Sleutel", "")
    If u = "" Or k = "" Then
        If actie <> "test" Then
            KoppelingInstellen
            u = GetSetting(INST_APP, "Koppeling", "URL", "")
            k = GetSetting(INST_APP, "Koppeling", "Sleutel", "")
        End If
        If u = "" Or k = "" Then Vraag = "FOUT" & vbTab & "Koppeling niet ingesteld (macro KoppelingInstellen).": Exit Function
    End If
    Dim adres As String, antw As String
    adres = u & IIf(InStr(u, "?") > 0, "&", "?") & "excel=" & actie & "&key=" & UrlCode(k) & extra
    On Error GoTo GeenHulpscript
    antw = AppleScriptTask(HULPSCRIPT, "haal", adres & vbLf & bestand)
    On Error GoTo 0
    antw = Replace(Replace(antw, vbCrLf, vbLf), vbCr, vbLf)
    Vraag = antw
    Exit Function
GeenHulpscript:
    Vraag = "FOUT" & vbTab & "Het hulpscript " & HULPSCRIPT & " is niet gevonden. Zet het in de map " & _
            "~/Library/Application Scripts/com.microsoft.Excel/ (zie STAPPENPLAN-AUTOMATISCH)."
End Function

' toont zelf de foutmelding als het antwoord niet OK is
Private Function IsOK(ByVal antw As String) As Boolean
    Dim eerste As String
    eerste = antw
    If InStr(eerste, vbLf) > 0 Then eerste = Left$(eerste, InStr(eerste, vbLf) - 1)
    If eerste = "OK" Or Left$(eerste, 3) = "OK" & vbTab Then
        IsOK = True
    ElseIf Left$(eerste, 5) = "FOUT" & vbTab Then
        MsgBox Mid$(eerste, 6), vbCritical, "Meetformulier"
    Else
        MsgBox "Onverwacht antwoord van de Google Sheet. Klopt de web-app-URL (macro KoppelingInstellen)?" & vbCr & vbCr & _
               Left$(antw, 300), vbCritical, "Meetformulier"
    End If
End Function

' tekst na "OK<tab>" op de eerste regel
Private Function Info(ByVal antw As String) As String
    Dim eerste As String
    eerste = antw
    If InStr(eerste, vbLf) > 0 Then eerste = Left$(eerste, InStr(eerste, vbLf) - 1)
    If InStr(eerste, vbTab) > 0 Then Info = Mid$(eerste, InStr(eerste, vbTab) + 1)
End Function

Private Function ImportTab() As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("Import")
    On Error GoTo 0
    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        ws.Name = "Import"
    End If
    Set ImportTab = ws
End Function

' schrijft een tab als tekst (tabs tussen de kolommen) naar een bestand.
' Alleen ASCII: andere tekens als %XX (UTF-8), zodat er niets verminkt wordt.
Private Function SchrijfTab(ByVal ws As Worksheet, ByVal pad As String) As Boolean
    Dim lr As Long, lc As Long, c As Range
    Set c = ws.Cells.Find(What:="*", LookIn:=xlFormulas, SearchOrder:=xlByRows, SearchDirection:=xlPrevious)
    If c Is Nothing Then Exit Function
    lr = c.Row
    Set c = ws.Cells.Find(What:="*", LookIn:=xlFormulas, SearchOrder:=xlByColumns, SearchDirection:=xlPrevious)
    lc = c.Column
    If lr < 2 Then Exit Function

    Dim v As Variant, fmt() As Variant, r As Long, k As Long
    v = ws.Range(ws.Cells(1, 1), ws.Cells(lr, lc)).Value2
    ReDim fmt(1 To lc)
    For k = 1 To lc
        fmt(k) = ws.Range(ws.Cells(2, k), ws.Cells(lr, k)).NumberFormat ' Null als de kolom gemengd is
    Next k

    Dim regels() As String, delen() As String
    ReDim regels(1 To lr): ReDim delen(1 To lc)
    For r = 1 To lr
        For k = 1 To lc
            delen(k) = Veilig(CelTekst(v(r, k), fmt(k), ws.Cells(r, k), r))
        Next k
        regels(r) = Join(delen, vbTab)
    Next r

    Dim f As Integer
    f = FreeFile
    Open pad For Output As #f
    Print #f, Join(regels, vbLf);
    Close #f
    SchrijfTab = True
End Function

Private Function CelTekst(ByVal x As Variant, ByVal kolFmt As Variant, ByVal cel As Range, ByVal r As Long) As String
    Dim f As String, s As String
    Select Case VarType(x)
    Case vbEmpty, vbError, vbNull
        s = ""
    Case vbString
        s = x
    Case vbBoolean
        s = IIf(x, "TRUE", "FALSE")
    Case Else
        ' getal: opmaak als 0000 (kleurnummers) aanhouden, anders met punt als decimaalteken
        If r = 1 Or IsNull(kolFmt) Then f = cel.NumberFormat Else f = CStr(kolFmt)
        If f <> "" And Replace(f, "0", "") = "" Then
            s = Format$(x, f)
        Else
            s = Trim$(Str$(x))
        End If
    End Select
    CelTekst = Replace(Replace(Replace(s, vbTab, " "), vbLf, " "), vbCr, " ")
End Function

Private Function Veilig(ByVal s As String) As String
    Dim i As Long, c As Long, nodig As Boolean, delen() As String
    For i = 1 To Len(s)
        c = AscW(Mid$(s, i, 1)): If c < 0 Then c = c + 65536
        If c > 126 Or c = 37 Then nodig = True: Exit For
    Next i
    If Not nodig Then Veilig = s: Exit Function
    ReDim delen(1 To Len(s))
    For i = 1 To Len(s)
        c = AscW(Mid$(s, i, 1)): If c < 0 Then c = c + 65536
        If c = 37 Then
            delen(i) = "%25"
        ElseIf c < 127 Then
            delen(i) = Mid$(s, i, 1)
        ElseIf c < 2048 Then
            delen(i) = Hx(192 Or (c \ 64)) & Hx(128 Or (c And 63))
        ElseIf c >= 55296 And c <= 57343 Then
            delen(i) = "?" ' emoji e.d. horen niet in een prijslijst
        Else
            delen(i) = Hx(224 Or (c \ 4096)) & Hx(128 Or ((c \ 64) And 63)) & Hx(128 Or (c And 63))
        End If
    Next i
    Veilig = Join(delen, "")
End Function

Private Function Hx(ByVal b As Long) As String
    Hx = "%" & Right$("0" & Hex$(b), 2)
End Function

Private Function UrlCode(ByVal s As String) As String
    Dim i As Long, ch As String, c As Long, uit As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        c = AscW(ch): If c < 0 Then c = c + 65536
        If ch Like "[A-Za-z0-9._~-]" Then
            uit = uit & ch
        ElseIf c < 128 Then
            uit = uit & Hx(c)
        Else
            uit = uit & Veilig(ch)
        End If
    Next i
    UrlCode = uit
End Function

Private Function DatumNL(ByVal d As String) As String
    ' 2026-11-26 -> 26-11-2026
    If Len(d) = 10 And Mid$(d, 5, 1) = "-" Then DatumNL = Mid$(d, 9, 2) & "-" & Mid$(d, 6, 2) & "-" & Left$(d, 4) Else DatumNL = d
End Function
