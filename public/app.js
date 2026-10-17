import { DOC_LABELS, buildDocuments } from "./format.js";

const $ = (id) => document.getElementById(id);

const transcriptEl = $("transcript");
const recBtn = $("recBtn");
const genBtn = $("genBtn");
const errorEl = $("error");
const docText = $("docText");

let settings = null;
let drafts = {}; // type -> AI draft text (never changed)
let finals = {}; // type -> current, possibly edited text
let activeType = "bericht";
let approval = null; // set after "Alle freigeben"; cleared on any edit

// --- Settings ---
async function loadSettings() {
  const res = await fetch("/api/settings");
  settings = (await res.json()).settings;
  if (!$("approver").value) $("approver").value = settings.tierarztName;
}

$("settingsBtn").addEventListener("click", () => {
  const form = $("settingsForm");
  for (const [key, value] of Object.entries(settings)) {
    if (form.elements[key]) form.elements[key].value = value;
  }
  $("settingsError").hidden = true;
  $("settingsDialog").showModal();
});

$("saveSettings").addEventListener("click", async (event) => {
  event.preventDefault();
  const form = $("settingsForm");
  const body = Object.fromEntries(new FormData(form));
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    $("settingsError").textContent = data.error;
    $("settingsError").hidden = false;
    return;
  }
  settings = data.settings;
  if (!$("approver").value) $("approver").value = settings.tierarztName;
  $("settingsDialog").close();
});

// --- Approval log ---
$("logBtn").addEventListener("click", async () => {
  const res = await fetch("/api/approvals");
  const { approvals } = await res.json();
  const list = $("logList");
  list.replaceChildren();
  if (!approvals.length) list.append(el("p", "Noch keine Freigaben.", "muted"));
  for (const a of approvals) {
    const item = el("div", "", "log-item");
    const when = new Date(a.approvedAt).toLocaleString("de-AT");
    item.append(el("strong", `${when} – ${a.tierarzt}`));
    const docs = a.documents.map((d) => `${DOC_LABELS[d.type]}${d.edited ? " (geändert)" : ""}`).join(", ");
    item.append(el("p", docs, "small-text"));
    list.append(item);
  }
  $("logDialog").showModal();
});
$("closeLog").addEventListener("click", () => $("logDialog").close());

// --- Speech recognition (browser-native, Chrome/Edge) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recording = false;

if (!SpeechRecognition) {
  $("noSpeech").hidden = false;
  recBtn.disabled = true;
}

function startRecording() {
  recognition = new SpeechRecognition();
  recognition.lang = $("lang").value;
  recognition.continuous = true;
  recognition.interimResults = true;

  const base = transcriptEl.value ? transcriptEl.value.trimEnd() + "\n" : "";
  let finalText = "";

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalText += r[0].transcript.trim() + " ";
      else interim += r[0].transcript;
    }
    transcriptEl.value = base + finalText + interim;
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed") showError("Mikrofon-Zugriff wurde verweigert.");
  };
  // The browser stops after silence; keep going until the user stops.
  recognition.onend = () => {
    if (recording) {
      transcriptEl.value = base + finalText;
      startRecording();
    }
  };
  recognition.start();
}

recBtn.addEventListener("click", () => {
  hideError();
  recording = !recording;
  recBtn.classList.toggle("on", recording);
  recBtn.textContent = recording ? "■ Aufnahme stoppen" : "● Aufnahme starten";
  $("recStatus").textContent = recording ? "Hört zu …" : "";
  if (recording) startRecording();
  else recognition?.stop();
});

$("clearBtn").addEventListener("click", () => {
  transcriptEl.value = "";
  $("notes").value = "";
  drafts = {};
  finals = {};
  approval = null;
  $("result").hidden = true;
  $("placeholder").hidden = false;
  hideError();
});

// --- Generation ---
genBtn.addEventListener("click", async () => {
  hideError();
  if (recording) recBtn.click();

  genBtn.disabled = true;
  $("placeholder").hidden = true;
  $("result").hidden = true;
  $("loading").hidden = false;

  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: transcriptEl.value,
        notes: $("notes").value,
        species: $("species").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    settings = data.settings;
    showDocuments(data.report, data.prices);
  } catch (err) {
    showError(err.message);
    $("placeholder").hidden = false;
  } finally {
    genBtn.disabled = false;
    $("loading").hidden = true;
  }
});

