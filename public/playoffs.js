const bracketBoardEl = document.getElementById("bracketBoard");
const westGridEl = document.getElementById("westGrid");
const eastGridEl = document.getElementById("eastGrid");
const finalSlotEl = document.getElementById("finalSlot");
const finalContentEl = document.getElementById("finalContent");
const connectorLayerEl = document.getElementById("connectorLayer");
const seasonChipEl = document.getElementById("seasonChip");
const statusChipEl = document.getElementById("statusChip");
let latestRounds = [];

function setStatus(text) {
  if (!statusChipEl) {
    return;
  }
  statusChipEl.textContent = text;
}

function setSeasonLabel(text) {
  if (!seasonChipEl) {
    return;
  }
  seasonChipEl.textContent = text;
}

function formatRoundLabel(round) {
  const label = String(round?.roundLabel ?? "").trim();
  if (label) {
    return label;
  }
  const roundNumber = Number(round?.roundNumber ?? 0);
  if (roundNumber > 0) {
    return `Round ${roundNumber}`;
  }
  return "Round";
}

function formatSeed(rankAbbrev, rank) {
  const abbrev = String(rankAbbrev ?? "").trim();
  if (abbrev) {
    return abbrev;
  }

  const rankValue = Number(rank ?? 0);
  if (rankValue > 0) {
    return `#${rankValue}`;
  }

  return "-";
}

function hasRealTeam(team) {
  return Boolean(String(team?.abbrev ?? "").trim() || String(team?.name ?? "").trim());
}

function hasRealSeries(series) {
  return hasRealTeam(series?.topSeedTeam) || hasRealTeam(series?.bottomSeedTeam);
}

function createTeamRow({ team, wins, seedText, isLeading }) {
  const row = document.createElement("div");
  row.className = "team-row";
  if (isLeading) {
    row.classList.add("leading");
  }

  const logo = document.createElement("img");
  logo.className = "logo";
  logo.loading = "lazy";
  logo.alt = `${team.name || team.abbrev || "Team"} logo`;
  if (team.logo) {
    logo.src = team.logo;
  }

  const teamMain = document.createElement("div");
  teamMain.className = "team-main";

  const teamBlock = document.createElement("div");
  teamBlock.className = "team-block";

  const teamName = document.createElement("div");
  teamName.className = "team-name";
  teamName.textContent = team.abbrev || team.commonName || team.name || "TBD";

  const teamSeed = document.createElement("div");
  teamSeed.className = "team-seed";
  teamSeed.textContent = seedText;

  teamBlock.appendChild(teamName);
  teamBlock.appendChild(teamSeed);

  teamMain.appendChild(logo);
  teamMain.appendChild(teamBlock);

  const winsEl = document.createElement("div");
  winsEl.className = "wins";
  winsEl.textContent = String(Number(wins ?? 0));

  row.appendChild(teamMain);
  row.appendChild(winsEl);

  return row;
}

function createSeriesCard(series, roundTag, fallbackLabel) {
  const card = document.createElement("article");
  card.className = "series-card";

  if (!hasRealSeries(series)) {
    card.classList.add("pending");
    card.innerHTML = `
      <div class="placeholder-core">
        <div class="placeholder-badge">⟡</div>
        <div>${roundTag}</div>
        <div class="series-letter">${fallbackLabel}</div>
      </div>
    `;
    return card;
  }

  const topWins = Number(series?.topSeedWins ?? 0);
  const bottomWins = Number(series?.bottomSeedWins ?? 0);

  const topLeading = topWins >= bottomWins;
  const bottomLeading = bottomWins >= topWins;

  const topRow = createTeamRow({
    team: series?.topSeedTeam ?? {},
    wins: topWins,
    seedText: formatSeed(series?.topSeedRankAbbrev, series?.topSeedRank),
    isLeading: topLeading,
  });

  const bottomRow = createTeamRow({
    team: series?.bottomSeedTeam ?? {},
    wins: bottomWins,
    seedText: formatSeed(series?.bottomSeedRankAbbrev, series?.bottomSeedRank),
    isLeading: bottomLeading,
  });

  const tag = document.createElement("div");
  tag.className = "series-round-tag";
  tag.textContent = roundTag;

  const seriesLetter = document.createElement("div");
  seriesLetter.className = "series-letter";
  seriesLetter.textContent = `Series ${String(series?.seriesLetter || "-")}`;

  const seriesStatus = document.createElement("div");
  seriesStatus.className = "series-status";
  seriesStatus.textContent = topWins === bottomWins ? `Tied ${topWins}-${bottomWins}` : `Leads ${Math.max(topWins, bottomWins)}-${Math.min(topWins, bottomWins)}`;

  card.appendChild(tag);
  card.appendChild(topRow);
  card.appendChild(bottomRow);
  card.appendChild(seriesLetter);
  card.appendChild(seriesStatus);

  return card;
}

