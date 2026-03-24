const seasonInput = document.getElementById("seasonInput");
const compareDateInput = document.getElementById("compareDateInput");
const competitionTypeSelect = document.getElementById("competitionTypeSelect");
const rankingFromInput = document.getElementById("rankingFromInput");
const rankingToInput = document.getElementById("rankingToInput");
const saveDateBtn = document.getElementById("saveDateBtn");
const saveCompetitionTypeBtn = document.getElementById("saveCompetitionTypeBtn");
const saveRankingWindowBtn = document.getElementById("saveRankingWindowBtn");
const savePeriodWindowsBtn = document.getElementById("savePeriodWindowsBtn");
const initializeSetupBtn = document.getElementById("initializeSetupBtn");
const lockSetupBtn = document.getElementById("lockSetupBtn");
const overrideToggle = document.getElementById("overrideToggle");
const overrideReasonInput = document.getElementById("overrideReasonInput");
const refreshAuditBtn = document.getElementById("refreshAuditBtn");
const periodWindowsContainer = document.getElementById("periodWindowsContainer");
const setupInfo = document.getElementById("setupInfo");
const auditLog = document.getElementById("auditLog");
const loadBtn = document.getElementById("loadBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusEl = document.getElementById("status");
const rowsEl = document.getElementById("rows");
const comparePointsHeader = document.getElementById("comparePointsHeader");
const savedDateInfo = document.getElementById("savedDateInfo");
const rankingWindowInfo = document.getElementById("rankingWindowInfo");
const fetchInfo = document.getElementById("fetchInfo");
let rankingWindowsState = {
  stanley_cup: { rankingFrom: "", rankingTo: "" },
  autumn: { rankingFrom: "", rankingTo: "" },
};
let periodCalendarsState = {
  stanley_cup: { periodWindows: [], setupState: "draft", lockMetadata: { lockedAt: "", lockedBy: "" }, expectedPeriodCount: 2 },
  autumn: { periodWindows: [], setupState: "draft", lockMetadata: { lockedAt: "", lockedBy: "" }, expectedPeriodCount: 3 },
};

function setStatus(text) {
  statusEl.textContent = text;
}

function setSavedDateInfo(dateValue) {
  if (!savedDateInfo) {
    return;
  }
  savedDateInfo.textContent = `Tallennettu oletuspäivä: ${dateValue || "-"}`;
}

function toCompetitionLabel(type) {
  return type === "autumn" ? "Syksyn veikkaus" : "Stanley Cup";
}

function setRankingWindowInfo(competitionType, rankingWindow) {
  if (!rankingWindowInfo) {
    return;
  }
  const label = toCompetitionLabel(competitionType);
  const rankingFrom = rankingWindow?.rankingFrom || "-";
  const rankingTo = rankingWindow?.rankingTo || "-";
  rankingWindowInfo.textContent = `${label} ranking-ikkuna: ${rankingFrom} - ${rankingTo}`;
}

function applyRankingWindowToInputs(competitionType) {
  const selected = String(competitionType || "stanley_cup");
  const rankingWindow = rankingWindowsState[selected];
  if (!rankingWindow) {
    return;
  }
  rankingFromInput.value = rankingWindow.rankingFrom || "";
  rankingToInput.value = rankingWindow.rankingTo || "";
  setRankingWindowInfo(selected, rankingWindow);
}

function getExpectedPeriodCountForCompetition(competitionType) {
  return competitionType === "autumn" ? 3 : 2;
}

function getPeriodWindowsFromInputs(competitionType) {
  const expectedCount = getExpectedPeriodCountForCompetition(competitionType);
  const rows = [];
  for (let periodNumber = 1; periodNumber <= expectedCount; periodNumber += 1) {
    const startInput = document.getElementById(`period-${periodNumber}-start`);
    const endInput = document.getElementById(`period-${periodNumber}-end`);
    rows.push({
      periodNumber,
      label: `P${periodNumber}`,
      startDate: String(startInput?.value || "").trim(),
      endDate: String(endInput?.value || "").trim(),
      isFinal: periodNumber === expectedCount,
    });
  }
  return rows;
}

function renderPeriodWindowInputs(competitionType) {
  const selected = String(competitionType || "stanley_cup");
  const expectedCount = getExpectedPeriodCountForCompetition(selected);
  const setup = periodCalendarsState[selected] || {};
  const currentWindows = Array.isArray(setup.periodWindows) ? setup.periodWindows : [];

  periodWindowsContainer.innerHTML = "";
  for (let periodNumber = 1; periodNumber <= expectedCount; periodNumber += 1) {
    const current = currentWindows.find((item) => Number(item?.periodNumber) === periodNumber) || {};
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "60px 1fr 1fr 100px";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.innerHTML = `
      <div style="font-weight:700;">P${periodNumber}</div>
      <input id="period-${periodNumber}-start" type="date" value="${String(current.startDate || "")}" />
      <input id="period-${periodNumber}-end" type="date" value="${String(current.endDate || "")}" />
      <div style="font-size:12px; color:#4f5f53;">${periodNumber === expectedCount ? "final" : "regular"}</div>
    `;
    periodWindowsContainer.appendChild(row);
  }

  const lockMetadata = setup.lockMetadata || {};
  setupInfo.textContent = `Setup state: ${setup.setupState || "draft"} | lockedAt: ${lockMetadata.lockedAt || "-"} | lockedBy: ${lockMetadata.lockedBy || "-"}`;
}

function buildOverridePayload() {
  const override = Boolean(overrideToggle?.checked);
  const reason = String(overrideReasonInput?.value || "").trim();
  return { override, reason };
}

function renderAuditEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    auditLog.textContent = "Ei audit-merkintöjä.";
    return;
  }

  const lines = entries.map((entry) => {
    const ts = entry.created_at || "-";
    const actor = entry.actor || "unknown";
    const key = entry.setting_key || "-";
    const oldValue = entry.old_value || "";
    const newValue = entry.new_value || "";
    const overrideUsed = Number(entry.override_used) === 1 ? "override" : "normal";
    return `${ts} | ${actor} | ${key} | ${overrideUsed}\n  old: ${oldValue}\n  new: ${newValue}`;
  });

  auditLog.textContent = lines.join("\n\n");
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

  const activeCompetitionType = data?.competitionType || "stanley_cup";
  competitionTypeSelect.value = activeCompetitionType;

  const rankingWindows = data?.rankingWindows || {};
  rankingWindowsState = {
    stanley_cup: rankingWindows.stanley_cup || data?.rankingWindow || { rankingFrom: "", rankingTo: "" },
    autumn: rankingWindows.autumn || { rankingFrom: "", rankingTo: "" },
  };

  const calendars = data?.periodCalendars || {};
  periodCalendarsState = {
    stanley_cup: calendars.stanley_cup || periodCalendarsState.stanley_cup,
    autumn: calendars.autumn || periodCalendarsState.autumn,
  };

  applyRankingWindowToInputs(activeCompetitionType);
  renderPeriodWindowInputs(activeCompetitionType);
}

