const statusEl = document.getElementById("status");
const seasonLabelEl = document.getElementById("seasonLabel");
const updatedAtEl = document.getElementById("updatedAt");
const staleStatusEl = document.getElementById("staleStatus");
const lagenBodyEl = document.getElementById("lagenBody");

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
}

function render(data, meta) {
  if (!lagenBodyEl) return;

  seasonLabelEl.textContent = data.seasonLabel || "-";
  updatedAtEl.textContent = data.updatedAt ? `Uppdaterad: ${new Date(data.updatedAt).toLocaleString("sv-SE")}` : "-";
  if (staleStatusEl) {
    staleStatusEl.textContent = meta?.isStale
      ? `Data stale (${Number(meta.ageMinutes || 0)} min)`
      : `Data fresh (${Number(meta?.ageMinutes || 0)} min)`;
  }

  lagenBodyEl.innerHTML = "";
  const teams = Array.isArray(data.teams) ? data.teams : [];

  for (const team of teams) {
    const players = Array.isArray(team.players) ? team.players : [];
    for (const player of players) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${team.participant || "-"}</td>
        <td>${player.name || "-"}</td>
        <td>${player.series || "-"}</td>
        <td>${Number(player.points ?? 0)}</td>
      `;
      lagenBodyEl.appendChild(tr);
    }
  }
}

async function loadLagen() {
  try {
    setStatus("Laddar lagen...");
    const response = await fetch("/api/playoffs/lagen");
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Kunde inte lasa lagen");
    }
    render(body.data || {}, body.meta || {});
    setStatus("Valmis");
  } catch (error) {
    setStatus(`Virhe: ${String(error.message || error)}`);
  }
}

loadLagen();
