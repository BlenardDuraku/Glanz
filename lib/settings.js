import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_SETTINGS = {
  praxisName: "",
  praxisAdresse: "",
  tierarztName: "",
  land: "AT",
  ustSatz: 20,
  abkuerzungen: "AU = Allgemeinuntersuchung\no.b.B. = ohne besonderen Befund",
  preisliste: "",
  tonBesitzerinfo: "freundlich, Sie-Form, einfache Sprache",
};

const MAX_FIELD_CHARS = 20_000;

export class SettingsError extends Error {}

// Normalises user-supplied settings: unknown keys are dropped, strings are trimmed
// and capped, the country is AT or DE, the VAT rate is a sane percentage.
export function sanitizeSettings(input) {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = input?.[key];
    if (value === undefined) continue;
    if (key === "ustSatz") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 30) throw new SettingsError("USt-Satz muss zwischen 0 und 30 % liegen.");
      out.ustSatz = n;
    } else if (key === "land") {
      if (value !== "AT" && value !== "DE") throw new SettingsError("Land muss AT oder DE sein.");
      out.land = value;
    } else {
      if (typeof value !== "string") throw new SettingsError(`Feld ${key} muss Text sein.`);
      out[key] = value.trim().slice(0, MAX_FIELD_CHARS);
    }
  }
  return out;
}

// Price list format, one line per item: "Code; Leistung; Preis netto"
// e.g. "AU; Allgemeinuntersuchung Hund; 35,00". Code is optional ("; Impfung; 45").
export function parsePriceList(text) {
  const items = [];
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(";").map((p) => p.trim());
    if (parts.length < 3) continue;
    const [code, leistung, preisText] = parts;
    const preis = Number(preisText.replace(/\s|€/g, "").replace(",", "."));
    if (!leistung || !Number.isFinite(preis)) continue;
    items.push({ id: `P${items.length + 1}`, code, leistung, preis });
  }
  return items;
}

export function createSettingsStore(dataDir) {
  const file = path.join(dataDir, "settings.json");
  return {
    async load() {
      try {
        return sanitizeSettings(JSON.parse(await fs.readFile(file, "utf8")));
      } catch (err) {
        if (err.code === "ENOENT") return { ...DEFAULT_SETTINGS };
        throw err;
      }
    },
    async save(input) {
      const settings = sanitizeSettings(input);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(settings, null, 2));
      return settings;
    },
  };
}