async function saveCompetitionType() {
  const competitionType = String(competitionTypeSelect.value || "").trim();
  const response = await fetch("/api/settings/competition-type", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ competitionType }),
  });

  const data = await response.json();
  if (!response.ok) {
    setStatus(`Aktiivisen veikkauksen tallennus epäonnistui: ${data.error || "Tuntematon virhe"}`);
    return;
  }

  competitionTypeSelect.value = data.competitionType;
  rankingWindowsState[data.competitionType] = data.rankingWindow;
  if (data.periodCalendar) {
    periodCalendarsState[data.competitionType] = data.periodCalendar;
  }
  applyRankingWindowToInputs(data.competitionType);
  renderPeriodWindowInputs(data.competitionType);
  await refreshSettingsAudit();
  setStatus(`Aktiivinen veikkaus tallennettu: ${toCompetitionLabel(data.competitionType)}`);
}

async function saveRankingWindow() {
  const competitionType = String(competitionTypeSelect.value || "").trim();
  const rankingFrom = String(rankingFromInput.value || "").trim();
  const rankingTo = String(rankingToInput.value || "").trim();
  const { override, reason } = buildOverridePayload();

  const response = await fetch("/api/settings/ranking-window", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ competitionType, rankingFrom, rankingTo, override, reason }),
  });

  const data = await response.json();
  if (!response.ok) {
    setStatus(`Ranking-ikkunan tallennus epäonnistui: ${data.error || "Tuntematon virhe"}`);
    return;
  }

  rankingWindowsState[data.competitionType] = {
    rankingFrom: data.rankingFrom,
    rankingTo: data.rankingTo,
  };
  if (periodCalendarsState[data.competitionType]) {
    periodCalendarsState[data.competitionType].setupState = data.setupState || periodCalendarsState[data.competitionType].setupState;
  }
  applyRankingWindowToInputs(data.competitionType);
  renderPeriodWindowInputs(competitionTypeSelect.value);
  setStatus(
    `${toCompetitionLabel(data.competitionType)} ranking-ikkuna tallennettu: ${data.rankingFrom} - ${data.rankingTo}`
  );
}

