const { chromium } = require('playwright');
const OUT = process.argv[2];
const BASE = 'http://localhost:3300';
const W = 1600, H = 900;

const SETTINGS = {
  praxisName: 'Tierarztpraxis am Pöstlingberg',
  praxisAdresse: 'Hauptstraße 12, 4040 Linz',
  tierarztName: 'Dr. Anna Berger',
  land: 'AT',
  ustSatz: 20,
  tonBesitzerinfo: 'freundlich, Sie-Form, einfache Sprache',
  abkuerzungen: 'AU = Allgemeinuntersuchung\no.b.B. = ohne besonderen Befund\nV.a. = Verdacht auf',
  preisliste: 'AU; Allgemeinuntersuchung Hund; 38,00\nINJ; Injektion s.c.; 14,50\nMED; Abgabe Antitussivum (10 Tbl.); 18,90\nRX; Röntgen Thorax (je Aufnahme); 65,00\nKON; Kontrolluntersuchung; 25,00',
};

const TRANSCRIPT = 'Grüß Gott, Frau Huber. Was führt Sie mit Bello zu uns? – Er hustet seit drei Tagen, so ein trockener Husten, vor allem in der Nacht. Fressen tut er aber ganz normal. – Gut, dann schauen wir uns das an. Temperatur 38,9, Lunge etwas verschärft, Herz ohne Befund, Lymphknoten unauffällig. Er war letzte Woche in der Hundepension? – Ja, genau. – Das passt zum Zwingerhusten. Ich gebe ihm jetzt eine Injektion und Sie bekommen Hustentabletten mit, eine Tablette zweimal täglich für fünf Tage. Bitte Geschirr statt Halsband und Kontakt zu anderen Hunden meiden. Kontrolle in fünf Tagen. Wenn es nicht besser wird, machen wir ein Röntgen vom Brustkorb, zwei Aufnahmen.';

