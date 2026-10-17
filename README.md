# VetScribe – KI-Dokumentation für Tierarztpraxen

**Ein Gespräch rein, alle Papiere raus.** Der Tierarzt behandelt und redet wie immer. VetScribe erstellt daraus alle Unterlagen als Entwürfe:

1. Behandlungsbericht (SOAP)
2. Besitzerinfo
3. Rechnungsentwurf (Preise aus der Preisliste der Praxis)
4. Kostenvoranschlag (nur wenn weitere Behandlung besprochen wurde)
5. Versicherungspaket für die Tierkrankenversicherung
6. Überweisungsbrief (nur bei Überweisung)
7. Erinnerungen (Kontrolle, Impfung)

Dazu eine "Bitte prüfen"-Liste. Der Tierarzt prüft, bearbeitet und gibt frei. Erst danach können Dokumente kopiert, gedruckt (PDF) oder per E-Mail versendet werden. Jede Freigabe landet im Freigabe-Protokoll (wer, wann, welches Dokument, geändert ja/nein; Inhalte nur als Prüfsumme).

Grundregeln: Die KI erfindet keine Befunde, Dosierungen oder Preise. Preise und Summen rechnet der Code aus der Preisliste, nicht die KI. Patientendaten werden auf dem Server nicht gespeichert.

Status: **Version 1 (Prototyp)**. Bauplan: `council/tierarzt-workflow/WORKFLOW-BAUPLAN.md` im Repo `rein`.

## Starten

Voraussetzung: Node.js 20 oder neuer und ein API-Key von https://console.anthropic.com

```bash
npm install
cp .env.example .env              # API-Key eintragen
node --env-file=.env server.js
```

Dann im Browser (Chrome oder Edge) http://localhost:3000 öffnen.

Tests: `npm test`

## Aufbau

| Datei | Inhalt |
|---|---|
| `server.js` | Express-Server: `/api/report`, `/api/settings`, `/api/approvals` |
| `lib/report.js` | Prompt, Datenschema und Aufruf von Claude |
| `lib/settings.js` | Praxis-Einstellungen und Preisliste (gespeichert in `data/`) |
| `lib/approvals.js` | Freigabe-Protokoll (`data/freigaben.jsonl`) |
| `public/format.js` | Baut die 7 Dokumente, rechnet Preise und Summen |
| `public/` | Oberfläche |

Preisliste in den Praxis-Einstellungen, eine Zeile pro Leistung: `Code; Leistung; Preis netto`, z. B. `AU; Allgemeinuntersuchung Hund; 35,00`.

## Bekannte Grenzen des Prototyps

- Die Spracherkennung läuft über die eingebaute Browser-Funktion (nur Chrome/Edge). Chrome schickt das Audio dafür an Google-Server. Für echte Praxisdaten muss sie durch einen EU-Spracherkennungsdienst ersetzt werden.
- Es gibt noch keine Benutzerkonten und kein Bezahlen (geplant: Supabase und Stripe). Einstellungen und Protokoll liegen als Dateien in `data/`, für eine Praxis pro Installation.
- Keine direkte Übergabe an die Praxissoftware; Übernahme per Kopieren, PDF oder E-Mail.
- Vor dem Einsatz mit echten Praxen braucht es Datenschutzerklärung und Auftragsverarbeitungsverträge (AVV).

## Nächste Schritte

1. Pilot mit 3 Kleintierpraxen, Zeitmessung bei Tierarzt und Empfang
2. EU-Spracherkennung mit Löschung des Audios nach Verarbeitung
3. Login, mehrere Praxen, Speicherung (Supabase, EU-Region)
4. Abo mit Gratis-Test (Stripe)
5. Version 2: Empfang entlasten, Schnittstelle zu einer Praxissoftware
