import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { generateReport, validateInput, ReportInputError, ReportGenerationError } from "./lib/report.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const client = new Anthropic();

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.warn("Warnung: ANTHROPIC_API_KEY ist nicht gesetzt. Berichte können nicht erstellt werden.");
}

app.use(express.json({ limit: "200kb" }));
app.use(express.static(path.join(here, "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Transcripts are processed in memory only; nothing is stored on the server.
app.post("/api/report", async (req, res) => {
  let input;
  try {
    input = validateInput(req.body);
  } catch (err) {
    if (err instanceof ReportInputError) return res.status(400).json({ error: err.message });
    throw err;
  }

  try {
    const report = await generateReport(input, client);
    res.json({ report });
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
    res.status(500).json({ error: "Der Bericht konnte nicht erstellt werden. Ist der API-Key gesetzt?" });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`VetScribe läuft auf http://localhost:${port}`));
