import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { workflow, sha256Hex } from "../scripts/build-n8n-workflow.js";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const nodeByName = (name) => workflow.nodes.find((n) => n.name === name);

// Runs a Code node's source the way n8n does, with minimal stand-ins for n8n's globals.
function runCode(name, { input, nodes = {}, staticData = {} }) {
  const fn = new AsyncFunction("$input", "$", "$getWorkflowStaticData", "$execution", nodeByName(name).parameters.jsCode);
  const item = (json) => ({ first: () => ({ json }) });
  return fn(item(input), (n) => item(nodes[n]), () => staticData, { id: "42" });
}

const REPORT = {
  patient: { tierart: "Hund", name: "Bello", rasse: "", alter: "", gewicht: "", halter: "" },
  soap: { subjektiv: "Husten.", objektiv: "o.b.B.", assessment: "V.a. Zwingerhusten.", plan: "Schonung." },
  diagnosen: [],
  medikamente: [],
  besitzer_info: "Bitte schonen.",
  leistungen: [{ leistung: "AU", menge: 1, preisliste_id: "P1" }],
  kostenvoranschlag: { erforderlich: false, anlass: "", positionen: [], hinweis: "" },
  versicherung: { diagnose_klartext: "", behandlung_klartext: "" },
  ueberweisung: { erforderlich: false, empfaenger: "", fragestellung: "", brief: "" },
  erinnerungen: [],
  pruefliste: ["Gewicht fehlt"],
};

test("pure-JS SHA-256 matches node crypto", () => {
  for (const s of ["", "abc", "Grüße aus Linz 🐶", "x".repeat(1000)]) {
    assert.equal(sha256Hex(s), crypto.createHash("sha256").update(s).digest("hex"));
  }
});

test("committed workflow file is up to date", async () => {
  const file = JSON.parse(await fs.readFile(new URL("../n8n/vetscribe-workflow.json", import.meta.url), "utf8"));
  assert.deepEqual(file, JSON.parse(JSON.stringify(workflow)), "npm run build:n8n ausführen");
});

test("every connection points to an existing node", () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [from, { main }] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), from);
    for (const branch of main) for (const c of branch) assert.ok(names.has(c.node), c.node);
  }
});

test("prepare node rejects short transcripts", async () => {
  const [out] = await runCode("Eingabe prüfen", { input: { body: { transcript: "kurz" } } });
  assert.equal(out.json.ok, false);
  assert.equal(out.json.status, 400);
});

test("prepare node builds a Claude request with schema and practice context", async () => {
  const [out] = await runCode("Eingabe prüfen", { input: { body: { transcript: "Bello hustet seit drei Tagen.", species: "Hund" } } });
  const req = out.json.request;
  assert.equal(out.json.ok, true);
  assert.equal(req.model, "claude-opus-5-5");
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.output_config.format.schema.additionalProperties, false);
  assert.match(req.system[1].text, /P1: AU – Allgemeinuntersuchung Hund/);
  assert.match(req.messages[0].content, /Tierart laut Praxis: Hund/);
  assert.equal(out.json.prices[0].preis, 35);
});

test("documents node builds drafts from a Claude response", async () => {
  const [prep] = await runCode("Eingabe prüfen", { input: { body: { transcript: "Bello hustet seit drei Tagen." } } });
  const response = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(REPORT) }] };
  const [out] = await runCode("7 Dokumente bauen", { input: response, nodes: { "Eingabe prüfen": prep.json } });
  assert.equal(out.json.status, 200);
  assert.match(out.json.body.documents.rechnung, /Gesamt: 42,00 €/);
  assert.deepEqual(out.json.body.pruefliste, ["Gewicht fehlt"]);
});

test("documents node reports refusals and truncation", async () => {
  const [refused] = await runCode("7 Dokumente bauen", { input: { stop_reason: "refusal", content: [] }, nodes: { "Eingabe prüfen": {} } });
  assert.equal(refused.json.status, 502);
  const [cut] = await runCode("7 Dokumente bauen", { input: { stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }, nodes: { "Eingabe prüfen": {} } });
  assert.equal(cut.json.status, 502);
});

test("API error node maps status codes", async () => {
  const [auth] = await runCode("API-Fehler", { input: { error: { httpCode: "401", message: "Unauthorized" } } });
  assert.match(auth.json.body.error, /API-Key/);
  const [rate] = await runCode("API-Fehler", { input: { error: "Request failed with status code 429" } });
  assert.match(rate.json.body.error, /zu viele/);
});

test("approval and log nodes store hashes in static data", async () => {
  const staticData = {};
  const body = { tierarzt: "Dr. X", documents: { bericht: { draft: "a", final: "a b" } } };
  const [ok] = await runCode("Freigabe protokollieren", { input: { body }, staticData });
  assert.equal(ok.json.status, 200);
  assert.equal(ok.json.body.approval.documents[0].edited, true);
  assert.equal(ok.json.body.approval.documents[0].hash, crypto.createHash("sha256").update("a b").digest("hex"));
  const [list] = await runCode("Protokoll lesen", { input: {}, staticData });
  assert.equal(list.json.body.approvals.length, 1);
  const [bad] = await runCode("Freigabe protokollieren", { input: { body: { documents: {} } }, staticData });
  assert.equal(bad.json.status, 400);
});
