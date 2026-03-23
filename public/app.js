const seasonInput = document.getElementById("seasonInput");
const compareDateInput = document.getElementById("compareDateInput");
const saveDateBtn = document.getElementById("saveDateBtn");
const loadBtn = document.getElementById("loadBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const comparePointsHeader = document.getElementById("comparePointsHeader");
const savedDateInfo = document.getElementById("savedDateInfo");
const fetchInfo = document.getElementById("fetchInfo");

function setStatus(text) {
  statusEl.textContent = text;
}

function setSavedDateInfo(dateValue) {
  if (!savedDateInfo) {
    return;
  }
  savedDateInfo.textContent = `Tallennettu oletuspäivä: ${dateValue || "-"}`;
}

function setFetchInfo(cache) {
  if (!fetchInfo) {
    return;
  }

  const fetchedAt = cache?.fetchedAt ? new Date(cache.fetchedAt) : null;
  const timeText = fetchedAt && !Number.isNaN(fetchedAt.getTime())
    ? fetchedAt.toLocaleString("fi-FI")
    : "-";
  const sourceText = cache?.hit ? "cache" : "uusi haku";
  fetchInfo.textContent = `Viimeksi haettu: ${timeText} (${sourceText})`;
}

function flashSavedDateSuccess() {
  if (!savedDateInfo) {
    return;
  }

  savedDateInfo.classList.remove("flash-success");
  requestAnimationFrame(() => {
    savedDateInfo.classList.add("flash-success");
    setTimeout(() => {
      savedDateInfo.classList.remove("flash-success");
    }, 1400);
  });
}

function formatMatchStrategy(strategy) {
  if (strategy === "team_exact") {
    return "team_exact";
  }
  if (strategy === "team_fallback") {
    return "team_fallback";
  }
  if (strategy === "team_fuzzy_fallback") {
    return "team_fuzzy_fallback";
  }
  if (strategy === "id_direct") {
    return "id_direct";
  }
  return strategy || "";
}

function formatDelta(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "";
  }
  const numeric = Number(value);
  if (numeric > 0) {
    return `+${numeric}`;
  }
  return String(numeric);
}

function renderRows(items) {
  rowsEl.innerHTML = "";

  const sortedItems = [...items].sort((left, right) => Number(left?.rowNumber ?? 0) - Number(right?.rowNumber ?? 0));
  const goalies = sortedItems.filter((item) => item.isGoalie === true);
  const others = sortedItems.filter((item) => item.isGoalie !== true);

  function appendSectionRow(title) {
    const tr = document.createElement("tr");
    tr.classList.add("section-row");
    const td = document.createElement("td");
    td.colSpan = 14;
    td.textContent = title;
    tr.appendChild(td);
    rowsEl.appendChild(tr);
  }

  function appendDataRow(item) {
    const tr = document.createElement("tr");
    if (item.status !== "ok") {
      tr.classList.add("error-row");
    } else if (item.matchStrategy === "team_exact" || item.matchStrategy === "id_direct") {
      tr.classList.add("match-exact-row");
    } else if (item.matchStrategy === "team_fallback") {
      tr.classList.add("match-fallback-row");
    } else if (item.matchStrategy === "team_fuzzy_fallback") {
      tr.classList.add("match-fuzzy-row");
    }

    const values = [
      item.rowNumber ?? "",
      item.fullName || item.inputName || "",
      item.inputTeam || "",
      item.teamAbbrev || "",
      item.isActive === undefined ? "" : item.isActive ? "yes" : "no",
      item.gamesPlayed ?? "",
      item.goals ?? "",
      item.assists ?? "",
      item.todayPoints ?? item.points ?? "",
      item.comparePoints ?? "",
      formatDelta(item.deltaPoints),
      formatMatchStrategy(item.matchStrategy),
      item.status || "",
      item.error || "",
    ];

    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.appendChild(td);
    }

    rowsEl.appendChild(tr);
  }

  if (goalies.length) {
    appendSectionRow("Maalivahdit");
    for (const item of goalies) {
      appendDataRow(item);
    }
  }

  if (others.length) {
    appendSectionRow(goalies.length ? "Kenttäpelaajat ja muut" : "Pelaajat");
    for (const item of others) {
      appendDataRow(item);
    }
  }
}

function toCellValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return String(value);
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    return;
  }

  const data = await response.json();
  if (data?.compareDate) {
    compareDateInput.value = data.compareDate;
    comparePointsHeader.textContent = `P ${data.compareDate}`;
    setSavedDateInfo(data.compareDate);
  }
}

async function saveDefaultCompareDate() {
  const compareDate = compareDateInput.value;
  if (!compareDate) {
    setStatus("Valitse vertailupäivä ennen tallennusta.");
    return;
  }

  const response = await fetch("/api/settings/compare-date", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ compareDate }),
  });

  const data = await response.json();
  if (!response.ok) {
    setStatus(`Päivämäärän tallennus epäonnistui: ${data.error || "Tuntematon virhe"}`);
    return;
  }

  comparePointsHeader.textContent = `P ${data.compareDate}`;
  setSavedDateInfo(data.compareDate);
  flashSavedDateSuccess();
  setStatus(`Oletusvertailupäivä tallennettu: ${data.compareDate}`);
}

async function loadStats(options = {}) {
  const { forceRefresh = false } = options;
  const seasonId = seasonInput.value.trim();
  const compareDate = compareDateInput.value;

  if (!compareDate) {
    setStatus("Valitse vertailupäivä.");
    return;
  }

  setStatus(
    forceRefresh
      ? "Pakotettu päivitys käynnissä (ohitetaan cache)..."
      : "Haetaan tämän päivän ja vertailupäivän pisteet NHL API:sta..."
  );
  rowsEl.innerHTML = "";
  comparePointsHeader.textContent = `P ${compareDate}`;

  const params = new URLSearchParams({ seasonId, compareDate });
  if (forceRefresh) {
    params.set("forceRefresh", "true");
  }
  const response = await fetch(`/api/players-stats-compare?${params.toString()}`);
  const data = await response.json();

  if (!response.ok) {
    setStatus(`Virhe: ${data.error || "Tuntematon virhe"}`);
    return;
  }

  const items = data.items || [];
  const okCount = items.filter((item) => item.status === "ok").length;
  renderRows(items);
  setFetchInfo(data.cache);
  setStatus(
    `Valmis. Tiedosto: ${data.file}, rivit: ${data.totalRows}, ok: ${okCount}/${items.length}, vertailupäivä: ${
      data.compareDate || compareDate
    }`
  );
}

loadBtn.addEventListener("click", loadStats);
refreshBtn.addEventListener("click", () => {
  loadStats({ forceRefresh: true }).catch((error) => {
    setStatus(`Pakotettu päivitys epäonnistui: ${error.message}`);
  });
});
saveDateBtn.addEventListener("click", () => {
  saveDefaultCompareDate().catch((error) => {
    setStatus(`Päivämäärän tallennus epäonnistui: ${error.message}`);
  });
});
loadSettings().catch((error) => {
  setStatus(`Virhe asetusten haussa: ${error.message}`);
});
loadStats().catch((error) => {
  setStatus(`Virhe tilastojen haussa: ${error.message}`);
});
