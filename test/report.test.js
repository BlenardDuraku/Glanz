import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInput, buildUserMessage, ReportInputError, MAX_TRANSCRIPT_CHARS } from "../lib/report.js";

test("rejects a transcript that is too short", () => {
  assert.throws(() => validateInput({ transcript: "Hallo" }), ReportInputError);
});

test("rejects a transcript that is too long", () => {
  const transcript = "a".repeat(MAX_TRANSCRIPT_CHARS + 1);
  assert.throws(() => validateInput({ transcript }), ReportInputError);
});

test("ignores non-string fields", () => {
  const input = validateInput({ transcript: "Der Hund hustet seit drei Tagen.", notes: 5, species: null });
  assert.deepEqual(input, { transcript: "Der Hund hustet seit drei Tagen.", notes: "", species: "" });
});

test("builds a message with species, notes and transcript", () => {
  const msg = buildUserMessage({ transcript: "T", notes: "N", species: "Katze" });
  assert.match(msg, /Tierart laut Praxis: Katze/);
  assert.match(msg, /<notizen>\nN\n<\/notizen>/);
  assert.match(msg, /<transkript>\nT\n<\/transkript>/);
});

test("omits empty optional parts", () => {
  const msg = buildUserMessage({ transcript: "T", notes: "", species: "" });
  assert.equal(msg, "<transkript>\nT\n</transkript>");
});
