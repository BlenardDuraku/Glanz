const $ = (id) => document.getElementById(id);

const transcriptEl = $("transcript");
const recBtn = $("recBtn");
const recStatus = $("recStatus");
const genBtn = $("genBtn");
const errorEl = $("error");

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
  recStatus.textContent = recording ? "Hört zu …" : "";
  if (recording) startRecording();
  else recognition?.stop();
});

$("clearBtn").addEventListener("click", () => {
  transcriptEl.value = "";
  $("notes").value = "";
  hideError();
});

// --- Report generation ---
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
    renderReport(data.report);
  } catch (err) {
    showError(err.message);
    $("placeholder").hidden = false;
  } finally {
    genBtn.disabled = false;
    $("loading").hidden = true;
  }
});

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function fillList(id, items, emptyText) {
  const list = $(id);
  list.replaceChildren(...(items.length ? items : [emptyText]).map((t) => el("li", t)));
}

let soapText = "";

function renderReport(r) {
  const patient = $("patient");
  patient.replaceChildren();
  for (const [label, value] of [
    ["Tierart", r.patient.tierart],
    ["Name", r.patient.name],
    ["Rasse", r.patient.rasse],
    ["Alter", r.patient.alter],
    ["Gewicht", r.patient.gewicht],
  ]) {
    patient.append(el("dt", label), el("dd", value || "–"));
  }

  const soapParts = [
    ["S – Subjektiv", r.soap.subjektiv],
    ["O – Objektiv", r.soap.objektiv],
    ["A – Assessment", r.soap.assessment],
    ["P – Plan", r.soap.plan],
  ];
  $("soap").replaceChildren(
    ...soapParts.map(([label, text]) => {
      const part = el("div", "", "soap-part");
      part.append(el("b", label), el("p", text || "–", "pre"));
      return part;
    }),
  );
  soapText = soapParts.map(([label, text]) => `${label}\n${text || "–"}`).join("\n\n");

  fillList("diagnosen", r.diagnosen.map((d) => `Diagnose: ${d}`), "Keine Diagnose genannt");
  fillList(
    "medikamente",
    r.medikamente.map((m) => [m.name, m.dosis, m.anwendung].filter(Boolean).join(" – ")),
    "Keine Medikamente verordnet",
  );
  $("besitzer").textContent = r.besitzer_info;
  $("nachkontrolle").textContent = r.nachkontrolle ? `Nachkontrolle: ${r.nachkontrolle}` : "";
  fillList("leistungen", r.leistungen, "Keine Leistungen erkannt");
  $("fehlendBlock").hidden = r.fehlende_angaben.length === 0;
  fillList("fehlend", r.fehlende_angaben, "");

  $("result").hidden = false;
}

document.addEventListener("click", async (event) => {
  const key = event.target.dataset?.copy;
  if (!key) return;
  const text = key === "soapText" ? soapText : $(key).textContent;
  try {
    await navigator.clipboard.writeText(text);
    event.target.textContent = "Kopiert ✓";
    setTimeout(() => (event.target.textContent = "Kopieren"), 1500);
  } catch {
    showError("Kopieren nicht möglich. Bitte manuell markieren.");
  }
});

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}
function hideError() {
  errorEl.hidden = true;
}
