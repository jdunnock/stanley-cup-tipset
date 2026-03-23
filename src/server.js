import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createStallningScheduler } from "./stallning-scheduler.js";

const port = Number(process.env.PORT || 3000);
const publicDir = path.resolve(process.cwd(), "public");
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || "").trim();
const STALE_AFTER_MINUTES = Number(process.env.PLAYOFFS_STALE_AFTER_MINUTES || 24 * 60);
const PLAYOFF_RULESET_VERSION = "playoff-simple-v1";

const scheduler = createStallningScheduler({ hour: 9, minute: 0 });
scheduler.start();

const mockLagen = {
  seasonLabel: "Stanley Cup 2026",
  updatedAt: new Date().toISOString(),
  teams: [
    {
      participant: "Jarmo",
      totalPoints: 84,
      players: [
        { name: "Aho (CAR)", series: "CAR-NJD", points: 22 },
        { name: "Makar (COL)", series: "COL-DAL", points: 18 },
        { name: "Shesterkin (NYR)", series: "NYR-TBL", points: 16 },
      ],
    },
    {
      participant: "Fredrik",
      totalPoints: 79,
      players: [
        { name: "McDavid (EDM)", series: "EDM-VGK", points: 25 },
        { name: "Hughes (VAN)", series: "VAN-LAK", points: 17 },
        { name: "Fox (NYR)", series: "NYR-TBL", points: 13 },
      ],
    },
  ],
};

const mockStallning = {
  seasonLabel: "Stanley Cup 2026",
  periodLabel: "Runda 1",
  updatedAt: new Date().toISOString(),
  standings: [
    { rank: 1, name: "Jarmo", points: 84, delta: 12 },
    { rank: 2, name: "Fredrik", points: 79, delta: 10 },
    { rank: 3, name: "Joakim", points: 71, delta: 7 },
    { rank: 4, name: "Timmy", points: 66, delta: 5 },
  ],
};

const mockNyheter = {
  seasonLabel: "Stanley Cup 2026",
  updatedAt: new Date().toISOString(),
  lead: "Runda 1 har startat vahvasti ja karki on edelleen tiukka.",
  spotlights: [
    { label: "Formstark", value: "McDavid (EDM)", note: "+8 poang senaste tre matcher" },
    { label: "Mest noussut", value: "Jarmo", note: "+12 paivan paivityksessa" },
    { label: "Tiukin taisto", value: "Sija 2-4", note: "Vain 13 poang valissa" },
  ],
};

function toIsoDate(input) {
  const value = new Date(input || Date.now());
  if (Number.isNaN(value.getTime())) {
    return new Date().toISOString();
  }
  return value.toISOString();
}

function minutesSince(isoDate) {
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - ts) / 60_000));
}

function buildMeta({ source, updatedAt }) {
  const normalizedUpdatedAt = toIsoDate(updatedAt);
  const ageMinutes = minutesSince(normalizedUpdatedAt);
  const staleAfterMinutes = STALE_AFTER_MINUTES;
  const isStale = ageMinutes === null ? false : ageMinutes > staleAfterMinutes;

  return {
    source,
    updatedAt: normalizedUpdatedAt,
    staleAfterMinutes,
    ageMinutes,
    isStale,
    rulesetVersion: PLAYOFF_RULESET_VERSION,
  };
}

function playoffsResponse(data, source) {
  return {
    ok: true,
    data,
    meta: buildMeta({ source, updatedAt: data?.updatedAt }),
  };
}

function readAdminToken(req) {
  return String(req.headers["x-admin-token"] || "").trim();
}

function ensureAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    return true;
  }

  if (readAdminToken(req) !== ADMIN_TOKEN) {
    json(res, 403, { ok: false, error: "Forbidden: invalid admin token" });
    return false;
  }

  return true;
}

