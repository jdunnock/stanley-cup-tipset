const statusEl = document.getElementById("status");
const seasonLabelEl = document.getElementById("seasonLabel");
const periodLabelEl = document.getElementById("periodLabel");
const updatedAtEl = document.getElementById("updatedAt");
const staleStatusEl = document.getElementById("staleStatus");
const schedulerEl = document.getElementById("scheduler");
const listEl = document.getElementById("list");
const runNowBtn = document.getElementById("runNowBtn");
const adminTokenInput = document.getElementById("adminToken");

const ADMIN_TOKEN_KEY = "playoffsAdminToken";

function getAdminToken() {
  const fromInput = String(adminTokenInput?.value || "").trim();
  if (fromInput) {
    return fromInput;
  }
  return String(localStorage.getItem(ADMIN_TOKEN_KEY) || "").trim();
}

function getAdminHeaders() {
  const token = getAdminToken();
  if (!token) {
    return {};
  }
  return { "x-admin-token": token };
}

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
}

function pointsClass(value) {
  const num = Number(value || 0);
  if (num > 0) return "points points-positive";
  if (num < 0) return "points points-negative";
  return "points";
}

function renderStandings(data) {
  seasonLabelEl.textContent = data.seasonLabel || "-";
  periodLabelEl.textContent = data.periodLabel || "-";
  updatedAtEl.textContent = data.updatedAt ? `Uppdaterad: ${new Date(data.updatedAt).toLocaleString("sv-SE")}` : "-";

  listEl.innerHTML = "";

  const header = document.createElement("div");
  header.className = "row header";
  header.style.gridTemplateColumns = "72px 1fr 96px 96px";
  header.innerHTML = "<div>Plac</div><div>Deltagare</div><div>Poang</div><div>Delta</div>";
  listEl.appendChild(header);

  const rows = Array.isArray(data.standings) ? data.standings : [];
  for (const rowData of rows) {
    const row = document.createElement("div");
    row.className = "row";
    row.style.gridTemplateColumns = "72px 1fr 96px 96px";
    row.innerHTML = `
      <div class="rank">${Number(rowData.rank || 0)}</div>
      <div class="name">${rowData.name || "-"}</div>
      <div class="points">${Number(rowData.points || 0)}</div>
      <div class="${pointsClass(rowData.delta)}">${Number(rowData.delta || 0)}</div>
    `;
    listEl.appendChild(row);
  }
}

function renderStale(meta) {
  if (!staleStatusEl) {
    return;
  }
  staleStatusEl.textContent = meta?.isStale
    ? `Data stale (${Number(meta.ageMinutes || 0)} min)`
    : `Data fresh (${Number(meta?.ageMinutes || 0)} min)`;
}

async function loadSchedulerStatus() {
  const response = await fetch("/api/playoffs/scheduler/status");
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(body.error || "Scheduler status misslyckades");
  }
  const status = body.data || {};
  schedulerEl.textContent = `Nasta 09:00-korning: ${status.nextRun ? new Date(status.nextRun).toLocaleString("sv-SE") : "-"}`;
}

async function loadStallning() {
  try {
    setStatus("Laddar stallningen...");

    const [standingsRes] = await Promise.all([fetch("/api/playoffs/stallning"), loadSchedulerStatus()]);
    const standingsBody = await standingsRes.json();
    if (!standingsRes.ok || !standingsBody.ok) {
      throw new Error(standingsBody.error || "Kunde inte lasa stallningen");
    }

    renderStandings(standingsBody.data || {});
    renderStale(standingsBody.meta || {});
    setStatus("Valmis");
  } catch (error) {
    setStatus(`Virhe: ${String(error.message || error)}`);
  }
}

runNowBtn?.addEventListener("click", async () => {
  try {
    runNowBtn.disabled = true;
    setStatus("Ajetaan scheduler...");
    const response = await fetch("/api/playoffs/scheduler/run-now", {
      method: "POST",
      headers: getAdminHeaders(),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Manuell korning misslyckades");
    }
    await loadStallning();
  } catch (error) {
    setStatus(`Virhe: ${String(error.message || error)}`);
  } finally {
    runNowBtn.disabled = false;
  }
});

adminTokenInput?.addEventListener("change", () => {
  localStorage.setItem(ADMIN_TOKEN_KEY, String(adminTokenInput.value || "").trim());
});

if (adminTokenInput) {
  adminTokenInput.value = String(localStorage.getItem(ADMIN_TOKEN_KEY) || "");
}

loadStallning();