const REPORT = {
  patient: { tierart: 'Hund', name: 'Bello', rasse: 'Labrador', alter: '7 Jahre', gewicht: '', halter: 'Frau Huber' },
  soap: {
    subjektiv: 'Trockener Husten seit 3 Tagen, v. a. nachts. Futteraufnahme ungestört. Vor 1 Woche Aufenthalt in Hundepension.',
    objektiv: 'AU: T 38,9 °C. Lunge: verschärftes Atemgeräusch. Herz o.b.B. Lnn. unauffällig.',
    assessment: 'V.a. infektiöse Tracheobronchitis (Zwingerhusten).',
    plan: 'Injektion s.c.; Antitussivum p.o. 1 Tbl. 2x tgl. für 5 Tage. Geschirr statt Halsband, Kontakt zu anderen Hunden meiden. Kontrolle in 5 Tagen. Bei ausbleibender Besserung Röntgen Thorax (2 Aufnahmen).',
  },
  diagnosen: ['V.a. infektiöse Tracheobronchitis (Zwingerhusten)'],
  medikamente: [{ name: 'Antitussivum (Hustentabletten)', dosis: '1 Tablette', anwendung: '2x täglich für 5 Tage' }],
  besitzer_info: 'Bello hat sehr wahrscheinlich Zwingerhusten. Das ist eine ansteckende Entzündung der Atemwege, die er sich vermutlich in der Hundepension geholt hat. Meist heilt sie innerhalb von ein bis zwei Wochen gut ab.\n\nBitte geben Sie Bello die Hustentabletten wie unten beschrieben. Verwenden Sie ein Geschirr statt eines Halsbands und halten Sie ihn von anderen Hunden fern, bis der Husten vorbei ist.\n\nBitte melden Sie sich sofort, wenn Bello Fieber bekommt, schlecht frisst, schwer atmet oder der Husten stärker wird.',
  leistungen: [
    { leistung: 'Allgemeinuntersuchung', menge: 1, preisliste_id: 'P1' },
    { leistung: 'Injektion s.c.', menge: 1, preisliste_id: 'P2' },
    { leistung: 'Abgabe Hustentabletten', menge: 1, preisliste_id: 'P3' },
  ],
  kostenvoranschlag: { erforderlich: true, anlass: 'Röntgen Thorax bei ausbleibender Besserung', positionen: [{ leistung: 'Röntgen Thorax', menge: 2, preisliste_id: 'P4' }, { leistung: 'Kontrolluntersuchung', menge: 1, preisliste_id: 'P5' }], hinweis: 'Nur falls sich der Husten bis zur Kontrolle nicht bessert.' },
  versicherung: { diagnose_klartext: 'Verdacht auf ansteckende Entzündung der Luftröhre und Bronchien (Zwingerhusten)', behandlung_klartext: 'Klinische Allgemeinuntersuchung, Injektion, Abgabe eines Hustenmittels für 5 Tage' },
  ueberweisung: { erforderlich: false, empfaenger: '', fragestellung: '', brief: '' },
  erinnerungen: [{ anlass: 'Kontrolle Husten', wann: 'in 5 Tagen' }],
  pruefliste: ['Gewicht von Bello wurde nicht genannt', 'Genaues Präparat der Hustentabletten bitte ergänzen'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Setup: save practice settings through the real API.
  const setup = await chromium.launch();
  const sctx = await setup.newContext();
  await sctx.request.put(BASE + '/api/settings', { data: SETTINGS });
  await setup.close();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const p = await ctx.newPage();

  await p.route('**/api/report', async (route) => {
    await sleep(2800);
    const s = await (await p.request.get(BASE + '/api/settings')).json();
    const prices = s.settings.preisliste.split('\n').map((l, i) => {
      const [code, leistung, preis] = l.split(';').map((x) => x.trim());
      return { id: 'P' + (i + 1), code, leistung, preis: Number(preis.replace(',', '.')) };
    });
    route.fulfill({ json: { report: REPORT, settings: s.settings, prices } });
  });

  await p.setContent('<body style="margin:0;background:#0f3d31"></body>');
  await p.goto(BASE);
  await p.waitForLoadState('networkidle');

  // Overlay elements: title cards, captions, cursor, demo badge.
  await p.addStyleTag({ content: `
    #ov-card { position: fixed; inset: 0; z-index: 10001; display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #0f3d31; color: #fff; font-family: Inter, system-ui, sans-serif; text-align: center; transition: opacity .6s; }
    #ov-card h1 { font-size: 72px; margin: 0 0 12px; letter-spacing: -1px; }
    #ov-card p { font-size: 30px; margin: 6px 0; opacity: .92; max-width: 1100px; }
    #ov-card .small { font-size: 22px; opacity: .7; margin-top: 28px; }
    #ov-cap { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%); z-index: 9998; max-width: 1200px;
      background: rgba(15, 30, 25, .92); color: #fff; font: 600 26px/1.35 Inter, system-ui, sans-serif; padding: 16px 28px;
      border-radius: 14px; text-align: center; pointer-events: none; box-shadow: 0 8px 30px rgba(0,0,0,.25); transition: opacity .35s; opacity: 0; }
    #ov-cur { position: fixed; z-index: 10000; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
      background: rgba(198, 47, 58, .35); border: 3px solid #c62f3a; pointer-events: none;
      transition: left .7s cubic-bezier(.4,0,.2,1), top .7s cubic-bezier(.4,0,.2,1), transform .15s; left: 800px; top: 450px; }
    #ov-cur.down { transform: scale(.7); }
    body { padding-bottom: 150px; }
    #ov-badge { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 9997; font: 500 13px Inter, sans-serif;
      color: #5d6b65; background: #fff6e0; border: 1px solid #e9c46a; padding: 3px 10px; border-radius: 999px; }
  `});
  await p.evaluate(() => {
    for (const [id, tag] of [['ov-card', 'div'], ['ov-cap', 'div'], ['ov-cur', 'div'], ['ov-badge', 'div']]) {
      const n = document.createElement(tag); n.id = id; document.body.append(n);
    }
    document.getElementById('ov-badge').textContent = 'Demo mit Beispieldaten';
  });

  const card = (html) => p.evaluate((h) => { const c = document.getElementById('ov-card'); c.innerHTML = h; c.style.opacity = 1; c.style.display = 'flex'; }, html);
  const hideCard = async () => { await p.evaluate(() => { document.getElementById('ov-card').style.opacity = 0; }); await sleep(650); await p.evaluate(() => { document.getElementById('ov-card').style.display = 'none'; }); };
  const caption = async (text, ms = 0) => { await p.evaluate((t) => { const c = document.getElementById('ov-cap'); c.textContent = t; c.style.opacity = t ? 1 : 0; }, text); if (ms) await sleep(ms); };
  const moveTo = async (selector) => {
    const box = await p.locator(selector).first().boundingBox();
    await p.evaluate(({ x, y }) => { const c = document.getElementById('ov-cur'); c.style.left = x + 'px'; c.style.top = y + 'px'; }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await sleep(800);
  };
  const click = async (selector) => {
    await p.locator(selector).first().scrollIntoViewIfNeeded();
    await moveTo(selector);
    await p.evaluate(() => document.getElementById('ov-cur').classList.add('down'));
    await sleep(150);
    await p.locator(selector).first().click();
    await p.evaluate(() => document.getElementById('ov-cur').classList.remove('down'));
    await sleep(350);
  };
  const scrollTo = (y) => p.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y).then(() => sleep(900));

  // 1. Intro
  await card('<h1>VetScribe</h1><p>Ein Gespräch rein, alle Papiere raus.</p><p class="small">KI-Dokumentation für Tierarztpraxen</p>');
  await sleep(3500);
  await hideCard();

  // 2. Settings
  await caption('Einmal einrichten: Praxisdaten, Abkürzungen und Ihre Preisliste', 1200);
  await click('#settingsBtn');
  // The modal sits in the browser's top layer; move caption and cursor into it while open.
  await p.evaluate(() => { const d = document.getElementById('settingsDialog'); d.append(document.getElementById('ov-cap'), document.getElementById('ov-cur')); });
  await sleep(3400);
  await click('#settingsForm button[value=cancel]');
  await p.evaluate(() => document.body.append(document.getElementById('ov-cap'), document.getElementById('ov-cur')));

  // 3. Dictation
  await caption('Behandeln Sie wie immer. VetScribe hört zu und schreibt mit.');
  await moveTo('#recBtn');
  await p.evaluate(() => { const b = document.getElementById('recBtn'); b.classList.add('on'); b.textContent = '■ Aufnahme stoppen'; document.getElementById('recStatus').textContent = 'Hört zu …'; });
  const words = TRANSCRIPT.split(' ');
  for (let i = 0; i < words.length; i += 3) {
    await p.evaluate((t) => { const ta = document.getElementById('transcript'); ta.value = t; ta.scrollTop = ta.scrollHeight; }, words.slice(0, i + 3).join(' '));
    await sleep(170);
  }
  await sleep(600);
  await p.evaluate(() => { const b = document.getElementById('recBtn'); b.classList.remove('on'); b.textContent = '● Aufnahme starten'; document.getElementById('recStatus').textContent = ''; });

  // 4. Generate
  await caption('Ein Klick nach der Behandlung …');
  await click('#genBtn');
  await sleep(2900);
  await caption('… und alle Unterlagen liegen als Entwürfe bereit.', 2500);

  // 5. Checklist + tabs
  await moveTo('#checkBlock');
  await caption('Was fehlt oder unklar ist, markiert VetScribe zum Prüfen.', 3200);
  await caption('Behandlungsbericht für die Akte, in Ihrer Fachsprache', 0);
  await moveTo('#docText');
  await sleep(2800);

  const tab = (label) => `.tab:has-text("${label}")`;
  await caption('Besitzerinfo in einfacher Sprache, zum Mitgeben oder Mailen');
  await click(tab('Besitzerinfo'));
  await sleep(3200);
  await caption('Rechnungsentwurf: Preise kommen aus Ihrer Preisliste, nicht von der KI');
  await click(tab('Rechnungsentwurf'));
  await sleep(3600);
  await caption('Kostenvoranschlag, wenn eine weitere Behandlung besprochen wurde');
  await click(tab('Kostenvoranschlag'));
  await sleep(3200);
  await caption('Versicherungspaket: der Halter kann sofort bei der Tierversicherung einreichen');
  await click(tab('Versicherungspaket'));
  await sleep(3400);
  await caption('Überweisung nur, wenn sie gebraucht wird. Dazu Erinnerungen für Kontrollen.');
  await click(tab('Erinnerungen'));
  await sleep(2600);

  // 6. Edit
  await caption('Alles lässt sich bearbeiten.');
  await click(tab('Besitzerinfo'));
  await p.locator('#docText').click();
  await p.keyboard.press('Control+End');
  await p.keyboard.type('\nGute Besserung, Bello!', { delay: 55 });
  await sleep(1000);

  // 7. Approve
  await caption('Nichts verlässt die Praxis ohne Ihre Freigabe.');
  await scrollTo(10000);
  await click('#reviewed');
  await click('#approveBtn');
  await sleep(1800);
  await caption('Erst jetzt: kopieren in die Praxissoftware, drucken oder per E-Mail senden.');
  await click('[data-action=copy]');
  await sleep(2200);

  // 8. Protocol
  await caption('Jede Freigabe wird protokolliert: wer, wann, was geändert wurde.');
  await click('#logBtn');
  await p.evaluate(() => { const d = document.getElementById('logDialog'); d.append(document.getElementById('ov-cap'), document.getElementById('ov-cur')); });
  await sleep(3500);
  await click('#closeLog');
  await p.evaluate(() => document.body.append(document.getElementById('ov-cap'), document.getElementById('ov-cur')));
  await caption('');
  await scrollTo(0);

  // 9. Outro
  await card('<h1>Am Abend nichts mehr nachschreiben.</h1><p>Bericht · Besitzerinfo · Rechnung · Kostenvoranschlag<br>Versicherung · Überweisung · Erinnerungen</p><p class="small">Freigabe durch den Tierarzt · arbeitet neben Ihrer bestehenden Praxissoftware</p><p style="font-size:34px;margin-top:36px;font-weight:600">Jetzt Pilot-Praxis werden</p>');
  await sleep(5000);

  await ctx.close();
  await browser.close();
})();