function getRoundSeries(rounds, roundNumber) {
  const found = rounds.find((round) => Number(round?.roundNumber ?? 0) === roundNumber);
  return Array.isArray(found?.series) ? found.series : [];
}

function splitHalves(seriesList) {
  const middle = Math.ceil(seriesList.length / 2);
  return {
    left: seriesList.slice(0, middle),
    right: seriesList.slice(middle),
  };
}

function getSeriesAt(seriesList, index) {
  if (index < seriesList.length) {
    return seriesList[index];
  }
  return null;
}

function placeCardInGrid(gridEl, card, column, row, side, stage, index) {
  card.style.gridColumn = String(column);
  card.style.gridRow = String(row);
  card.dataset.side = side;
  card.dataset.stage = stage;
  card.dataset.index = String(index);
  gridEl.appendChild(card);
}

function renderSide(gridEl, side, roundsBySide) {
  const r1Rows = [1, 3, 5, 7];
  const r2Rows = [2, 6];
  const cfRow = 4;

  for (let index = 0; index < 4; index += 1) {
    const series = getSeriesAt(roundsBySide.r1, index);
    const card = createSeriesCard(series, "R1", "1st Round");
    const column = side === "west" ? 1 : 3;
    placeCardInGrid(gridEl, card, column, r1Rows[index], side, "r1", index);
  }

  for (let index = 0; index < 2; index += 1) {
    const series = getSeriesAt(roundsBySide.r2, index);
    const card = createSeriesCard(series, "R2", "2nd Round");
    placeCardInGrid(gridEl, card, 2, r2Rows[index], side, "r2", index);
  }

  const cfSeries = getSeriesAt(roundsBySide.r3, 0);
  const cfCard = createSeriesCard(cfSeries, "CF", "Conference Final");
  const cfColumn = side === "west" ? 3 : 1;
  placeCardInGrid(gridEl, cfCard, cfColumn, cfRow, side, "cf", 0);
}

function getCards(side, stage) {
  const pool = side === "west" ? westGridEl : eastGridEl;
  if (!pool) {
    return [];
  }

  return [...pool.querySelectorAll(`.series-card[data-side="${side}"][data-stage="${stage}"]`)].sort(
    (left, right) => Number(left.dataset.index ?? 0) - Number(right.dataset.index ?? 0)
  );
}

function drawElbow(startX, startY, endX, endY) {
  if (!connectorLayerEl) {
    return;
  }

  const middleX = startX + (endX - startX) * 0.55;
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", `M ${startX} ${startY} L ${middleX} ${startY} L ${middleX} ${endY} L ${endX} ${endY}`);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "var(--line-color)");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  connectorLayerEl.appendChild(path);
}

function drawConnections(side, fromCards, toCards, boardRect) {
  for (let index = 0; index < fromCards.length; index += 1) {
    const from = fromCards[index];
    const target = toCards[Math.floor(index / 2)];

    if (!from || !target) {
      continue;
    }

    const fromRect = from.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    if (side === "west") {
      drawElbow(
        fromRect.right - boardRect.left,
        fromRect.top - boardRect.top + fromRect.height / 2,
        targetRect.left - boardRect.left,
        targetRect.top - boardRect.top + targetRect.height / 2
      );
    } else {
      drawElbow(
        fromRect.left - boardRect.left,
        fromRect.top - boardRect.top + fromRect.height / 2,
        targetRect.right - boardRect.left,
        targetRect.top - boardRect.top + targetRect.height / 2
      );
    }
  }
}

function renderFinalSlot(finalSeries) {
  if (!finalContentEl || !finalSlotEl) {
    return;
  }

  if (!hasRealSeries(finalSeries)) {
    finalContentEl.textContent = "Stanley Cup Final";
    return;
  }

  finalContentEl.innerHTML = "";

  const matchup = document.createElement("div");
  matchup.className = "final-matchup";
  matchup.appendChild(
    createTeamRow({
      team: finalSeries.topSeedTeam ?? {},
      wins: finalSeries.topSeedWins,
      seedText: formatSeed(finalSeries.topSeedRankAbbrev, finalSeries.topSeedRank),
      isLeading: Number(finalSeries.topSeedWins ?? 0) >= Number(finalSeries.bottomSeedWins ?? 0),
    })
  );
  matchup.appendChild(
    createTeamRow({
      team: finalSeries.bottomSeedTeam ?? {},
      wins: finalSeries.bottomSeedWins,
      seedText: formatSeed(finalSeries.bottomSeedRankAbbrev, finalSeries.bottomSeedRank),
      isLeading: Number(finalSeries.bottomSeedWins ?? 0) >= Number(finalSeries.topSeedWins ?? 0),
    })
  );

  const status = document.createElement("div");
  status.className = "series-status";
  const topWins = Number(finalSeries.topSeedWins ?? 0);
  const bottomWins = Number(finalSeries.bottomSeedWins ?? 0);
  status.textContent = topWins === bottomWins ? `Final tied ${topWins}-${bottomWins}` : `Final lead ${Math.max(topWins, bottomWins)}-${Math.min(topWins, bottomWins)}`;

  finalContentEl.appendChild(matchup);
  finalContentEl.appendChild(status);
}

