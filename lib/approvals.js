import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const DOC_TYPES = [
  "bericht",
  "besitzerinfo",
  "rechnung",
  "kostenvoranschlag",
  "versicherung",
  "ueberweisung",
  "erinnerung",
];

export class ApprovalError extends Error {}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

// The audit log stores who approved which documents, when, and whether the
// draft was edited. Document contents are stored only as hashes, so the log
// proves what was approved without keeping patient data on the server.
export function buildApprovalEntry(body, now = new Date()) {
  const tierarzt = typeof body?.tierarzt === "string" ? body.tierarzt.trim() : "";
  if (!tierarzt) throw new ApprovalError("Bitte den Namen des freigebenden Tierarztes angeben.");

  const docs = body?.documents;
  if (!docs || typeof docs !== "object") throw new ApprovalError("Keine Dokumente zur Freigabe.");

  const documents = [];
  for (const type of DOC_TYPES) {
    const doc = docs[type];
    if (!doc) continue;
    if (typeof doc.final !== "string" || typeof doc.draft !== "string") {
      throw new ApprovalError(`Dokument ${type} ist unvollständig.`);
    }
    documents.push({
      type,
      edited: doc.final.trim() !== doc.draft.trim(),
      hash: sha256(doc.final),
    });
  }
  if (documents.length === 0) throw new ApprovalError("Keine Dokumente zur Freigabe.");

  return {
    id: crypto.randomUUID(),
    approvedAt: now.toISOString(),
    tierarzt: tierarzt.slice(0, 200),
    documents,
  };
}

export function createApprovalLog(dataDir) {
  const file = path.join(dataDir, "freigaben.jsonl");
  return {
    async append(entry) {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.appendFile(file, JSON.stringify(entry) + "\n");
    },
    async list(limit = 50) {
      try {
        const lines = (await fs.readFile(file, "utf8")).trim().split("\n").filter(Boolean);
        return lines.slice(-limit).map((l) => JSON.parse(l)).reverse();
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
