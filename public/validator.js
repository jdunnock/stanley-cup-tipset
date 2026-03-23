const participantNameInput = document.getElementById("participantName");
const adminTokenInput = document.getElementById("adminToken");
const periodSelect = document.getElementById("periodSelect");
const rosterTextInput = document.getElementById("rosterText");
const validateBtn = document.getElementById("validateBtn");
const statusEl = document.getElementById("status");
const decisionEl = document.getElementById("decision");
const errorsListEl = document.getElementById("errorsList");
const warningsListEl = document.getElementById("warningsList");
const diagnosticsEl = document.getElementById("diagnostics");
const savedTeamEl = document.getElementById("savedTeam");

const ADMIN_TOKEN_KEY = "playoffsAdminToken";

function getAdminToken() {
  const fromInput = String(adminTokenInput?.value || "").trim();
  if (fromInput) {
    return fromInput;
  }
  return String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
}

function getAdminHeaders(extraHeaders = {}) {
  const token = getAdminToken();
  if (!token) {
    return extraHeaders;
  }
  return {
    ...extraHeaders,
    "x-admin-token": token,
  };
}

function setStatus(text) {
  statusEl.textContent = text;
}

function renderList(element, items, emptyText) {
  element.innerHTML = "";
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    element.appendChild(li);
    return;
  }

  for (const item of list) {
    const li = document.createElement("li");
    li.textContent = String(item);
    element.appendChild(li);
  }
}

function setDecision(status) {
  decisionEl.textContent = status;
  decisionEl.style.fontWeight = "800";
  decisionEl.style.color = status === "PASS" ? "#0f6a44" : "#a33a3a";
}

async function loadFiles() {
  setStatus("Valmis");
}

function renderSavedTeam(team) {
  if (!savedTeamEl) {
    return;
  }

  if (!team) {
    savedTeamEl.textContent = "Ei tallennettua joukkuetta.";
    return;
  }

  savedTeamEl.textContent = JSON.stringify(team, null, 2);
}

async function loadSavedTeam() {
  const participantName = String(participantNameInput?.value || "").trim();
  const period = String(periodSelect?.value || "").trim();

  if (!participantName || !period) {
    renderSavedTeam(null);
    return;
  }

  try {
    const params = new URLSearchParams({ participantName, period });
    const response = await fetch(`/api/playoffs/validator/team?${params.toString()}`, {
      headers: getAdminHeaders(),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Saved team fetch failed");
    }
    renderSavedTeam(body.data?.team || null);
  } catch {
    renderSavedTeam(null);
  }
}

async function validateRoster() {
  setStatus("Validerar...");
  validateBtn.disabled = true;

  try {
    const payload = {
      participantName: String(participantNameInput.value || "").trim(),
      period: String(periodSelect?.value || "").trim(),
      rosterText: String(rosterTextInput.value || "").trim(),
    };

    const response = await fetch("/api/playoffs/validator/validate-team", {
      method: "POST",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Validation failed");
    }

    const result = body.result || {};
    setDecision(result.status || "FAIL");
    renderList(errorsListEl, result.errors, "Ei virheita");
    renderList(warningsListEl, result.warnings, "Ei varoituksia");
    diagnosticsEl.textContent = JSON.stringify(result.diagnostics || {}, null, 2);
    if (result.status === "PASS") {
      setStatus("Joukkue tallennettu onnistuneesti");
      renderSavedTeam(result.team || null);
    } else {
      setStatus("Validointi epaonnistui");
      await loadSavedTeam();
    }
  } catch (error) {
    setDecision("FAIL");
    renderList(errorsListEl, [String(error.message || error)], "Ei virheita");
    renderList(warningsListEl, [], "Ei varoituksia");
    diagnosticsEl.textContent = "-";
    setStatus("Validointi epaonnistui");
  } finally {
    validateBtn.disabled = false;
  }
}

validateBtn.addEventListener("click", validateRoster);

participantNameInput?.addEventListener("blur", () => {
  loadSavedTeam().catch(() => {});
});

periodSelect?.addEventListener("change", () => {
  loadSavedTeam().catch(() => {});
});

adminTokenInput?.addEventListener("change", () => {
  localStorage.setItem(ADMIN_TOKEN_KEY, String(adminTokenInput.value || "").trim());
});

if (adminTokenInput) {
  adminTokenInput.value = String(localStorage.getItem(ADMIN_TOKEN_KEY) || "");
}

loadFiles().catch((error) => {
  setStatus(`Virhe: ${String(error.message || error)}`);
});

loadSavedTeam().catch(() => {});