function showDocuments(report, prices) {
  drafts = buildDocuments(report, settings, prices);
  finals = { ...drafts };
  approval = null;

  const checklist = $("checklist");
  checklist.replaceChildren(...report.pruefliste.map((t) => el("li", t)));
  $("checkBlock").hidden = report.pruefliste.length === 0;

  activeType = "bericht";
  renderTabs();
  renderActive();
  renderApproval();
  $("reviewed").checked = false;
  $("result").hidden = false;
}

function renderTabs() {
  const tabs = $("tabs");
  tabs.replaceChildren();
  for (const [type, label] of Object.entries(DOC_LABELS)) {
    const tab = el("button", label, "tab");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(type === activeType));
    if (!(type in finals)) tab.classList.add("absent");
    if (finals[type] !== undefined && finals[type] !== drafts[type]) tab.classList.add("edited");
    tab.addEventListener("click", () => {
      activeType = type;
      renderTabs();
      renderActive();
    });
    tabs.append(tab);
  }
}

function renderActive() {
  const present = activeType in finals;
  docText.hidden = !present;
  $("docEmpty").hidden = present;
  docText.value = present ? finals[activeType] : "";
  for (const b of document.querySelectorAll("[data-action]")) b.disabled = !approval || !present;
  $("exportHint").hidden = Boolean(approval);
}

docText.addEventListener("input", () => {
  finals[activeType] = docText.value;
  // Any edit after approval invalidates it: the approved version must match what leaves the practice.
  if (approval) {
    approval = null;
    renderApproval();
    renderActive();
  }
  renderTabs();
});

// --- Approval ---
$("approveBtn").addEventListener("click", async () => {
  const approveError = $("approveError");
  approveError.hidden = true;
  const fail = (msg) => {
    approveError.textContent = msg;
    approveError.hidden = false;
  };
  if (!$("reviewed").checked) return fail("Bitte bestätigen, dass alle Entwürfe geprüft wurden.");
  const documents = {};
  for (const type of Object.keys(finals)) documents[type] = { draft: drafts[type], final: finals[type] };
  const res = await fetch("/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tierarzt: $("approver").value, documents }),
  });
  const data = await res.json();
  if (!res.ok) return fail(data.error);
  approval = data.approval;
  renderApproval();
  renderActive();
});

function renderApproval() {
  const status = $("approveStatus");
  if (approval) {
    const when = new Date(approval.approvedAt).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
    status.textContent = `✓ Freigegeben um ${when} von ${approval.tierarzt}. Export ist jetzt möglich.`;
  }
  status.hidden = !approval;
  $("approveBtn").textContent = approval ? "Erneut freigeben" : "Alle freigeben";
}

// --- Export (only after approval) ---
document.addEventListener("click", async (event) => {
  const action = event.target.dataset?.action;
  if (!action || !approval) return;
  const text = finals[activeType];
  const title = DOC_LABELS[activeType];

  if (action === "copy") {
    try {
      await navigator.clipboard.writeText(text);
      flash(event.target, "Kopiert ✓");
    } catch {
      showError("Kopieren nicht möglich. Bitte manuell markieren.");
    }
  } else if (action === "print") {
    printText(title, text);
  } else if (action === "mail") {
    const subject = `${title}${settings.praxisName ? " – " + settings.praxisName : ""}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  }
});

function printText(title, text) {
  const frame = $("printFrame");
  const doc = frame.contentDocument;
  doc.open();
  doc.write("<!doctype html><html lang='de'><head><meta charset='utf-8'><title></title>" +
    "<style>body{font:12pt/1.5 Georgia,serif;margin:2cm;color:#000}pre{white-space:pre-wrap;font:inherit}</style></head><body><pre></pre></body></html>");
  doc.close();
  doc.title = title;
  doc.querySelector("pre").textContent = text;
  frame.contentWindow.focus();
  frame.contentWindow.print();
}

// --- Helpers ---
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function flash(button, label) {
  const old = button.textContent;
  button.textContent = label;
  setTimeout(() => (button.textContent = old), 1500);
}
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}
function hideError() {
  errorEl.hidden = true;
}

loadSettings().catch(() => showError("Einstellungen konnten nicht geladen werden."));
