const statusEl = document.getElementById("status");
const seasonLabelEl = document.getElementById("seasonLabel");
const updatedAtEl = document.getElementById("updatedAt");
const staleStatusEl = document.getElementById("staleStatus");
const leadEl = document.getElementById("lead");
const spotlightsEl = document.getElementById("spotlights");

function setStatus(text) {
  if (!statusEl) return;
  statusEl.textContent = text;
}

function render(data, meta) {
  seasonLabelEl.textContent = data.seasonLabel || "-";
  updatedAtEl.textContent = data.updatedAt ? `Uppdaterad: ${new Date(data.updatedAt).toLocaleString("sv-SE")}` : "-";
  if (staleStatusEl) {
    staleStatusEl.textContent = meta?.isStale
      ? `Data stale (${Number(meta.ageMinutes || 0)} min)`
      : `Data fresh (${Number(meta?.ageMinutes || 0)} min)`;
  }
  leadEl.textContent = data.lead || "-";

  const items = Array.isArray(data.spotlights) ? data.spotlights : [];
  spotlightsEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = `${item.label}: ${item.value} (${item.note})`;
    spotlightsEl.appendChild(li);
  }
}

async function loadNyheter() {
  try {
    setStatus("Laddar nyheter...");
    const response = await fetch("/api/playoffs/nyheter");
    const body = await response.json();
    if (!response.ok || !body.ok) {
      throw new Error(body.error || "Kunde inte lasa nyheter");
    }
    render(body.data || {}, body.meta || {});
    setStatus("Valmis");
  } catch (error) {
    setStatus(`Virhe: ${String(error.message || error)}`);
  }
}

loadNyheter();
