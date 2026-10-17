import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parsePriceList, sanitizeSettings, createSettingsStore, SettingsError, DEFAULT_SETTINGS } from "../lib/settings.js";
import { buildApprovalEntry, createApprovalLog, ApprovalError } from "../lib/approvals.js";
import { buildPracticeContext } from "../lib/report.js";
import { resolvePositions, totals, buildDocuments } from "../public/format.js";

const PRICES = parsePriceList("AU; Allgemeinuntersuchung Hund; 35,00\n# Kommentar\n; Injektion s.c.; 12,5\nkaputt\nX; Ohne Preis; abc");

const REPORT = {
  patient: { tierart: "Hund", name: "Bello", rasse: "Labrador", alter: "7 Jahre", gewicht: "", halter: "Fr. Huber" },
  soap: { subjektiv: "Husten seit 3 Tagen.", objektiv: "T 38,9 °C.", assessment: "V.a. Zwingerhusten.", plan: "Schonung." },
  diagnosen: ["V.a. infektiöse Tracheobronchitis"],
  medikamente: [{ name: "Antitussivum", dosis: "1 Tbl.", anwendung: "2x täglich" }],
  besitzer_info: "Bello hat vermutlich Zwingerhusten.",
  leistungen: [
    { leistung: "Allgemeinuntersuchung", menge: 1, preisliste_id: "P1" },
    { leistung: "Injektion", menge: 2, preisliste_id: "P2" },
    { leistung: "Beratung Ernährung", menge: 1, preisliste_id: "" },
  ],
  kostenvoranschlag: { erforderlich: false, anlass: "", positionen: [], hinweis: "" },
  versicherung: { diagnose_klartext: "Entzündung der Atemwege", behandlung_klartext: "Untersuchung und Injektion" },
  ueberweisung: { erforderlich: false, empfaenger: "", fragestellung: "", brief: "" },
  erinnerungen: [{ anlass: "Kontrolle", wann: "in 5 Tagen" }],
  pruefliste: ["Gewicht fehlt"],
};

const SETTINGS = { ...DEFAULT_SETTINGS, praxisName: "Tierarztpraxis Test", tierarztName: "Dr. Muster", ustSatz: 20 };

test("parses price list lines and skips invalid ones", () => {
  assert.deepEqual(PRICES, [
    { id: "P1", code: "AU", leistung: "Allgemeinuntersuchung Hund", preis: 35 },
    { id: "P2", code: "", leistung: "Injektion s.c.", preis: 12.5 },
  ]);
});

test("rejects invalid settings", () => {
  assert.throws(() => sanitizeSettings({ land: "CH" }), SettingsError);
  assert.throws(() => sanitizeSettings({ ustSatz: 99 }), SettingsError);
  assert.throws(() => sanitizeSettings({ praxisName: 5 }), SettingsError);
  assert.equal(sanitizeSettings({ unknown: "x" }).unknown, undefined);
});

test("settings store returns defaults, then saved values", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vetscribe-"));
  const store = createSettingsStore(dir);
  assert.deepEqual(await store.load(), DEFAULT_SETTINGS);
  await store.save({ praxisName: "  Praxis Linz  ", ustSatz: "19", land: "DE" });
  const loaded = await store.load();
  assert.equal(loaded.praxisName, "Praxis Linz");
  assert.equal(loaded.ustSatz, 19);
  assert.equal(loaded.land, "DE");
});

test("prices come only from the price list, unknown ids stay open", () => {
  const lines = resolvePositions(REPORT.leistungen, PRICES);
  assert.equal(lines[0].summe, 35);
  assert.equal(lines[1].summe, 25);
  assert.equal(lines[2].summe, null);
  const t = totals(lines, 20);
  assert.deepEqual(t, { netto: 60, ust: 12, brutto: 72, offen: 1 });
});

test("invalid quantities count as one", () => {
  const [line] = resolvePositions([{ leistung: "x", menge: 0, preisliste_id: "P1" }], PRICES);
  assert.equal(line.menge, 1);
  assert.equal(line.summe, 35);
});

test("builds only the documents this treatment needs", () => {
  const docs = buildDocuments(REPORT, SETTINGS, PRICES, new Date("2026-10-17T10:00:00"));
  assert.deepEqual(Object.keys(docs).sort(), ["bericht", "besitzerinfo", "erinnerung", "rechnung", "versicherung"]);
  assert.match(docs.bericht, /S – Subjektiv:\nHusten seit 3 Tagen\./);
  assert.match(docs.rechnung, /Gesamt: 72,00 €/);
  assert.match(docs.rechnung, /1 Position\(en\) ohne Preis/);
  assert.match(docs.besitzerinfo, /Kontrolle: in 5 Tagen/);
  assert.match(docs.besitzerinfo, /Dr\. Muster$/);
  assert.match(docs.versicherung, /Entzündung der Atemwege/);
});

test("adds cost estimate and referral when required", () => {
  const report = {
    ...REPORT,
    kostenvoranschlag: { erforderlich: true, anlass: "Zahnsanierung", positionen: [{ leistung: "AU", menge: 1, preisliste_id: "P1" }], hinweis: "abhängig vom Befund" },
    ueberweisung: { erforderlich: true, empfaenger: "Tierklinik", fragestellung: "Röntgen Thorax", brief: "Liebe Kollegen ..." },
  };
  const docs = buildDocuments(report, SETTINGS, PRICES);
  assert.match(docs.kostenvoranschlag, /Anlass: Zahnsanierung/);
  assert.match(docs.kostenvoranschlag, /Gesamt: 42,00 €/);
  assert.match(docs.ueberweisung, /An: Tierklinik/);
});

test("practice context lists price ids but no prices", () => {
  const ctx = buildPracticeContext({ ...SETTINGS, preisliste: "AU; Allgemeinuntersuchung; 35" });
  assert.match(ctx, /P1: AU – Allgemeinuntersuchung/);
  assert.doesNotMatch(ctx, /35/);
});

test("approval entry records edits and hashes, not content", () => {
  const entry = buildApprovalEntry(
    {
      tierarzt: "Dr. Muster",
      documents: {
        bericht: { draft: "A", final: "A" },
        rechnung: { draft: "B", final: "B geändert" },
        unbekannt: { draft: "x", final: "y" },
      },
    },
    new Date("2026-10-17T10:00:00Z"),
  );
  assert.equal(entry.approvedAt, "2026-10-17T10:00:00.000Z");
  assert.deepEqual(entry.documents.map((d) => [d.type, d.edited]), [["bericht", false], ["rechnung", true]]);
  assert.equal(entry.documents[0].hash.length, 64);
  assert.doesNotMatch(JSON.stringify(entry), /B geändert/);
});

test("approval requires a name and documents", () => {
  assert.throws(() => buildApprovalEntry({ tierarzt: "", documents: { bericht: { draft: "a", final: "a" } } }), ApprovalError);
  assert.throws(() => buildApprovalEntry({ tierarzt: "Dr. X", documents: {} }), ApprovalError);
  assert.throws(() => buildApprovalEntry({ tierarzt: "Dr. X", documents: { bericht: { final: "a" } } }), ApprovalError);
});

test("approval log lists newest first", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vetscribe-"));
  const log = createApprovalLog(dir);
  assert.deepEqual(await log.list(), []);
  await log.append({ id: "1" });
  await log.append({ id: "2" });
  assert.deepEqual((await log.list()).map((e) => e.id), ["2", "1"]);
});
