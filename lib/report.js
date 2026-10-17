import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { parsePriceList } from "./settings.js";

export const MODEL = "claude-opus-5-5";
export const MAX_TRANSCRIPT_CHARS = 60_000;

const Position = z.object({
  leistung: z.string(),
  menge: z.number(),
  // Id from the practice price list ("P1", "P2", ...), or "" if no entry matches.
  preisliste_id: z.string(),
});

export const ReportSchema = z.object({
  patient: z.object({
    tierart: z.string(),
    name: z.string(),
    rasse: z.string(),
    alter: z.string(),
    gewicht: z.string(),
    halter: z.string(),
  }),
  soap: z.object({
    subjektiv: z.string(),
    objektiv: z.string(),
    assessment: z.string(),
    plan: z.string(),
  }),
  diagnosen: z.array(z.string()),
  medikamente: z.array(
    z.object({
      name: z.string(),
      dosis: z.string(),
      anwendung: z.string(),
    }),
  ),
  besitzer_info: z.string(),
  leistungen: z.array(Position),
  kostenvoranschlag: z.object({
    erforderlich: z.boolean(),
    anlass: z.string(),
    positionen: z.array(Position),
    hinweis: z.string(),
  }),
  versicherung: z.object({
    diagnose_klartext: z.string(),
    behandlung_klartext: z.string(),
  }),
  ueberweisung: z.object({
    erforderlich: z.boolean(),
    empfaenger: z.string(),
    fragestellung: z.string(),
    brief: z.string(),
  }),
  erinnerungen: z.array(
    z.object({
      anlass: z.string(),
      wann: z.string(),
    }),
  ),
  pruefliste: z.array(z.string()),
});

export const SYSTEM_PROMPT = `Du bist der Dokumentationsassistent einer Tierarztpraxis im deutschsprachigen Raum.
Du erhältst das Transkript eines Behandlungsgesprächs (oft mit Dialekt, Füllwörtern und Erkennungsfehlern), optionale Notizen des Tierarztes, die Einstellungen der Praxis und deren Preisliste.

Erstelle daraus alle Unterlagen, die nach der Behandlung anfallen. Alles ist ein Entwurf, den der Tierarzt prüft.

- patient: Stammdaten aus dem Gespräch; halter = Name des Tierhalters, falls genannt.
- soap: Behandlungsbericht für die Akte. Subjektiv (Vorbericht laut Halter), Objektiv (Befunde, Messwerte), Assessment (Einschätzung, Verdachts- und Differenzialdiagnosen), Plan (Therapie, Diagnostik, Empfehlungen). Fachsprachlich und knapp. Verwende die Abkürzungen der Praxis.
- diagnosen: gestellte oder Verdachtsdiagnosen ("V.a. ...").
- medikamente: nur was tatsächlich verordnet, abgegeben oder verabreicht wurde, mit Dosis und Anwendung wie genannt.
- besitzer_info: Zusammenfassung für den Tierhalter im gewünschten Ton der Praxis: was festgestellt wurde, was zu Hause zu tun ist (Medikamente mit Anwendung), worauf zu achten ist, wann man sich melden soll.
- leistungen: tatsächlich erbrachte Leistungen in dieser Behandlung. Ordne jede Leistung der passenden Zeile der Preisliste zu (preisliste_id, z. B. "P3"). Gibt es keine eindeutig passende Zeile, preisliste_id = "" und die Leistung in Klartext. Erfinde niemals Preise, Gebührenpositionen oder Ziffern.
- kostenvoranschlag: nur erforderlich, wenn im Gespräch eine weitere Behandlung, OP oder Diagnostik besprochen wurde, die noch nicht durchgeführt ist. Positionen wie bei leistungen. hinweis: Unsicherheiten (z. B. "abhängig vom Befund").
- versicherung: Diagnose und durchgeführte Behandlung in klarer, sachlicher Sprache für eine Tierkrankenversicherung.
- ueberweisung: nur erforderlich, wenn an Klinik, Fachtierarzt oder externes Labor überwiesen wird. brief: kollegialer Überweisungsbrief mit Signalement, Vorbericht, Befunden, bisheriger Therapie und Fragestellung.
- erinnerungen: vereinbarte Kontrollen, Impfungen, Medikamentenende, mit Zeitpunkt wie besprochen.
- pruefliste: alles, was der Tierarzt prüfen oder ergänzen muss: fehlende Angaben (z. B. Gewicht), unsichere Medikamentennamen oder Dosierungen, Leistungen ohne passende Preislisten-Zeile, unklare Stellen im Transkript.

Regeln:
- Erfinde keine Befunde, Werte, Dosierungen, Wartezeiten, Diagnosen oder Preise. Was fehlt, kommt auf die pruefliste.
- Korrigiere Erkennungsfehler bei Fachbegriffen und Medikamentennamen nur, wenn die Bedeutung eindeutig ist; sonst auf die pruefliste.
- Unbekannte Felder als leeren String.
- Smalltalk ohne medizinische Relevanz ignorieren.`;

export class ReportInputError extends Error {}
export class ReportGenerationError extends Error {}

export function validateInput(body) {
  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const species = typeof body?.species === "string" ? body.species.trim() : "";

  if (transcript.length < 20) {
    throw new ReportInputError("Das Transkript ist zu kurz für einen Bericht.");
  }
  if (transcript.length + notes.length > MAX_TRANSCRIPT_CHARS) {
    throw new ReportInputError("Das Transkript ist zu lang. Bitte auf eine Behandlung beschränken.");
  }
  return { transcript, notes, species };
}

export function buildPracticeContext(settings) {
  const prices = parsePriceList(settings.preisliste);
  const priceLines = prices.length
    ? prices.map((p) => `${p.id}: ${p.code ? p.code + " – " : ""}${p.leistung}`).join("\n")
    : "(keine Preisliste hinterlegt)";
  return [
    `Land: ${settings.land === "DE" ? "Deutschland (GOT)" : "Österreich"}`,
    `Ton der Besitzerinfo: ${settings.tonBesitzerinfo || "freundlich, Sie-Form"}`,
    `<abkuerzungen>\n${settings.abkuerzungen || "(keine)"}\n</abkuerzungen>`,
    `<preisliste>\n${priceLines}\n</preisliste>`,
  ].join("\n\n");
}

export function buildUserMessage({ transcript, notes, species }) {
  const parts = [];
  if (species) parts.push(`Tierart laut Praxis: ${species}`);
  if (notes) parts.push(`<notizen>\n${notes}\n</notizen>`);
  parts.push(`<transkript>\n${transcript}\n</transkript>`);
  return parts.join("\n\n");
}

export async function generateReport(input, settings, client = new Anthropic()) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(ReportSchema),
    },
    // Stable instructions first and cached; practice settings change rarely.
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: buildPracticeContext(settings), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: buildUserMessage(input) }],
  });

  if (response.stop_reason === "refusal") {
    throw new ReportGenerationError("Die KI hat die Anfrage abgelehnt.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new ReportGenerationError("Die Unterlagen konnten nicht vollständig erstellt werden.");
  }
  return response.parsed_output;
}
