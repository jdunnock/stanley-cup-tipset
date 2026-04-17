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
let activeCompetitionType = "stanley_cup";

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
      competitionType: activeCompetitionType,
      rosterText: String(rosterTextInput.value || "").trim(),
      previousRosterFile: "", // Period 1 validation - clean slate (no ownership checks)
    };

    const response = await fetch("/api/team-validator", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await response.text();
    let body = null;

    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new Error(
        `Validator API palautti ei-JSON-vastauksen (${response.status} ${response.statusText}): ${rawBody.slice(0, 120)}`
      );
    }

    if (!response.ok || !body?.ok) {
      throw new Error(body?.error || "Validointi epäonnistui");
    }

    const result = body.result || {};
    setDecision(result.status === "PASS" ? "PASS" : "FAIL");
    renderList(errorsListEl, result.errors || [], "Ei virheitä.");
    renderList(warningsListEl, result.warnings || [], "Ei varoituksia.");
    diagnosticsEl.textContent = JSON.stringify(result.diagnostics || {}, null, 2);
    
    // Show success message if saved to Period 1
    if (result.status === "PASS" && result.savedToPeriod1) {
      setStatus("✓ Validointi onnistui ja tiimi lisätty Period 1:een");
    } else {
      setStatus("Validointi valmis.");
    }
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

async function loadValidatorDefaults() {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    return;
  }

  const data = await response.json();
  if (data?.competitionType) {
    activeCompetitionType = String(data.competitionType);
  }

  const rankingWindow = data?.rankingWindow;
  if (rankingWindow?.rankingFrom) {
    rankingFromInput.value = rankingWindow.rankingFrom;
  }
  if (rankingWindow?.rankingTo) {
    rankingToInput.value = rankingWindow.rankingTo;
  }
}

validateBtn.addEventListener("click", validateRoster);
loadValidatorDefaults().catch(() => {
  // Keep static defaults from HTML if settings endpoint is unavailable.
});
