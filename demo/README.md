# Demo-Video

`VetScribe-Demo.mp4` (ca. 85 Sekunden, 1600×900, ohne Ton) zeigt den kompletten Ablauf:
Einrichtung → Diktat → 7 Entwürfe → Bearbeiten → Freigabe → Export → Protokoll.

Die KI-Antwort im Video ist ein vorbereitetes Beispiel (Hinweis "Demo mit Beispieldaten" im Bild).
Oberfläche, Preisberechnung, Freigabe und Protokoll sind echt.

Neu aufnehmen:
```bash
npm i -D playwright && npx playwright install chromium
DATA_DIR=/tmp/vetscribe-demo PORT=3300 node server.js &
node demo/record-demo.cjs /tmp/demo-raw
ffmpeg -ss 1.1 -i /tmp/demo-raw/*.webm -c:v libx264 -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart -an demo/VetScribe-Demo.mp4
```