function json(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const normalizedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const absolutePath = path.resolve(publicDir, `.${normalizedPath}`);

  if (!absolutePath.startsWith(publicDir)) {
    json(res, 403, { ok: false, error: "Forbidden" });
    return true;
  }

  try {
    const content = await readFile(absolutePath);
    res.writeHead(200, {
      "Content-Type": contentTypeFor(absolutePath),
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

async function handleApi(req, res) {
  const method = req.method || "GET";
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, service: "stanley-cup-tipset" });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/playoffs/lagen") {
    json(res, 200, playoffsResponse(mockLagen, "mock:l-rules"));
    return true;
  }

  if (method === "GET" && url.pathname === "/api/playoffs/stallning") {
    json(res, 200, playoffsResponse(mockStallning, "mock:standings"));
    return true;
  }

  if (method === "GET" && url.pathname === "/api/playoffs/nyheter") {
    json(res, 200, playoffsResponse(mockNyheter, "mock:news"));
    return true;
  }

  if (method === "GET" && url.pathname === "/api/playoffs/scheduler/status") {
    json(res, 200, {
      ok: true,
      data: scheduler.getStatus(),
      meta: {
        rulesetVersion: PLAYOFF_RULESET_VERSION,
      },
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/playoffs/scheduler/run-now") {
    if (!ensureAdmin(req, res)) {
      return true;
    }
    const result = await scheduler.runNow();
    json(res, 200, {
      ok: true,
      data: result,
      meta: {
        rulesetVersion: PLAYOFF_RULESET_VERSION,
      },
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/playoffs/validator/files") {
    if (!ensureAdmin(req, res)) {
      return true;
    }
    const files = ["playoff-rosters-2026-round1.xlsx", "playoff-rosters-2026-round2.xlsx"];
    json(res, 200, {
      ok: true,
      files,
      data: { files },
      meta: {
        source: "mock:validator-files",
        rulesetVersion: PLAYOFF_RULESET_VERSION,
      },
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/playoffs/validator/validate-team") {
    if (!ensureAdmin(req, res)) {
      return true;
    }

    const body = await parseRequestBody(req);
    const errors = [];
    const warnings = [];

    const participantName = String(body.participantName || "").trim();
    const file = String(body.file || "").trim();
    const rosterText = String(body.rosterText || "").trim();
    const players = rosterText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const invalidFormatRows = [];
    const duplicateNames = [];
    const seenNames = new Set();
    const teams = new Set();

    for (const rawLine of players) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      const match = line.match(/^(.+?)\s*\(([A-Z]{2,4})\)$/);
      if (!match) {
        invalidFormatRows.push(rawLine);
        continue;
      }

      const normalizedName = match[1].toLowerCase();
      if (seenNames.has(normalizedName)) {
        duplicateNames.push(match[1]);
      }
      seenNames.add(normalizedName);
      teams.add(match[2]);
    }

    if (!participantName) {
      errors.push("participantName puuttuu.");
    }
    if (participantName.length < 2) {
      errors.push("participantName on liian lyhyt.");
    }
    if (!file) {
      errors.push("file puuttuu.");
    }
    if (file && !file.endsWith(".xlsx")) {
      errors.push("file paatteen tulee olla .xlsx.");
    }
    if (players.length < 3) {
      errors.push("Rivimaara liian pieni. Anna vahintaan 3 pelaajaa.");
    }
    if (players.length > 12) {
      warnings.push("Pelaajia on poikkeuksellisen paljon. Tarkista kokoonpanon rajat.");
    }
    if (invalidFormatRows.length > 0) {
      errors.push("Kaikki roster-rivit eivat ole muodossa 'Nimi (JOUKKUE)'.");
    }
    if (duplicateNames.length > 0) {
      errors.push("Rosterissa on duplikaattipelaajia.");
    }
    if (teams.size > 0 && teams.size < 2) {
      warnings.push("Rosterissa on vain yksi joukkuekoodi. Tarkista playoff-jakauma.");
    }

    const expectedRoundFromFile = file.match(/round(\d+)/i)?.[1] || null;
    if (!expectedRoundFromFile) {
      warnings.push("Tiedoston nimesta ei voitu paatella playoff-kierrosta.");
    }

    const result = {
      status: errors.length === 0 ? "PASS" : "FAIL",
      errors,
      warnings,
      diagnostics: {
        participantName,
        parsedPlayers: players.length,
        uniqueTeams: teams.size,
        duplicatePlayers: duplicateNames,
        invalidRows: invalidFormatRows,
        expectedRoundFromFile,
        file,
        rulesetVersion: PLAYOFF_RULESET_VERSION,
      },
    };

    json(res, 200, {
      ok: true,
      result,
      meta: {
        source: "validator:manual",
        rulesetVersion: PLAYOFF_RULESET_VERSION,
      },
    });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const handledByApi = await handleApi(req, res);
    if (handledByApi) {
      return;
    }

    const handledByStatic = await serveStatic(req, res);
    if (handledByStatic) {
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    json(res, 500, { ok: false, error: String(error?.message || error) });
  }
});

server.listen(port, () => {
  console.log(`stanley-cup-tipset listening on :${port}`);
});
