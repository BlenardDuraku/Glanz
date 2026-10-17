# VetScribe – KI-Dokumentation für Tierarztpraxen

Der Tierarzt diktiert während der Behandlung. VetScribe macht daraus:

- einen strukturierten Behandlungsbericht (SOAP)
- Diagnosen und verordnete Medikamente
- eine verständliche Info für den Tierbesitzer
- erbrachte Leistungen als Grundlage für die Abrechnung
- eine Liste fehlender oder unklarer Angaben

Status: **Prototyp (v0.1)**

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
| `server.js` | Express-Server, Endpoint `POST /api/report` |
| `lib/report.js` | Prompt, Datenschema und Aufruf von Claude |
| `public/` | Oberfläche (Aufnahme, Transkript, Bericht) |

## Bekannte Grenzen des Prototyps

- Die Spracherkennung läuft über die eingebaute Browser-Funktion (nur Chrome/Edge). Chrome schickt das Audio dafür an Google-Server. Für echte Praxisdaten muss sie durch einen EU-Spracherkennungsdienst ersetzt werden.
- Es gibt noch keine Benutzerkonten, kein Speichern und kein Bezahlen (geplant: Supabase und Stripe).
- Vor dem Einsatz mit echten Praxen braucht es Datenschutzerklärung und Auftragsverarbeitungsverträge (AVV).

## Nächste Schritte

1. Mit 5–10 Tierärzten testen und Feedback sammeln
2. EU-Spracherkennung mit Audio-Upload einbauen
3. Login und Berichtsverlauf (Supabase, EU-Region)
4. Abo mit Gratis-Test (Stripe)