function drawConnectorLines() {
  if (!bracketBoardEl || !connectorLayerEl || !finalSlotEl) {
    return;
  }

  const boardRect = bracketBoardEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(boardRect.width));
  const height = Math.max(1, Math.round(boardRect.height));

  connectorLayerEl.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
  connectorLayerEl.setAttribute("width", String(width));
  connectorLayerEl.setAttribute("height", String(height));
  connectorLayerEl.innerHTML = "";

  const westR1 = getCards("west", "r1");
  const westR2 = getCards("west", "r2");
  const westCF = getCards("west", "cf");
  const eastR1 = getCards("east", "r1");
  const eastR2 = getCards("east", "r2");
  const eastCF = getCards("east", "cf");

  drawConnections("west", westR1, westR2, boardRect);
  drawConnections("west", westR2, westCF, boardRect);
  drawConnections("east", eastR1, eastR2, boardRect);
  drawConnections("east", eastR2, eastCF, boardRect);

  const finalRect = finalSlotEl.getBoundingClientRect();
  const westCfRect = westCF[0]?.getBoundingClientRect();
  const eastCfRect = eastCF[0]?.getBoundingClientRect();

  if (westCfRect) {
    drawElbow(
      westCfRect.right - boardRect.left,
      westCfRect.top - boardRect.top + westCfRect.height / 2,
      finalRect.left - boardRect.left,
      finalRect.top - boardRect.top + finalRect.height / 2
    );
  }

  if (eastCfRect) {
    drawElbow(
      eastCfRect.left - boardRect.left,
      eastCfRect.top - boardRect.top + eastCfRect.height / 2,
      finalRect.right - boardRect.left,
      finalRect.top - boardRect.top + finalRect.height / 2
    );
  }
}

function scheduleConnectorDraw() {
  requestAnimationFrame(() => {
    drawConnectorLines();
  });
}

function renderBracket(payload) {
  if (!westGridEl || !eastGridEl) {
    return;
  }

  westGridEl.querySelectorAll(".series-card").forEach((node) => node.remove());
  eastGridEl.querySelectorAll(".series-card").forEach((node) => node.remove());
  if (connectorLayerEl) {
    connectorLayerEl.innerHTML = "";
  }

  const rounds = Array.isArray(payload?.rounds) ? payload.rounds : [];
  latestRounds = rounds;

  const round1 = getRoundSeries(rounds, 1);
  const round2 = getRoundSeries(rounds, 2);
  const round3 = getRoundSeries(rounds, 3);
  const round4 = getRoundSeries(rounds, 4);

  const r1Halves = splitHalves(round1);
  const r2Halves = splitHalves(round2);
  const r3Halves = splitHalves(round3);

  renderSide(westGridEl, "west", {
    r1: r1Halves.right,
    r2: r2Halves.right,
    r3: r3Halves.right,
  });

  renderSide(eastGridEl, "east", {
    r1: r1Halves.left,
    r2: r2Halves.left,
    r3: r3Halves.left,
  });

  renderFinalSlot(round4[0] || null);
  scheduleConnectorDraw();
}

async function resolveDefaultYear() {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) {
      return String(new Date().getFullYear());
    }
    const data = await response.json();
    const compareDate = String(data?.compareDate ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(compareDate)) {
      return compareDate.slice(0, 4);
    }
  } catch {
    // Fall back to current year when settings endpoint is unavailable.
  }

  return String(new Date().getFullYear());
}

async function loadBracket() {
  try {
    setStatus("Loading...");

    const playoffYear = await resolveDefaultYear();
    const response = await fetch(`/api/playoff-bracket?year=${encodeURIComponent(playoffYear)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || "Unknown error");
    }

    renderBracket(data);

    const updatedTime = data?.fetchedAt
      ? new Date(data.fetchedAt).toLocaleTimeString("sv-SE", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

    setSeasonLabel(`Season ${data?.seasonId || "-"}`);
    setStatus(`Updated ${updatedTime}`);
  } catch (error) {
    setSeasonLabel("Season -");
    setStatus(`Error: ${error.message}`);
  }
}

setSeasonLabel("Season -");
loadBracket();

window.addEventListener("resize", () => {
  if (latestRounds.length > 0) {
    scheduleConnectorDraw();
  }
});