async function savePeriodWindows() {
  const competitionType = String(competitionTypeSelect.value || "").trim();
  const periodWindows = getPeriodWindowsFromInputs(competitionType);
  const { override, reason } = buildOverridePayload();

  const response = await fetch("/api/settings/period-windows", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ competitionType, periodWindows, override, reason }),
  });

  const data = await response.json();
  if (!response.ok) {
    setStatus(`Periodi-ikkunoiden tallennus epäonnistui: ${data.error || "Tuntematon virhe"}`);
    return;
  }

  periodCalendarsState[data.competitionType] = {
    ...(periodCalendarsState[data.competitionType] || {}),
    periodWindows: data.periodWindows || [],
    setupState: data.setupState || "draft",
    lockMetadata: data.lockMetadata || { lockedAt: "", lockedBy: "" },
  };
  renderPeriodWindowInputs(data.competitionType);
  setStatus(`${toCompetitionLabel(data.competitionType)} periodi-ikkunat tallennettu.`);
}

async function runSetupAction(action) {
  const competitionType = String(competitionTypeSelect.value || "").trim();
  const { override, reason } = buildOverridePayload();

  const response = await fetch("/api/settings/setup-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ competitionType, action, override, reason }),
  });

  const data = await response.json();
  if (!response.ok) {
    setStatus(`Setup-toiminto epäonnistui: ${data.error || "Tuntematon virhe"}`);
    return;
  }

  periodCalendarsState[data.competitionType] = {
    ...(periodCalendarsState[data.competitionType] || {}),
    periodWindows: data.periodWindows || [],
    setupState: data.setupState || "draft",
    lockMetadata: data.lockMetadata || { lockedAt: "", lockedBy: "" },
  };
  renderPeriodWindowInputs(data.competitionType);
  setStatus(`${toCompetitionLabel(data.competitionType)} setup action '${action}' onnistui.`);
}

async function refreshSettingsAudit() {
  const competitionType = String(competitionTypeSelect.value || "").trim();
  const response = await fetch(`/api/settings/audit?competitionType=${encodeURIComponent(competitionType)}&limit=30`);
  const data = await response.json();
  if (!response.ok) {
    setStatus(`Audit-lokin haku epäonnistui: ${data.error || "Tuntematon virhe"}`);
    return;
  }

  renderAuditEntries(data.entries || []);
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
saveCompetitionTypeBtn.addEventListener("click", () => {
  saveCompetitionType().catch((error) => {
    setStatus(`Aktiivisen veikkauksen tallennus epäonnistui: ${error.message}`);
  });
});
competitionTypeSelect.addEventListener("change", () => {
  const selected = String(competitionTypeSelect.value || "stanley_cup");
  applyRankingWindowToInputs(selected);
  renderPeriodWindowInputs(selected);
  refreshSettingsAudit().catch((error) => {
    setStatus(`Audit-lokin haku epäonnistui: ${error.message}`);
  });
});
saveRankingWindowBtn.addEventListener("click", () => {
  saveRankingWindow().catch((error) => {
    setStatus(`Ranking-ikkunan tallennus epäonnistui: ${error.message}`);
  });
});
savePeriodWindowsBtn.addEventListener("click", () => {
  savePeriodWindows().catch((error) => {
    setStatus(`Periodi-ikkunoiden tallennus epäonnistui: ${error.message}`);
  });
});
initializeSetupBtn.addEventListener("click", () => {
  runSetupAction("initialize").catch((error) => {
    setStatus(`Setup initialize epäonnistui: ${error.message}`);
  });
});
lockSetupBtn.addEventListener("click", () => {
  runSetupAction("lock").catch((error) => {
    setStatus(`Setup lock epäonnistui: ${error.message}`);
  });
});
refreshAuditBtn.addEventListener("click", () => {
  refreshSettingsAudit().catch((error) => {
    setStatus(`Audit-lokin haku epäonnistui: ${error.message}`);
  });
});
loadSettings()
  .then(() => refreshSettingsAudit())
  .catch((error) => {
    setStatus(`Virhe asetusten haussa: ${error.message}`);
  });
loadStats().catch((error) => {
  setStatus(`Virhe tilastojen haussa: ${error.message}`);
});
