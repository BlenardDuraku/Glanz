// Builds n8n/vetscribe-workflow.json from the app's own prompt, schema and
// document logic, so the n8n version cannot drift from the web app.
// Run: npm run build:n8n
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SYSTEM_PROMPT, ReportSchema, MODEL, MAX_TRANSCRIPT_CHARS, validateInput, buildPracticeContext, buildUserMessage } from "../lib/report.js";
import { parsePriceList, DEFAULT_SETTINGS } from "../lib/settings.js";
import { DOC_TYPES } from "../lib/approvals.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(root, "n8n", "vetscribe-workflow.json");

const { $schema, ...outputSchema } = z.toJSONSchema(ReportSchema);

// n8n Code nodes cannot import modules, so format.js is inlined without its exports.
const formatSource = (await fs.readFile(path.join(root, "public", "format.js"), "utf8")).replace(/^export /gm, "");

// Pure-JS SHA-256: n8n Code nodes cannot require("crypto") unless the instance allows built-ins.
export function sha256Hex(message) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = Array.from(new TextEncoder().encode(message));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLen / 2 ** (i * 8)) & 0xff);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const W = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      W[t] = (bytes[off + 4 * t] << 24) | (bytes[off + 4 * t + 1] << 16) | (bytes[off + 4 * t + 2] << 8) | bytes[off + 4 * t + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
      const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

const exampleSettings = {
  ...DEFAULT_SETTINGS,
  praxisName: "Tierarztpraxis Muster",
  praxisAdresse: "Hauptstraße 1, 4020 Linz",
  tierarztName: "Dr. Anna Muster",
  preisliste: "AU; Allgemeinuntersuchung Hund; 35,00\n; Injektion s.c.; 12,50\nIMP; Impfung Hund (SHPPiL); 48,00",
};

// --- Code node sources ---

const prepareCode = `// ======================================================================
// PRAXIS-EINSTELLUNGEN: hier anpassen
// Preisliste: eine Leistung pro Zeile "Code; Leistung; Preis netto"
// ======================================================================
const SETTINGS = ${JSON.stringify(exampleSettings, null, 2)};

// ---- ab hier nichts ändern (erzeugt aus dem VetScribe-Code) ----
const MODEL = ${JSON.stringify(MODEL)};
const MAX_TRANSCRIPT_CHARS = ${MAX_TRANSCRIPT_CHARS};
const SYSTEM_PROMPT = ${JSON.stringify(SYSTEM_PROMPT)};
const OUTPUT_SCHEMA = ${JSON.stringify(outputSchema)};
class ReportInputError extends Error {}
${parsePriceList.toString()}
${validateInput.toString()}
${buildPracticeContext.toString()}
${buildUserMessage.toString()}

const body = $input.first().json.body || {};
let input;
try {
  input = validateInput(body);
} catch (err) {
  return [{ json: { ok: false, status: 400, body: { error: err.message } } }];
}

return [{
  json: {
    ok: true,
    settings: SETTINGS,
    prices: parsePriceList(SETTINGS.preisliste),
    request: {
      model: MODEL,
      max_tokens: 16000,
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        { type: "text", text: buildPracticeContext(SETTINGS), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: buildUserMessage(input) }],
    },
  },
}];
`;

const documentsCode = `// Baut die 7 Dokumente. Preise und Summen kommen aus der Preisliste, nicht von der KI.
${formatSource}

const response = $input.first().json;
const prep = $('Eingabe prüfen').first().json;

if (response.stop_reason === "refusal") {
  return [{ json: { status: 502, body: { error: "Die KI hat die Anfrage abgelehnt." } } }];
}
const textBlock = (response.content || []).find((b) => b.type === "text");
let report;
try {
  if (response.stop_reason === "max_tokens" || !textBlock) throw new Error("incomplete");
  report = JSON.parse(textBlock.text);
} catch {
  return [{ json: { status: 502, body: { error: "Die Unterlagen konnten nicht vollständig erstellt werden." } } }];
}

const documents = buildDocuments(report, prep.settings, prep.prices);
return [{
  json: {
    status: 200,
    body: { report, settings: prep.settings, prices: prep.prices, documents, pruefliste: report.pruefliste },
  },
}];
`;

const apiErrorCode = `// Fehler der Claude API in eine verständliche Antwort übersetzen.
const err = $input.first().json.error;
const text = typeof err === "string" ? err : JSON.stringify(err || {});
const status = Number((err && (err.httpCode || err.status)) || (text.match(/\\b(4\\d\\d|5\\d\\d)\\b/) || [])[1] || 0);
let message = "Die KI ist gerade nicht erreichbar. Bitte nochmal versuchen.";
if (status === 401) message = "API-Key fehlt oder ist ungültig (Zugangsdaten im Knoten 'Claude API' prüfen).";
if (status === 429) message = "Gerade zu viele Anfragen. Bitte gleich nochmal versuchen.";
return [{ json: { status: 502, body: { error: message } } }];
`;

const approvalCode = `// Freigabe protokollieren: wer, wann, welche Dokumente, geändert ja/nein.
// Inhalte werden nur als SHA-256-Prüfsumme gespeichert.
// Hinweis: Workflow-Static-Data wird nur bei aktivem Workflow (Produktions-URL) gespeichert.
const DOC_TYPES = ${JSON.stringify(DOC_TYPES)};
${sha256Hex.toString()}

const body = $input.first().json.body || {};
const tierarzt = typeof body.tierarzt === "string" ? body.tierarzt.trim() : "";
const docs = body.documents && typeof body.documents === "object" ? body.documents : {};
const fail = (error) => [{ json: { status: 400, body: { error } } }];
if (!tierarzt) return fail("Bitte den Namen des freigebenden Tierarztes angeben.");

const documents = [];
for (const type of DOC_TYPES) {
  const doc = docs[type];
  if (!doc) continue;
  if (typeof doc.final !== "string" || typeof doc.draft !== "string") return fail("Dokument " + type + " ist unvollständig.");
  documents.push({ type, edited: doc.final.trim() !== doc.draft.trim(), hash: sha256Hex(doc.final) });
}
if (documents.length === 0) return fail("Keine Dokumente zur Freigabe.");

const entry = {
  id: $execution.id + "-" + Date.now(),
  approvedAt: new Date().toISOString(),
  tierarzt: tierarzt.slice(0, 200),
  documents,
};
const store = $getWorkflowStaticData("global");
store.freigaben = (store.freigaben || []).concat(entry).slice(-1000);
return [{ json: { status: 200, body: { approval: entry } } }];
`;

const listCode = `// Letzte 50 Freigaben, neueste zuerst.
const store = $getWorkflowStaticData("global");
const approvals = (store.freigaben || []).slice(-50).reverse();
return [{ json: { status: 200, body: { approvals } } }];
`;

// --- Workflow assembly ---

const id = (name) => crypto.createHash("md5").update("vetscribe:" + name).digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

const respond = (name, position) => ({
  parameters: {
    respondWith: "json",
    responseBody: "={{ JSON.stringify($json.body) }}",
    options: { responseCode: "={{ $json.status }}" },
  },
  id: id(name),
  name,
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position,
});

const webhook = (name, method, webhookPath, position) => ({
  parameters: { httpMethod: method, path: webhookPath, responseMode: "responseNode", options: {} },
  id: id(name),
  name,
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position,
  webhookId: id(name + ":hook"),
});

const code = (name, jsCode, position) => ({
  parameters: { jsCode },
  id: id(name),
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
});

const note = (name, content, position, width, height) => ({
  parameters: { content, width, height },
  id: id(name),
  name,
  type: "n8n-nodes-base.stickyNote",
  typeVersion: 1,
  position,
});

const nodes = [
  note(
    "Anleitung",
    "## VetScribe – Behandlungs-Copilot\n" +
      "Ein Gespräch rein, alle Papiere raus.\n\n" +
      "**Einrichten**\n" +
      "1. Im Knoten **Eingabe prüfen** oben die Praxis-Einstellungen und Preisliste anpassen.\n" +
      "2. Im Knoten **Claude API** Zugangsdaten anlegen: *Header Auth*, Name `x-api-key`, Wert = API-Key von console.anthropic.com.\n" +
      "3. Workflow aktivieren.\n\n" +
      "**Aufrufen**\n" +
      "`POST /webhook/vetscribe/unterlagen` mit `{ \"transcript\": \"...\", \"notes\": \"\", \"species\": \"Hund\" }`\n" +
      "→ 7 Entwürfe + Prüfliste.\n\n" +
      "`POST /webhook/vetscribe/freigabe` mit `{ \"tierarzt\": \"Dr. X\", \"documents\": { \"bericht\": { \"draft\": \"...\", \"final\": \"...\" } } }`\n\n" +
      "`GET /webhook/vetscribe/freigaben` → Protokoll\n\n" +
      "**Regel:** Alles sind Entwürfe. Nichts an Halter, Versicherung oder Behörden schicken, bevor ein Tierarzt freigegeben hat.",
    [-80, -420],
    560,
    420,
  ),
  webhook("Unterlagen anfordern", "POST", "vetscribe/unterlagen", [0, 100]),
  code("Eingabe prüfen", prepareCode, [240, 100]),
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
        conditions: [
          {
            id: id("cond-ok"),
            leftValue: "={{ $json.ok }}",
            rightValue: "",
            operator: { type: "boolean", operation: "true", singleValue: true },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    id: id("Eingabe ok?"),
    name: "Eingabe ok?",
    type: "n8n-nodes-base.if",
    typeVersion: 2,
    position: [480, 100],
  },
  {
    parameters: {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "anthropic-beta", value: "server-side-fallback-2026-07-01" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ JSON.stringify($json.request) }}",
      options: { timeout: 300000 },
    },
    id: id("Claude API"),
    name: "Claude API",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [720, 0],
    onError: "continueErrorOutput",
  },
  code("7 Dokumente bauen", documentsCode, [960, -60]),
  code("API-Fehler", apiErrorCode, [960, 140]),
  respond("Antwort Unterlagen", [1200, 100]),

  webhook("Freigabe", "POST", "vetscribe/freigabe", [0, 420]),
  code("Freigabe protokollieren", approvalCode, [240, 420]),
  respond("Antwort Freigabe", [480, 420]),

  webhook("Protokoll abrufen", "GET", "vetscribe/freigaben", [0, 620]),
  code("Protokoll lesen", listCode, [240, 620]),
  respond("Antwort Protokoll", [480, 620]),
];

const link = (to) => ({ node: to, type: "main", index: 0 });
const connections = {
  "Unterlagen anfordern": { main: [[link("Eingabe prüfen")]] },
  "Eingabe prüfen": { main: [[link("Eingabe ok?")]] },
  "Eingabe ok?": { main: [[link("Claude API")], [link("Antwort Unterlagen")]] },
  "Claude API": { main: [[link("7 Dokumente bauen")], [link("API-Fehler")]] },
  "7 Dokumente bauen": { main: [[link("Antwort Unterlagen")]] },
  "API-Fehler": { main: [[link("Antwort Unterlagen")]] },
  Freigabe: { main: [[link("Freigabe protokollieren")]] },
  "Freigabe protokollieren": { main: [[link("Antwort Freigabe")]] },
  "Protokoll abrufen": { main: [[link("Protokoll lesen")]] },
  "Protokoll lesen": { main: [[link("Antwort Protokoll")]] },
};

export const workflow = {
  name: "VetScribe – Behandlungs-Copilot",
  nodes,
  connections,
  pinData: {},
  settings: { executionOrder: "v1" },
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(workflow, null, 2) + "\n");
  console.log(`geschrieben: ${path.relative(root, outFile)}`);
}
