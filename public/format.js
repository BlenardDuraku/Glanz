// Turns the structured AI report into the seven editable document drafts.
// Pure functions: used in the browser and in the Node tests.
// Prices and totals are computed here from the practice price list, never by the AI.

export const DOC_LABELS = {
  bericht: "Behandlungsbericht",
  besitzerinfo: "Besitzerinfo",
  rechnung: "Rechnungsentwurf",
  kostenvoranschlag: "Kostenvoranschlag",
  versicherung: "Versicherungspaket",
  ueberweisung: "Überweisung",
  erinnerung: "Erinnerungen",
};

export function money(value) {
  return value.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

const round2 = (n) => Math.round(n * 100) / 100;

export function resolvePositions(positions, prices) {
  const byId = new Map(prices.map((p) => [p.id, p]));
  return positions.map((pos) => {
    const menge = Number.isFinite(pos.menge) && pos.menge > 0 ? pos.menge : 1;
    const item = byId.get(pos.preisliste_id);
    if (!item) return { leistung: pos.leistung, code: "", menge, einzel: null, summe: null };
    return { leistung: item.leistung, code: item.code, menge, einzel: item.preis, summe: round2(item.preis * menge) };
  });
}

export function totals(lines, ustSatz) {
  const netto = round2(lines.reduce((sum, l) => sum + (l.summe ?? 0), 0));
  const ust = round2((netto * ustSatz) / 100);
  return { netto, ust, brutto: round2(netto + ust), offen: lines.filter((l) => l.summe === null).length };
}

function header(settings) {
  return [settings.praxisName, settings.praxisAdresse].filter(Boolean).join("\n");
}

function signalement(p) {
  const parts = [p.tierart, p.rasse, p.alter, p.gewicht && `${p.gewicht}`].filter(Boolean);
  return `${p.name || "Patient"}${parts.length ? " (" + parts.join(", ") + ")" : ""}`;
}

function positionTable(lines, settings) {
  const rows = lines.map((l) => {
    const code = l.code ? `[${l.code}] ` : "";
    const preis = l.summe === null ? "Preis offen" : `${l.menge} × ${money(l.einzel)} = ${money(l.summe)}`;
    return `- ${code}${l.leistung}: ${preis}`;
  });
  const t = totals(lines, settings.ustSatz);
  rows.push("", `Netto: ${money(t.netto)}`, `USt ${settings.ustSatz} %: ${money(t.ust)}`, `Gesamt: ${money(t.brutto)}`);
  if (t.offen) rows.push(`Achtung: ${t.offen} Position(en) ohne Preis, bitte ergänzen.`);
  return rows.join("\n");
}

function medList(meds) {
  return meds.map((m) => `- ${[m.name, m.dosis, m.anwendung].filter(Boolean).join(", ")}`).join("\n");
}

export function buildDocuments(report, settings, prices, date = new Date()) {
  const r = report;
  const datum = date.toLocaleDateString("de-AT");
  const kopf = header(settings);
  const halter = r.patient.halter ? `Tierhalter/in: ${r.patient.halter}\n` : "";
  const leistungen = resolvePositions(r.leistungen, prices);
  const unterschrift = settings.tierarztName ? `\n\n${settings.tierarztName}` : "";

  const docs = {};

  docs.bericht = [
    `Datum: ${datum}`,
    `Patient: ${signalement(r.patient)}`,
    halter.trim(),
    "",
    `S – Subjektiv:\n${r.soap.subjektiv || "–"}`,
    `O – Objektiv:\n${r.soap.objektiv || "–"}`,
    `A – Assessment:\n${r.soap.assessment || "–"}`,
    `P – Plan:\n${r.soap.plan || "–"}`,
    r.diagnosen.length ? `Diagnosen:\n${r.diagnosen.map((d) => `- ${d}`).join("\n")}` : "",
    r.medikamente.length ? `Medikamente:\n${medList(r.medikamente)}` : "",
  ]
    .filter((s) => s !== "")
    .join("\n\n");

  docs.besitzerinfo = [
    kopf,
    `Informationen zur Behandlung von ${r.patient.name || "Ihrem Tier"} am ${datum}`,
    r.besitzer_info,
    r.medikamente.length ? `Ihre Medikamente:\n${medList(r.medikamente)}` : "",
    r.erinnerungen.length ? `Nächste Termine:\n${r.erinnerungen.map((e) => `- ${e.anlass}: ${e.wann}`).join("\n")}` : "",
    unterschrift.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  docs.rechnung = [
    kopf,
    `RECHNUNGSENTWURF – ${datum}`,
    `${halter}Patient: ${signalement(r.patient)}`,
    leistungen.length ? positionTable(leistungen, settings) : "Keine Leistungen erkannt.",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (r.kostenvoranschlag.erforderlich) {
    const kv = resolvePositions(r.kostenvoranschlag.positionen, prices);
    docs.kostenvoranschlag = [
      kopf,
      `KOSTENVORANSCHLAG – ${datum}`,
      `${halter}Patient: ${signalement(r.patient)}`,
      `Anlass: ${r.kostenvoranschlag.anlass}`,
      kv.length ? positionTable(kv, settings) : "Positionen bitte ergänzen.",
      r.kostenvoranschlag.hinweis ? `Hinweis: ${r.kostenvoranschlag.hinweis}` : "",
      "Dieser Kostenvoranschlag ist unverbindlich. Abweichungen sind je nach Befund möglich.",
      unterschrift.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  docs.versicherung = [
    kopf,
    `Behandlungsbestätigung für die Tierkrankenversicherung – ${datum}`,
    `${halter}Patient: ${signalement(r.patient)}`,
    `Diagnose:\n${r.versicherung.diagnose_klartext || r.diagnosen.join(", ") || "–"}`,
    `Durchgeführte Behandlung:\n${r.versicherung.behandlung_klartext || "–"}`,
    leistungen.length ? `Abgerechnete Leistungen:\n${positionTable(leistungen, settings)}` : "",
    unterschrift.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (r.ueberweisung.erforderlich) {
    docs.ueberweisung = [
      kopf,
      `An: ${r.ueberweisung.empfaenger || "(Empfänger ergänzen)"}`,
      `Überweisung – ${datum}`,
      `Patient: ${signalement(r.patient)}`,
      `Fragestellung: ${r.ueberweisung.fragestellung || "–"}`,
      r.ueberweisung.brief,
      unterschrift.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (r.erinnerungen.length) {
    docs.erinnerung = r.erinnerungen
      .map((e) => `- ${r.patient.name || "Patient"}: ${e.anlass} – ${e.wann}`)
      .join("\n");
  }

  return docs;
}
