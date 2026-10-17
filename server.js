import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { generateReport, validateInput, ReportInputError, ReportGenerationError } from "./lib/report.js";
import { createSettingsStore, parsePriceList, SettingsError } from "./lib/settings.js";
import { createApprovalLog, buildApprovalEntry, ApprovalError } from "./lib/approvals.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, "data");
const app = express();
const client = new Anthropic();
const settingsStore = createSettingsStore(dataDir);
const approvalLog = createApprovalLog(dataDir);

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("Warnung: ANTHROPIC_API_KEY ist nicht gesetzt. Berichte können nicht erstellt werden.");
}

app.use(express.json({ limit: "500kb" }));
app.use(express.static(path.join(here, "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/settings", async (_req, res) => {
  res.json({ settings: await settingsStore.load() });
});

app.put("/api/settings", async (req, res) => {
  try {
    res.json({ settings: await settingsStore.save(req.body) });
  } catch (err) {
    if (err instanceof SettingsError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

// Transcripts are processed in memory only; nothing about the patient is stored on the server.
app.post("/api/report", async (req, res) => {
  let input;
  try {
    input = validateInput(req.body);
  } catch (err) {
    if (err instanceof ReportInputError) return res.status(400).json({ error: err.message });
    throw err;
  }

  try {
    const settings = await settingsStore.load();
    const report = await generateReport(input, settings, client);
    res.json({ report, settings, prices: parsePriceList(settings.preisliste) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic auth failed: check ANTHROPIC_API_KEY");
      return res.status(500).json({ error: "Server ist nicht richtig konfiguriert (API-Key)." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Gerade zu viele Anfragen. Bitte gleich nochmal versuchen." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error", err.status, err.message);
      return res.status(502).json({ error: "Die KI ist gerade nicht erreichbar. Bitte nochmal versuchen." });
    }
    if (err instanceof ReportGenerationError) return res.status(502).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Die Unterlagen konnten nicht erstellt werden. Ist der API-Key gesetzt?" });
  }
});

app.post("/api/approvals", async (req, res) => {
  try {
    const entry = buildApprovalEntry(req.body);
    await approvalLog.append(entry);
    res.json({ approval: entry });
  } catch (err) {
    if (err instanceof ApprovalError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.get("/api/approvals", async (_req, res) => {
  res.json({ approvals: await approvalLog.list() });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`VetScribe läuft auf http://localhost:${port}`));
