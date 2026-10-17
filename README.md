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
| `scripts/build-n8n-workflow.js` | Erzeugt `n8n/vetscribe-workflow.json` |

Preisliste in den Praxis-Einstellungen, eine Zeile pro Leistung: `Code; Leistung; Preis netto`, z. B. `AU; Allgemeinuntersuchung Hund; 35,00`.

## n8n-Version

`n8n/vetscribe-workflow.json` enthält denselben Ablauf als n8n-Workflow (gleicher Prompt, gleiches Datenschema, gleiche Dokument-Logik). Die Datei wird aus dem App-Code erzeugt: nach Änderungen `npm run build:n8n` ausführen; ein Test prüft, dass sie aktuell ist.

**Einrichten in n8n:**
1. Workflows → Import from File → `vetscribe-workflow.json`.
2. Knoten **Eingabe prüfen** öffnen und oben Praxisname, Adresse, Tierärzt:in, Land, USt-Satz und Preisliste anpassen.
3. Knoten **Claude API** öffnen → Credential anlegen: *Header Auth*, Name `x-api-key`, Wert = API-Key von console.anthropic.com.
4. Workflow aktivieren.

**Endpunkte:**

| Methode | Pfad | Body | Antwort |
|---|---|---|---|
| POST | `/webhook/vetscribe/unterlagen` | `{ "transcript": "...", "notes": "", "species": "Hund" }` | `report`, `documents` (7 Entwürfe), `pruefliste` |
| POST | `/webhook/vetscribe/freigabe` | `{ "tierarzt": "Dr. X", "documents": { "bericht": { "draft": "...", "final": "..." } } }` | Protokolleintrag |
| GET | `/webhook/vetscribe/freigaben` | – | letzte 50 Freigaben |

Beispiel:
```bash
curl -X POST https://DEIN-N8N/webhook/vetscribe/unterlagen \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Bello, Labrador, 7 Jahre, hustet seit drei Tagen ..."}'
```

Hinweise: Das Freigabe-Protokoll liegt in den Workflow-Static-Data und wird nur bei aktivem Workflow (Produktions-URL) gespeichert, nicht bei Testläufen. Für echten Betrieb besser in eine Datenbank oder ein Sheet schreiben. Die Ergebnisse von `/unterlagen` können in n8n weiterverarbeitet werden (z. B. E-Mail an Halter), aber nur nach Freigabe durch den Tierarzt.

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
