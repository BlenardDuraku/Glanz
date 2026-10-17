import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export const MODEL = "claude-opus-5-5";
export const MAX_TRANSCRIPT_CHARS = 60_000;

export const ReportSchema = z.object({
  patient: z.object({
    tierart: z.string(),
    name: z.string(),
    rasse: z.string(),
    alter: z.string(),
    gewicht: z.string(),
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
  nachkontrolle: z.string(),
  leistungen: z.array(z.string()),
  fehlende_angaben: z.array(z.string()),
});

const SYSTEM_PROMPT = `Du bist ein Dokumentationsassistent für Tierarztpraxen im deutschsprachigen Raum (Österreich, Deutschland, Schweiz).
Du erhältst das Transkript eines Behandlungsgesprächs (oft mit Dialekt, Füllwörtern und Erkennungsfehlern der Spracherkennung) sowie optionale Notizen des Tierarztes.

Erstelle daraus eine strukturierte Behandlungsdokumentation:
- SOAP: Subjektiv (Vorbericht/Anamnese laut Besitzer), Objektiv (Untersuchungsbefunde, Messwerte), Assessment (Einschätzung, Verdachts- und Differenzialdiagnosen), Plan (Therapie, Diagnostik, Empfehlungen). Fachsprachlich, knapp, in ganzen Sätzen oder Stichpunkten wie in einer Praxisakte üblich.
- diagnosen: gestellte oder Verdachtsdiagnosen, als solche gekennzeichnet ("V.a. ...").
- medikamente: nur was im Gespräch tatsächlich verordnet oder verabreicht wurde, mit Dosis und Anwendung so wie genannt.
- besitzer_info: eine freundliche, leicht verständliche Zusammenfassung für den Tierbesitzer (Sie-Form, ohne Fachjargon): was festgestellt wurde, was zu Hause zu tun ist, worauf zu achten ist und wann man sich melden soll.
- nachkontrolle: vereinbarter Kontrolltermin oder Wiedervorstellung; leerer String, wenn keiner genannt wurde.
- leistungen: erbrachte Leistungen in Klartext (z. B. "Allgemeinuntersuchung", "Injektion s.c.", "Blutentnahme"), als Grundlage für die Abrechnung. Erfinde keine Gebührenpositionen oder Ziffern.
- fehlende_angaben: was für eine vollständige Akte fehlt oder unklar ist (z. B. Gewicht nicht genannt, Dosis unklar).

Regeln:
- Erfinde keine Befunde, Werte, Dosierungen oder Diagnosen. Was nicht im Transkript oder den Notizen steht, bleibt weg oder kommt unter fehlende_angaben.
- Korrigiere offensichtliche Erkennungsfehler bei Fachbegriffen und Medikamentennamen nur, wenn die Bedeutung eindeutig ist; sonst unter fehlende_angaben nachfragen.
- Unbekannte Patientendaten als leeren String angeben.
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

export function buildUserMessage({ transcript, notes, species }) {
  const parts = [];
  if (species) parts.push(`Tierart laut Praxis: ${species}`);
  if (notes) parts.push(`<notizen>\n${notes}\n</notizen>`);
  parts.push(`<transkript>\n${transcript}\n</transkript>`);
  return parts.join("\n\n");
}

export async function generateReport(input, client = new Anthropic()) {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(ReportSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(input) }],
  });

  if (response.stop_reason === "refusal") {
    throw new ReportGenerationError("Die KI hat die Anfrage abgelehnt.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new ReportGenerationError("Der Bericht konnte nicht vollständig erstellt werden.");
  }
  return response.parsed_output;
}
