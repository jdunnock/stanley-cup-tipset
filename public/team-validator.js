const participantNameInput = document.getElementById("participantName");
const seasonIdInput = document.getElementById("seasonId");
const rankingFromInput = document.getElementById("rankingFrom");
const rankingToInput = document.getElementById("rankingTo");
const rosterTextInput = document.getElementById("rosterText");
const validateBtn = document.getElementById("validateBtn");
const statusEl = document.getElementById("status");
const decisionEl = document.getElementById("decision");
const errorsListEl = document.getElementById("errorsList");
const warningsListEl = document.getElementById("warningsList");
const diagnosticsEl = document.getElementById("diagnostics");

function setStatus(text) {
  statusEl.textContent = text;
}

function renderList(element, items, emptyText) {
  element.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    element.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = String(item);
    element.appendChild(li);
  }
}

function setDecision(status) {
  if (status === "PASS") {
    decisionEl.className = "pass";
    decisionEl.textContent = "PASS";
    return;
  }

  decisionEl.className = "fail";
  decisionEl.textContent = "FAIL";
}

async function validateRoster() {
  setStatus("Validoidaan...");
  validateBtn.disabled = true;

  try {
    const payload = {
      participantName: String(participantNameInput.value || "").trim(),
      seasonId: String(seasonIdInput.value || "").trim(),
      rankingFrom: String(rankingFromInput.value || "").trim(),
      rankingTo: String(rankingToInput.value || "").trim(),
      rosterText: String(rosterTextInput.value || "").trim(),
    };

    const response = await fetch("/api/team-validator", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json();
    if (!response.ok || !body?.ok) {
      throw new Error(body?.error || "Validointi epäonnistui");
    }

    const result = body.result || {};
    setDecision(result.status === "PASS" ? "PASS" : "FAIL");
    renderList(errorsListEl, result.errors || [], "Ei virheitä.");
    renderList(warningsListEl, result.warnings || [], "Ei varoituksia.");
    diagnosticsEl.textContent = JSON.stringify(result.diagnostics || {}, null, 2);
    setStatus("Validointi valmis.");
  } catch (error) {
    setDecision("FAIL");
    renderList(errorsListEl, [String(error.message || error)], "Ei virheitä.");
    renderList(warningsListEl, [], "Ei varoituksia.");
    diagnosticsEl.textContent = "-";
    setStatus("Validointi epäonnistui.");
  } finally {
    validateBtn.disabled = false;
  }
}

validateBtn.addEventListener("click", validateRoster);
