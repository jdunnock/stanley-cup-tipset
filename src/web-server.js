import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { promises as fs } from "node:fs";
import { mkdirSync, statSync, copyFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const DEFAULT_COMPARE_DATE = "2026-01-24";
const TIPSEN_PLAYER_ROWS = [6, 7, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const NHL_API_BASE = "https://api-web.nhle.com/v1";
const RESPONSE_CACHE_SCHEMA_VERSION = "v3";
const DEPLOYMENT_CACHE_TOKEN = String(
  process.env.RESPONSE_CACHE_VERSION ?? process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.RAILWAY_DEPLOYMENT_CREATED_AT ?? ""
).trim();
const RESPONSE_CACHE_VERSION = DEPLOYMENT_CACHE_TOKEN
  ? `${RESPONSE_CACHE_SCHEMA_VERSION}:${DEPLOYMENT_CACHE_TOKEN}`
  : RESPONSE_CACHE_SCHEMA_VERSION;
const MCP_TOOL_TIMEOUT_MS = Number.parseInt(process.env.MCP_TOOL_TIMEOUT_MS ?? "20000", 10);
const PLAYER_FETCH_CONCURRENCY = Number.parseInt(
  process.env.PLAYER_FETCH_CONCURRENCY ?? (process.env.USE_MCP_BRIDGE ? "2" : "8"),
  10
);
const MCP_MIN_CALL_INTERVAL_MS = Number.parseInt(process.env.MCP_MIN_CALL_INTERVAL_MS ?? "350", 10);
const storageRoot =
  process.env.APP_STORAGE_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  rootDir;
const dataDir = path.join(storageRoot, "data");
const settingsDbPath = process.env.SETTINGS_DB_PATH || path.join(storageRoot, "app-settings.sqlite");
const useMcpBridge = String(
  process.env.USE_MCP_BRIDGE ?? (process.env.RAILWAY_ENVIRONMENT ? "false" : "true")
).toLowerCase() === "true";
const AUTO_REFRESH_MIN_HOUR_FI = Number.parseInt(process.env.AUTO_REFRESH_MIN_HOUR_FI ?? "9", 10);
const AUTO_REFRESH_SEASON_ID = String(process.env.AUTO_REFRESH_SEASON_ID ?? "20252026");
const AUTO_REFRESH_SCHEDULER_ENABLED = String(process.env.AUTO_REFRESH_SCHEDULER_ENABLED ?? "false").toLowerCase() === "true";
const AUTO_REFRESH_CHECK_INTERVAL_MS = Number.parseInt(process.env.AUTO_REFRESH_CHECK_INTERVAL_MS ?? "900000", 10);
const STARTUP_CACHE_WARMUP_ENABLED = String(process.env.STARTUP_CACHE_WARMUP_ENABLED ?? "true").toLowerCase() === "true";
const STARTUP_CACHE_WARMUP_DELAY_MS = Number.parseInt(process.env.STARTUP_CACHE_WARMUP_DELAY_MS ?? "5000", 10);
const SC_REQUIRED_TARGET_DATE = "2026-03-15";
const SC_ROSTERS_FILE = "period1-rosters.json";
const SC_VALIDATOR_SEASON_ID = "20252026";
const SC_VALIDATOR_RANKING_FROM = "2025-10-07";
const SC_VALIDATOR_RANKING_TO = "2026-04-17";
const SUPPORTED_COMPETITION_TYPES = ["stanley_cup", "autumn"];
const DEFAULT_COMPETITION_TYPE = "stanley_cup";
const DEFAULT_COMPETITION_RANKING_WINDOWS = {
  stanley_cup: {
    rankingFrom: SC_VALIDATOR_RANKING_FROM,
    rankingTo: SC_VALIDATOR_RANKING_TO,
  },
  autumn: {
    rankingFrom: SC_VALIDATOR_RANKING_FROM,
    rankingTo: SC_VALIDATOR_RANKING_TO,
  },
};
const EXPECTED_PERIOD_COUNT_BY_COMPETITION = {
  stanley_cup: 2,
  autumn: 3,
};
const COMPETITION_SETUP_STATES = ["draft", "initialized", "locked"];
const CRON_JOB_TOKEN = String(process.env.CRON_JOB_TOKEN ?? "").trim();
const ADMIN_BASIC_USER = String(process.env.ADMIN_BASIC_USER ?? "").trim();
const ADMIN_BASIC_PASS = String(process.env.ADMIN_BASIC_PASS ?? "").trim();
const ADMIN_PROTECTION_ENABLED = ADMIN_BASIC_USER.length > 0 && ADMIN_BASIC_PASS.length > 0;
const PLAYERS_COMPARE_RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.PLAYERS_COMPARE_RATE_LIMIT_WINDOW_MS ?? "60000",
  10
);
const PLAYERS_COMPARE_RATE_LIMIT_MAX = Number.parseInt(process.env.PLAYERS_COMPARE_RATE_LIMIT_MAX ?? "25", 10);
const TEAM_VALIDATOR_RATE_LIMIT_WINDOW_MS = Number.parseInt(
  process.env.TEAM_VALIDATOR_RATE_LIMIT_WINDOW_MS ?? "60000",
  10
);
const TEAM_VALIDATOR_RATE_LIMIT_MAX = Number.parseInt(process.env.TEAM_VALIDATOR_RATE_LIMIT_MAX ?? "10", 10);
const ESPN_NHL_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries";
const appBootedAt = new Date().toISOString();
const buildTimestamp = process.env.BUILD_TIMESTAMP || process.env.RAILWAY_DEPLOYMENT_CREATED_AT || appBootedAt;

function getGameTypeId(competitionType) {
  return competitionType === "stanley_cup" ? 3 : 2;
}

function resolveCommitSha() {
  const envCandidates = [
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.RAILWAY_GIT_COMMIT,
    process.env.SOURCE_VERSION,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.COMMIT_SHA,
  ];

  for (const candidate of envCandidates) {
    const value = String(candidate ?? "").trim();
    if (value) {
      return value;
    }
  }

  try {
    const gitSha = execSync("git rev-parse HEAD", {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim();

    return gitSha || "unknown";
  } catch {
    return "unknown";
  }
}

const commitSha = resolveCommitSha();

mkdirSync(storageRoot, { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(path.dirname(settingsDbPath), { recursive: true });

// Seed roster file from git source into volume if missing
{
  const volumeRosterPath = path.join(dataDir, SC_ROSTERS_FILE);
  const gitRosterPath = path.join(rootDir, "data", SC_ROSTERS_FILE);
  if (dataDir !== path.join(rootDir, "data")) {
    let exists = false;
    try { statSync(volumeRosterPath); exists = true; } catch { /* missing */ }
    if (!exists) {
      try {
        statSync(gitRosterPath);
        copyFileSync(gitRosterPath, volumeRosterPath);
        console.log(`[startup] Seeded ${SC_ROSTERS_FILE} from git source → ${volumeRosterPath}`);
      } catch { /* git source also missing */ }
    }
  }
}

const app = express();
app.use(express.json());

// Reject POST/PUT requests with a body but without Content-Type: application/json.
// express.json() silently skips parsing when Content-Type is wrong, leaving req.body
// undefined and causing silent field-missing errors rather than noisy client mistakes.
app.use((req, res, next) => {
  if (req.method === "POST" || req.method === "PUT") {
    const hasBody =
      (req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0") ||
      req.headers["transfer-encoding"] !== undefined;
    if (hasBody) {
      const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
      if (!contentType.includes("application/json")) {
        res.status(415).json({ error: "Content-Type must be application/json" });
        return;
      }
    }
  }
  next();
});

function getClientIpFromRequest(req) {
  const forwardedHeader = String(req.headers["x-forwarded-for"] ?? "").trim();
  const forwardedIp = forwardedHeader.split(",")[0]?.trim();
  if (forwardedIp) {
    return forwardedIp;
  }

  return String(req.ip ?? req.socket?.remoteAddress ?? "").trim();
}

function isLoopbackIp(ipValue) {
  const ip = String(ipValue ?? "").trim().toLowerCase();
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("::ffff:127.0.0.")
  );
}

function createEndpointRateLimiter({ windowMs, max, code }) {
  return rateLimit({
    windowMs: Math.max(1000, Number.isFinite(windowMs) ? windowMs : 60000),
    max: Math.max(1, Number.isFinite(max) ? max : 10),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      const requestIp = getClientIpFromRequest(req);
      return isLoopbackIp(requestIp) || hasAdminCredentials(req);
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: "Rate limit exceeded",
        code,
      });
    },
  });
}

const playersCompareRateLimiter = createEndpointRateLimiter({
  windowMs: PLAYERS_COMPARE_RATE_LIMIT_WINDOW_MS,
  max: PLAYERS_COMPARE_RATE_LIMIT_MAX,
  code: "players_compare_rate_limited",
});

const teamValidatorRateLimiter = createEndpointRateLimiter({
  windowMs: TEAM_VALIDATOR_RATE_LIMIT_WINDOW_MS,
  max: TEAM_VALIDATOR_RATE_LIMIT_MAX,
  code: "team_validator_rate_limited",
});

let mcpClientPromise = null;
let mcpClientInitialized = false;
let mcpThrottleLock = Promise.resolve();
let mcpNextAllowedAt = 0;
let autoRefreshInProgress = false;
let injuryCache = {
  fetchedAt: 0,
  data: new Map(),
};
let injuryCacheFetchPromise = null;
let scValidatorRankingCache = {
  cacheKey: "",
  cachedAt: 0,
  data: null,
};
const scValidatorRankingInFlightByCacheKey = new Map();
const settingsDb = new Database(settingsDbPath);

settingsDb.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

settingsDb.exec(`
  CREATE TABLE IF NOT EXISTS compare_response_cache (
    cache_key TEXT PRIMARY KEY,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

settingsDb.exec(`
  CREATE TABLE IF NOT EXISTS nyheter_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    file_name TEXT NOT NULL,
    season_id TEXT NOT NULL,
    compare_date TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE(snapshot_date, file_name, season_id, compare_date)
  )
`);

settingsDb.exec(`
  CREATE TABLE IF NOT EXISTS settings_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    competition_type TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    override_used INTEGER NOT NULL DEFAULT 0,
    reason TEXT
  )
`);

function getSetting(key, fallback = "") {
  const row = settingsDb.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row?.value ?? fallback;
}

function setSetting(key, value) {
  settingsDb
    .prepare(
      `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    )
    .run(key, value);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

function normalizeCompetitionType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (SUPPORTED_COMPETITION_TYPES.includes(normalized)) {
    return normalized;
  }
  return "";
}

function getActiveCompetitionType() {
  const configured = normalizeCompetitionType(getSetting("competitionType", DEFAULT_COMPETITION_TYPE));
  return configured || DEFAULT_COMPETITION_TYPE;
}

function setActiveCompetitionType(competitionType) {
  setSetting("competitionType", competitionType);
}

function getRankingWindowSettingKeys(competitionType) {
  return {
    from: `rankingFrom.${competitionType}`,
    to: `rankingTo.${competitionType}`,
  };
}

function getRankingWindowForCompetition(competitionType) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  const defaults =
    DEFAULT_COMPETITION_RANKING_WINDOWS[normalizedType] ?? DEFAULT_COMPETITION_RANKING_WINDOWS[DEFAULT_COMPETITION_TYPE];
  const keys = getRankingWindowSettingKeys(normalizedType);
  const rankingFrom = String(getSetting(keys.from, defaults.rankingFrom)).trim();
  const rankingTo = String(getSetting(keys.to, defaults.rankingTo)).trim();
  return {
    competitionType: normalizedType,
    rankingFrom,
    rankingTo,
  };
}

function setRankingWindowForCompetition({ competitionType, rankingFrom, rankingTo }) {
  const keys = getRankingWindowSettingKeys(competitionType);
  setSetting(keys.from, rankingFrom);
  setSetting(keys.to, rankingTo);
}

function buildCompetitionRankingWindowsSnapshot() {
  return SUPPORTED_COMPETITION_TYPES.reduce((acc, type) => {
    const window = getRankingWindowForCompetition(type);
    acc[type] = {
      rankingFrom: window.rankingFrom,
      rankingTo: window.rankingTo,
    };
    return acc;
  }, {});
}

function getExpectedPeriodCount(competitionType) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  return EXPECTED_PERIOD_COUNT_BY_COMPETITION[normalizedType] ?? EXPECTED_PERIOD_COUNT_BY_COMPETITION[DEFAULT_COMPETITION_TYPE];
}

function getPeriodWindowsSettingKey(competitionType) {
  return `periodWindows.${competitionType}`;
}

function getSetupStateSettingKey(competitionType) {
  return `setupState.${competitionType}`;
}

function getLockedAtSettingKey(competitionType) {
  return `periodWindowsLockedAt.${competitionType}`;
}

function getLockedBySettingKey(competitionType) {
  return `periodWindowsLockedBy.${competitionType}`;
}

function normalizeSetupState(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (COMPETITION_SETUP_STATES.includes(normalized)) {
    return normalized;
  }
  return "draft";
}

function parseJsonSetting(key, fallback) {
  const raw = String(getSetting(key, "")).trim();
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function setJsonSetting(key, value) {
  setSetting(key, JSON.stringify(value));
}

function addDaysToIsoDate(dateValue, days) {
  const base = dateFromParts(dateValue);
  base.setUTCDate(base.getUTCDate() + days);
  return formatDateUTC(base);
}

function normalizeAndValidatePeriodWindows(periodWindows, competitionType) {
  const expectedCount = getExpectedPeriodCount(competitionType);
  if (!Array.isArray(periodWindows)) {
    throw new Error("periodWindows must be an array");
  }

  if (periodWindows.length !== expectedCount) {
    throw new Error(`periodWindows must contain exactly ${expectedCount} periods`);
  }

  const normalized = periodWindows.map((item, index) => {
    const periodNumber = Number.parseInt(String(item?.periodNumber ?? index + 1), 10);
    const startDate = String(item?.startDate ?? "").trim();
    const endDate = String(item?.endDate ?? "").trim();
    const label = String(item?.label ?? `P${periodNumber}`).trim() || `P${periodNumber}`;
    const isFinal = Boolean(item?.isFinal);

    if (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > expectedCount) {
      throw new Error(`periodNumber must be between 1 and ${expectedCount}`);
    }
    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      throw new Error(`Period ${periodNumber}: startDate and endDate must be in format YYYY-MM-DD`);
    }
    if (startDate > endDate) {
      throw new Error(`Period ${periodNumber}: startDate must be less than or equal to endDate`);
    }

    return {
      periodNumber,
      label,
      startDate,
      endDate,
      isFinal,
    };
  });

  const byPeriodNumber = new Set(normalized.map((item) => item.periodNumber));
  if (byPeriodNumber.size !== expectedCount) {
    throw new Error("periodNumber values must be unique");
  }

  const sortedByPeriod = normalized.slice().sort((left, right) => left.periodNumber - right.periodNumber);
  for (let index = 0; index < sortedByPeriod.length; index += 1) {
    const expectedPeriodNumber = index + 1;
    if (sortedByPeriod[index].periodNumber !== expectedPeriodNumber) {
      throw new Error(`periodNumber sequence must be continuous from 1 to ${expectedCount}`);
    }
  }

  const finalPeriods = sortedByPeriod.filter((item) => item.isFinal);
  if (finalPeriods.length !== 1 || finalPeriods[0].periodNumber !== expectedCount) {
    throw new Error(`Exactly one final period is required, and it must be period ${expectedCount}`);
  }

  for (let index = 1; index < sortedByPeriod.length; index += 1) {
    const previous = sortedByPeriod[index - 1];
    const current = sortedByPeriod[index];
    const expectedStart = addDaysToIsoDate(previous.endDate, 1);

    if (current.startDate < expectedStart) {
      throw new Error(`Period ${current.periodNumber} overlaps with period ${previous.periodNumber}`);
    }

    if (current.startDate > expectedStart) {
      throw new Error(`Gap detected between period ${previous.periodNumber} and period ${current.periodNumber}`);
    }
  }

  return sortedByPeriod;
}

function getPeriodWindowsForCompetition(competitionType) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  const key = getPeriodWindowsSettingKey(normalizedType);
  const periodWindows = parseJsonSetting(key, []);
  return Array.isArray(periodWindows) ? periodWindows : [];
}

function setPeriodWindowsForCompetition(competitionType, periodWindows) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  const key = getPeriodWindowsSettingKey(normalizedType);
  setJsonSetting(key, periodWindows);
}

function getSetupStateForCompetition(competitionType) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  const key = getSetupStateSettingKey(normalizedType);
  return normalizeSetupState(getSetting(key, "draft"));
}

function setSetupStateForCompetition(competitionType, setupState) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  const key = getSetupStateSettingKey(normalizedType);
  setSetting(key, normalizeSetupState(setupState));
}

function getLockMetadataForCompetition(competitionType) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  return {
    lockedAt: String(getSetting(getLockedAtSettingKey(normalizedType), "")).trim(),
    lockedBy: String(getSetting(getLockedBySettingKey(normalizedType), "")).trim(),
  };
}

function setLockMetadataForCompetition(competitionType, { lockedAt, lockedBy }) {
  const normalizedType = normalizeCompetitionType(competitionType) || DEFAULT_COMPETITION_TYPE;
  setSetting(getLockedAtSettingKey(normalizedType), String(lockedAt ?? "").trim());
  setSetting(getLockedBySettingKey(normalizedType), String(lockedBy ?? "").trim());
}

function appendSettingsAuditEntry({ actor, competitionType, settingKey, oldValue, newValue, overrideUsed, reason }) {
  settingsDb
    .prepare(
      `
        INSERT INTO settings_audit (
          created_at,
          actor,
          competition_type,
          setting_key,
          old_value,
          new_value,
          override_used,
          reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      new Date().toISOString(),
      String(actor ?? "unknown"),
      String(competitionType ?? ""),
      String(settingKey ?? ""),
      oldValue === undefined || oldValue === null ? null : String(oldValue),
      newValue === undefined || newValue === null ? null : String(newValue),
      overrideUsed ? 1 : 0,
      String(reason ?? "").trim() || null
    );
}

function listSettingsAuditEntries({ competitionType, limit = 30 } = {}) {
  const normalizedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 30;
  const normalizedType = normalizeCompetitionType(competitionType);

  if (normalizedType) {
    return settingsDb
      .prepare(
        `
          SELECT id, created_at, actor, competition_type, setting_key, old_value, new_value, override_used, reason
          FROM settings_audit
          WHERE competition_type = ?
          ORDER BY id DESC
          LIMIT ?
        `
      )
      .all(normalizedType, normalizedLimit);
  }

  return settingsDb
    .prepare(
      `
        SELECT id, created_at, actor, competition_type, setting_key, old_value, new_value, override_used, reason
        FROM settings_audit
        ORDER BY id DESC
        LIMIT ?
      `
    )
    .all(normalizedLimit);
}

function getActorFromRequest(req) {
  const credentials = parseBasicAuthHeader(req.get("authorization"));
  if (credentials?.user && hasAdminCredentials(req)) {
    return credentials.user;
  }
  if (isLoopbackIp(getClientIpFromRequest(req))) {
    return "loopback";
  }
  return "unknown";
}

function ensureCompetitionSettingsEditable({ req, competitionType, overrideRequested }) {
  const setupState = getSetupStateForCompetition(competitionType);
  if (setupState !== "locked") {
    return { ok: true, setupState };
  }

  if (!overrideRequested) {
    return {
      ok: false,
      statusCode: 409,
      error: "Competition settings are locked. Use override to modify.",
      setupState,
    };
  }

  if (!ADMIN_PROTECTION_ENABLED || !hasAdminCredentials(req)) {
    return {
      ok: false,
      statusCode: 401,
      error: "Override requires admin Basic Auth credentials",
      setupState,
    };
  }

  return { ok: true, setupState };
}

function buildCompetitionPeriodCalendarsSnapshot() {
  return SUPPORTED_COMPETITION_TYPES.reduce((acc, type) => {
    const setupState = getSetupStateForCompetition(type);
    const lockMetadata = getLockMetadataForCompetition(type);
    acc[type] = {
      periodWindows: getPeriodWindowsForCompetition(type),
      setupState,
      lockMetadata,
      expectedPeriodCount: getExpectedPeriodCount(type),
    };
    return acc;
  }, {});
}

function clearResponseCacheOnVersionChange() {
  const settingKey = "responseCacheVersion";
  const previousVersion = String(getSetting(settingKey, "")).trim();

  if (previousVersion === RESPONSE_CACHE_VERSION) {
    return;
  }

  const removedRows = settingsDb.prepare("DELETE FROM compare_response_cache").run().changes;
  setSetting(settingKey, RESPONSE_CACHE_VERSION);
  console.log(
    `[cache] invalidated compare_response_cache due to version change (${previousVersion || "none"} -> ${RESPONSE_CACHE_VERSION}, rows=${removedRows})`
  );
}

function getCachedResponse(cacheKey) {
  const row = settingsDb
    .prepare("SELECT response_json, created_at FROM compare_response_cache WHERE cache_key = ?")
    .get(cacheKey);

  if (!row?.response_json) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.response_json);
    if (!parsed?.cache?.fetchedAt && row?.created_at) {
      parsed.cache = {
        ...(parsed.cache ?? {}),
        fetchedAt: row.created_at,
      };
    }
    return parsed;
  } catch {
    settingsDb.prepare("DELETE FROM compare_response_cache WHERE cache_key = ?").run(cacheKey);
    return null;
  }
}

function setCachedResponse(cacheKey, payload) {
  settingsDb
    .prepare(
      `
        INSERT INTO compare_response_cache (cache_key, response_json, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          response_json = excluded.response_json,
          created_at = excluded.created_at
      `
    )
    .run(cacheKey, JSON.stringify(payload), new Date().toISOString());
}

function getCachedCompareResponse(cacheKey) {
  return getCachedResponse(cacheKey);
}

function setCachedCompareResponse(cacheKey, payload) {
  setCachedResponse(cacheKey, payload);
}

function dateFromParts(dateValue) {
  const [year, month, day] = String(dateValue)
    .split("-")
    .map((value) => Number.parseInt(value, 10));

  const base = new Date(Date.UTC(year, month - 1, day));
  return base;
}

function formatDateUTC(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getHelsinkiDateWindowKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const todayDate = `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
  const helsinkiHour = Number.parseInt(valueByType.hour ?? "0", 10);

  if (helsinkiHour < 10) {
    const previous = dateFromParts(todayDate);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return `${formatDateUTC(previous)}_fi10`;
  }

  return `${todayDate}_fi10`;
}

function getHelsinkiTodayDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
}

function getHelsinkiNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const valueByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${valueByType.year}-${valueByType.month}-${valueByType.day}`,
    hour: Number.parseInt(valueByType.hour ?? "0", 10),
  };
}

function getPreviousDateIso(dateValue) {
  const previous = dateFromParts(dateValue);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return formatDateUTC(previous);
}

function getDefaultAutoRefreshTargetDate() {
  return getPreviousDateIso(getHelsinkiTodayDate());
}

function isFinalGameState(gameState) {
  return String(gameState ?? "").trim().toUpperCase() === "OFF";
}

function hasBoxscorePlayerStats(boxscorePayload) {
  const home = boxscorePayload?.playerByGameStats?.homeTeam;
  const away = boxscorePayload?.playerByGameStats?.awayTeam;

  function teamHasStats(teamStats) {
    if (!teamStats) {
      return false;
    }

    const forwards = Array.isArray(teamStats.forwards) ? teamStats.forwards.length : 0;
    const defense = Array.isArray(teamStats.defense) ? teamStats.defense.length : 0;
    const goalies = Array.isArray(teamStats.goalies) ? teamStats.goalies.length : 0;
    return forwards + defense + goalies > 0;
  }

  return teamHasStats(home) && teamHasStats(away);
}

async function buildDataReadiness(targetDate) {
  const scorePayload = await fetchJsonDirect(`/score/${targetDate}`);
  const allGames = Array.isArray(scorePayload?.games) ? scorePayload.games : [];
  const dayGames = allGames.filter((game) => String(game?.gameDate ?? "") === targetDate);

  const nonFinalGames = dayGames
    .filter((game) => !isFinalGameState(game?.gameState))
    .map((game) => ({
      id: game?.id ?? null,
      gameState: game?.gameState ?? "",
      gameScheduleState: game?.gameScheduleState ?? "",
      startTimeUTC: game?.startTimeUTC ?? "",
      awayTeam: game?.awayTeam?.abbrev ?? "",
      homeTeam: game?.homeTeam?.abbrev ?? "",
      reason: "not_final",
    }));

  const finalGames = dayGames.filter((game) => isFinalGameState(game?.gameState));
  const statsChecks = await runWithConcurrency(finalGames, 4, async (game) => {
    try {
      const boxscorePayload = await fetchJsonDirect(`/gamecenter/${game.id}/boxscore`);
      const statsReady = hasBoxscorePlayerStats(boxscorePayload);
      return {
        id: game?.id ?? null,
        awayTeam: game?.awayTeam?.abbrev ?? "",
        homeTeam: game?.homeTeam?.abbrev ?? "",
        gameState: game?.gameState ?? "",
        statsReady,
        reason: statsReady ? "ok" : "missing_boxscore_player_stats",
      };
    } catch (error) {
      return {
        id: game?.id ?? null,
        awayTeam: game?.awayTeam?.abbrev ?? "",
        homeTeam: game?.homeTeam?.abbrev ?? "",
        gameState: game?.gameState ?? "",
        statsReady: false,
        reason: "boxscore_fetch_error",
        error: String(error?.message ?? "unknown error"),
      };
    }
  });

  const statsBlockingGames = statsChecks.filter((check) => !check.statsReady);
  const blockingGames = [...nonFinalGames, ...statsBlockingGames];
  const ready = blockingGames.length === 0;

  return {
    date: targetDate,
    timezone: "Europe/Helsinki",
    ready,
    checksAt: new Date().toISOString(),
    totalGames: dayGames.length,
    finalGames: finalGames.length,
    nonFinalGames: nonFinalGames.length,
    statsReadyGames: statsChecks.filter((check) => check.statsReady).length,
    statsBlockingGames: statsBlockingGames.length,
    blockingGames,
    nextSuggestedCheckSeconds: ready ? 0 : 300,
  };
}

class EndpointProxyError extends Error {
  constructor(statusCode, payload) {
    super(`Endpoint proxy error (${statusCode})`);
    this.name = "EndpointProxyError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

function resolvePlayerMatch(parsedCell, compareIndexes, liveSnapshot) {
  const { byTeamAndLast, byTeamLastAndInitial, byLastName, byLastAndInitial } = compareIndexes;

  const teamKey = parsedCell.teamAbbrev ? `${parsedCell.teamAbbrev}|${parsedCell.lastNameNormalized}` : "";
  const directMatch = teamKey ? byTeamAndLast.get(teamKey) : null;

  const teamInitialKey =
    parsedCell.teamAbbrev && parsedCell.firstInitial && parsedCell.hasGivenNameHint
      ? `${parsedCell.teamAbbrev}|${parsedCell.lastNameNormalized}|${parsedCell.firstInitial}`
      : "";
  const teamInitialCandidates = teamInitialKey ? byTeamLastAndInitial.get(teamInitialKey) ?? [] : [];
  const teamInitialMatch = teamInitialCandidates.length === 1 ? teamInitialCandidates[0] : null;

  const fallbackCandidates = byLastName.get(parsedCell.lastNameNormalized) ?? [];
  const fallbackInitialKey =
    parsedCell.firstInitial && parsedCell.hasGivenNameHint
      ? `${parsedCell.lastNameNormalized}|${parsedCell.firstInitial}`
      : "";
  const fallbackInitialCandidates = fallbackInitialKey ? byLastAndInitial.get(fallbackInitialKey) ?? [] : [];
  const fallbackInitialMatch = fallbackInitialCandidates.length === 1 ? fallbackInitialCandidates[0] : null;
  const fallbackMatch = fallbackCandidates.length === 1 ? fallbackCandidates[0] : null;

  const matched = directMatch ?? teamInitialMatch ?? fallbackInitialMatch ?? fallbackMatch ?? null;

  return {
    matched,
    matchSource: directMatch
      ? "team_last"
      : teamInitialMatch
        ? "team_last_initial"
        : fallbackInitialMatch
          ? "last_name_initial_unique"
          : fallbackMatch
            ? "last_name_unique"
            : liveSnapshot?.source ?? "not_found",
  };
}

function resolveDeltaPointsForSc(scWindowRanking, isGoalieRole, preferredName, resolvedTeamAbbrev, currentDeltaPoints) {
  if (!scWindowRanking) {
    return currentDeltaPoints;
  }

  const fullKey = buildPlayerFullTeamKey(preferredName, resolvedTeamAbbrev);
  const lastKey = buildPlayerLastTeamKey(preferredName, resolvedTeamAbbrev);

  if (isGoalieRole) {
    const byFull = scWindowRanking.goalieByFullKey.get(fullKey) ?? [];
    const byLast = scWindowRanking.goalieByLastKey.get(lastKey) ?? [];
    const goalieMatch = byFull[0] ?? byLast[0] ?? null;
    if (goalieMatch && Number.isFinite(Number(goalieMatch.points))) {
      return Number(goalieMatch.points);
    }
  } else {
    const byFull = scWindowRanking.skaterByFullKey.get(fullKey) ?? [];
    const byLast = scWindowRanking.skaterByLastKey.get(lastKey) ?? [];
    const skaterMatch = byFull[0] ?? byLast[0] ?? null;
    if (skaterMatch && Number.isFinite(Number(skaterMatch.points))) {
      return Number(skaterMatch.points);
    }
  }

  return currentDeltaPoints;
}

function buildPlayerRecord(rosterRow, parsedCell, matched, liveSnapshot, resolvedPlayerLabel, resolvedTeamAbbrev, deltaPoints, injury, matchSource) {
  return {
    rowNumber: rosterRow.rowNumber,
    role: rosterRow.role,
    playerLabel: resolvedPlayerLabel,
    teamAbbrev: resolvedTeamAbbrev,
    deltaPoints,
    injury,
    source: matchSource,
    matchedFullName: matched?.fullName ?? liveSnapshot?.matchedFullName ?? "",
  };
}

async function getTipsenSummaryPayload({
  fileName = "",
  seasonId = "20252026",
  compareDate,
  forceRefresh = false,
  includeCacheDebug = false,
} = {}) {
  const rosterSource = await resolveActiveRosterSource(compareDate);
  const useScRosters = rosterSource.rosterSource === "sc_rosters";
  const rosterSourceKey = rosterSource.sourceKey;

  const dataWindowKey = getHelsinkiDateWindowKey();
  const cacheKey = [RESPONSE_CACHE_VERSION, "tipsen", seasonId, fileName, compareDate, dataWindowKey, rosterSourceKey].join("|");
  const cachedResponse = forceRefresh ? null : getCachedResponse(cacheKey);
  if (cachedResponse) {
    const cachePayload = {
      ...(cachedResponse.cache ?? {}),
      window: dataWindowKey,
      timezone: "Europe/Helsinki",
      refreshHourLocal: 10,
    };

    if (includeCacheDebug) {
      cachePayload.hit = true;
    } else {
      delete cachePayload.hit;
      delete cachePayload.compareHit;
    }

    return {
      ...cachedResponse,
      cache: cachePayload,
    };
  }

  const adjustedCompareDate = useScRosters ? getPreviousDateIso(compareDate) : compareDate;

  const compareParams = new URLSearchParams({
    seasonId,
    compareDate: adjustedCompareDate,
  });
  if (fileName) {
    compareParams.set("file", fileName);
  }
  if (forceRefresh) {
    compareParams.set("forceRefresh", "true");
  }

  const compareResponse = await fetch(`http://127.0.0.1:${PORT}/api/players-stats-compare?${compareParams}`);
  const comparePayload = await compareResponse.json();
  if (!compareResponse.ok) {
    throw new EndpointProxyError(compareResponse.status, comparePayload);
  }

  let tipsenRows = [];
  let participantColumns = [];
  let rosterRows = [];

  const temporaryRosters = buildTemporaryParticipantColumns(rosterSource.participants);
  participantColumns = temporaryRosters.participantColumns;
  rosterRows = temporaryRosters.rosterRows;

  const compareItems = comparePayload.items ?? [];
  const compareIndexes = buildCompareIndexes(compareItems);
  const tipsenTeamCache = new Map();
  const tipsenSnapshotCache = new Map();
  const injuryLookup = await getInjuryLookup();
  const activeCompetitionType = getActiveCompetitionType();
  const scGameTypeId = getGameTypeId(activeCompetitionType);
  const scWindowRanking = useScRosters
    ? await buildScRankingData({
        fileName,
        seasonId,
        fromDate: adjustedCompareDate,
        toDate: getHelsinkiTodayDate(),
        gameTypeId: scGameTypeId,
      })
    : null;
  const participants = [];

  for (const participant of participantColumns) {
    const players = [];

    for (const rosterRow of rosterRows) {
      const parsedCell = participant.rosterByRow
        ? participant.rosterByRow.get(rosterRow.rowNumber) ?? null
        : parseTipsenPlayerCell((tipsenRows[rosterRow.rowNumber - 1] ?? [])[participant.playerCol]);
      if (!parsedCell) {
        players.push({
          rowNumber: rosterRow.rowNumber,
          role: rosterRow.role,
          playerLabel: "",
          teamAbbrev: "",
          deltaPoints: null,
          source: "empty",
        });
        continue;
      }

      let liveSnapshot = null;
      const { matched, matchSource } = resolvePlayerMatch(parsedCell, compareIndexes, liveSnapshot);

      if (!matched) {
        liveSnapshot = await resolveTipsenLiveSnapshot({
          parsedCell,
          seasonId,
          compareDate: adjustedCompareDate,
          teamCache: tipsenTeamCache,
          snapshotCache: tipsenSnapshotCache,
          gameTypeId: scGameTypeId,
        });
      }

      const resolvedTeamAbbrev = String(
        matched?.teamAbbrev ?? liveSnapshot?.teamAbbrev ?? parsedCell.teamAbbrev ?? ""
      )
        .trim()
        .toUpperCase();
      const resolvedPlayerName = String(
        extractDisplayLastNameFromFullName(matched?.fullName) ||
          liveSnapshot?.matchedLastName ||
          parsedCell.playerName ||
          ""
      ).trim();
      const resolvedPlayerLabel = resolvedTeamAbbrev && resolvedPlayerName
        ? `${resolvedPlayerName} (${resolvedTeamAbbrev})`
        : parsedCell.playerLabel;
      const roleToken = normalizeText(rosterRow.role ?? "");
      const isGoalieRole = roleToken === "mv" || roleToken.includes("maalivahti") || roleToken.includes("goalie");
      let deltaPoints = matched?.deltaPoints ?? liveSnapshot?.deltaPoints ?? null;

      deltaPoints = resolveDeltaPointsForSc(
        scWindowRanking,
        isGoalieRole,
        String(matched?.fullName ?? liveSnapshot?.matchedFullName ?? parsedCell.playerName ?? "").trim(),
        resolvedTeamAbbrev,
        deltaPoints
      );

      const injury = resolveInjuryForPlayer(
        {
          matchedFullName: matched?.fullName ?? liveSnapshot?.matchedFullName ?? "",
          playerLabel: parsedCell.playerLabel,
        },
        injuryLookup
      );

      players.push(
        buildPlayerRecord(
          rosterRow,
          parsedCell,
          matched,
          liveSnapshot,
          resolvedPlayerLabel,
          resolvedTeamAbbrev,
          deltaPoints,
          injury,
          matchSource
        )
      );
    }

    const totalDelta = players.reduce((sum, player) => {
      if (!Number.isFinite(Number(player.deltaPoints))) {
        return sum;
      }
      return sum + Number(player.deltaPoints);
    }, 0);

    participants.push({
      name: participant.name,
      totalDelta,
      players,
    });
  }

  const responsePayload = {
    file: fileName || rosterSource.sourceLabel,
    seasonId,
    compareDate,
    rosterSource: rosterSource.rosterSource,
    rosterRows,
    participants,
    cache: {
      window: dataWindowKey,
      timezone: "Europe/Helsinki",
      refreshHourLocal: 10,
      fetchedAt: new Date().toISOString(),
      ...(includeCacheDebug
        ? {
            hit: false,
            compareHit: Boolean(comparePayload?.cache?.hit),
          }
        : {}),
    },
  };

  setCachedResponse(cacheKey, responsePayload);
  return responsePayload;
}

async function forceRefreshTipsenForFile({ fileName, seasonId, compareDate }) {
  await getTipsenSummaryPayload({
    fileName,
    seasonId,
    compareDate,
    forceRefresh: true,
    includeCacheDebug: false,
  });

  return {
    file: fileName,
    status: "ok",
  };
}

function parseFiniteNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function buildParticipantImpactFromPlayers(participantName, playerRows) {
  const ownRows = playerRows.filter((row) => row.participantName === participantName && row.playerLabel);
  if (!ownRows.length) {
    return {
      participantName,
      topContributor: "Ingen spelardata",
      topContributorDelta: "-",
      biggestDrag: "Ingen spelardata",
      biggestDragDelta: "-",
    };
  }

  const scoredRows = ownRows.filter((row) => row.deltaPoints !== null);
  if (!scoredRows.length) {
    const fallbackTop = ownRows[0];
    const fallbackBottom = ownRows[Math.min(1, ownRows.length - 1)] || ownRows[0];
    return {
      participantName,
      topContributor: String(fallbackTop.playerLabel || "Ingen spelardata"),
      topContributorDelta: "-",
      biggestDrag: String(fallbackBottom.playerLabel || "Ingen spelardata"),
      biggestDragDelta: "-",
    };
  }

  const topContributor = [...scoredRows].sort((left, right) => Number(right.deltaPoints) - Number(left.deltaPoints))[0];
  const biggestDrag = [...scoredRows].sort((left, right) => Number(left.deltaPoints) - Number(right.deltaPoints))[0];
  return {
    participantName,
    topContributor: String(topContributor.playerLabel || "Ingen spelardata"),
    topContributorDelta: Number.isFinite(Number(topContributor.deltaPoints)) ? Number(topContributor.deltaPoints) : "-",
    biggestDrag: String(biggestDrag.playerLabel || "Ingen spelardata"),
    biggestDragDelta: Number.isFinite(Number(biggestDrag.deltaPoints)) ? Number(biggestDrag.deltaPoints) : "-",
  };
}

function buildNyheterSnapshotFromTipsenPayload(payload) {
  const participants = Array.isArray(payload?.participants) ? payload.participants : [];
  const participantStandings = participants
    .map((participant) => ({
      name: String(participant?.name ?? "").trim(),
      totalDelta: parseFiniteNumber(participant?.totalDelta) ?? 0,
    }))
    .sort((left, right) => right.totalDelta - left.totalDelta)
    .map((participant, index) => ({
      rank: index + 1,
      ...participant,
    }));

  const playerRows = participants.flatMap((participant) => {
    const participantName = String(participant?.name ?? "").trim();
    const players = Array.isArray(participant?.players) ? participant.players : [];
    return players.map((player) => ({
      participantName,
      rowNumber: Number(player?.rowNumber ?? 0) || null,
      playerLabel: String(player?.playerLabel ?? "").trim(),
      teamAbbrev: String(player?.teamAbbrev ?? "").trim(),
      deltaPoints: parseFiniteNumber(player?.deltaPoints),
      source: String(player?.source ?? "").trim(),
      injuryStatus: String(player?.injury?.status ?? "").trim(),
      injuryTimeline: String(player?.injury?.timeline ?? "").trim(),
      injurySource: String(player?.injury?.source ?? "").trim(),
    }));
  });

  const scoredPlayers = playerRows.filter((row) => row.playerLabel && row.deltaPoints !== null);
  const risers = [...scoredPlayers]
    .sort((left, right) => Number(right.deltaPoints) - Number(left.deltaPoints))
    .slice(0, 8);
  const slowestClimbers = [...scoredPlayers]
    .sort((left, right) => Number(left.deltaPoints) - Number(right.deltaPoints))
    .slice(0, 8);

  const injuries = playerRows
    .filter((row) => row.playerLabel && (row.injuryStatus || row.injuryTimeline))
    .slice(0, 16);

  const sourceBreakdown = playerRows.reduce((acc, row) => {
    const key = row.source || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const playerTotals = playerRows
    .filter((row) => row.playerLabel)
    .map((row) => ({
      participantName: row.participantName,
      playerLabel: row.playerLabel,
      deltaPoints: row.deltaPoints,
    }));

  const participantImpacts = participantStandings.map((participant) =>
    buildParticipantImpactFromPlayers(participant.name, playerRows)
  );

  return {
    file: String(payload?.file ?? "").trim(),
    seasonId: String(payload?.seasonId ?? "").trim(),
    compareDate: String(payload?.compareDate ?? "").trim(),
    rosterSource: String(payload?.rosterSource ?? "unknown").trim() || "unknown",
    sourceVersion: String(payload?.cache?.window ?? "").trim(),
    collectedFromCacheWindow: String(payload?.cache?.window ?? "").trim(),
    participantStandings,
    risers,
    slowestClimbers,
    participantImpacts,
    playerTotals,
    injuries,
    sourceBreakdown,
  };
}

class NyheterSnapshotConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "NyheterSnapshotConflictError";
  }
}

function saveNyheterSnapshot({ snapshotDate, fileName, seasonId, compareDate, payload, allowOverwrite = false }) {
  const collectedAt = new Date().toISOString();

  const insertSql = `
    INSERT INTO nyheter_snapshots (
      snapshot_date,
      file_name,
      season_id,
      compare_date,
      collected_at,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `;

  const updateSql = `
    UPDATE nyheter_snapshots
    SET collected_at = ?, payload_json = ?
    WHERE snapshot_date = ? AND file_name = ? AND season_id = ? AND compare_date = ?
  `;

  const transaction = settingsDb.transaction(() => {
    try {
      settingsDb.prepare(insertSql).run(snapshotDate, fileName, seasonId, compareDate, collectedAt, JSON.stringify(payload));
    } catch (error) {
      const isUniqueViolation = String(error?.message ?? "").includes("UNIQUE constraint failed");
      if (!isUniqueViolation) {
        throw error;
      }

      if (!allowOverwrite) {
        throw new NyheterSnapshotConflictError(
          `Nyheter snapshot already exists for ${snapshotDate} (${fileName}, ${seasonId}, ${compareDate})`
        );
      }

      settingsDb
        .prepare(updateSql)
        .run(collectedAt, JSON.stringify(payload), snapshotDate, fileName, seasonId, compareDate);
    }
  });

  transaction();
  return collectedAt;
}

function listNyheterSnapshots({ fileName = "", seasonId = "", compareDate = "", limit = 14 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 14, 60));
  const clauses = [];
  const params = [];

  if (fileName) {
    clauses.push("file_name = ?");
    params.push(fileName);
  }

  if (seasonId) {
    clauses.push("season_id = ?");
    params.push(seasonId);
  }

  if (compareDate) {
    clauses.push("compare_date = ?");
    params.push(compareDate);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = settingsDb
    .prepare(
      `
        SELECT snapshot_date, file_name, season_id, compare_date, collected_at, payload_json
        FROM nyheter_snapshots
        ${whereClause}
        ORDER BY snapshot_date DESC, collected_at DESC
        LIMIT ?
      `
    )
    .all(...params, normalizedLimit);

  return rows.map((row) => {
    let payload = null;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = null;
    }

    return {
      snapshotDate: row.snapshot_date,
      file: row.file_name,
      seasonId: row.season_id,
      compareDate: row.compare_date,
      collectedAt: row.collected_at,
      payload,
    };
  });
}

async function collectNyheterSnapshot({
  fileName,
  seasonId,
  compareDate,
  snapshotDate,
  forceRefresh = false,
  allowOverwrite = false,
} = {}) {
  if (await isNyheterSnapshotCollectionPaused()) {
    return {
      snapshotDate: String(snapshotDate ?? getHelsinkiTodayDate()).trim(),
      file: fileName,
      seasonId,
      compareDate,
      paused: true,
      reason: "sc_rosters_missing",
      requiredFromDate: SC_REQUIRED_TARGET_DATE,
    };
  }

  const tipsenPayload = await getTipsenSummaryPayload({
    fileName,
    seasonId,
    compareDate,
    forceRefresh,
    includeCacheDebug: false,
  });
  const normalizedSnapshotDate = String(snapshotDate ?? getHelsinkiTodayDate()).trim();
  const snapshotPayload = buildNyheterSnapshotFromTipsenPayload(tipsenPayload);
  const collectedAt = saveNyheterSnapshot({
    snapshotDate: normalizedSnapshotDate,
    fileName,
    seasonId,
    compareDate,
    payload: snapshotPayload,
    allowOverwrite,
  });

  return {
    snapshotDate: normalizedSnapshotDate,
    file: fileName,
    seasonId,
    compareDate,
    collectedAt,
    participants: snapshotPayload.participantStandings.length,
    risers: snapshotPayload.risers.length,
    slowestClimbers: snapshotPayload.slowestClimbers.length,
    injuries: snapshotPayload.injuries.length,
  };
}

async function runDailyAutoRefresh({
  trigger = "manual",
  date,
  seasonId = AUTO_REFRESH_SEASON_ID,
  compareDate = getSetting("compareDate", DEFAULT_COMPARE_DATE),
  force = false,
} = {}) {
  if (autoRefreshInProgress) {
    return {
      ok: true,
      executed: false,
      reason: "already_running",
      trigger,
      date: String(date ?? getDefaultAutoRefreshTargetDate()).trim(),
    };
  }

  autoRefreshInProgress = true;
  try {
    const now = getHelsinkiNowParts();
    const targetDate = String(date ?? getPreviousDateIso(now.date)).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return {
        ok: false,
        executed: false,
        reason: "invalid_date",
        error: "date must be in format YYYY-MM-DD",
        trigger,
        date: targetDate,
      };
    }

    if (!/^\d{8}$/.test(String(seasonId))) {
      return {
        ok: false,
        executed: false,
        reason: "invalid_season_id",
        error: "seasonId must be an 8-digit string, e.g. 20252026",
        trigger,
        date: targetDate,
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(compareDate))) {
      return {
        ok: false,
        executed: false,
        reason: "invalid_compare_date",
        error: "compareDate must be in format YYYY-MM-DD",
        trigger,
        date: targetDate,
      };
    }

    if (!force && now.hour < AUTO_REFRESH_MIN_HOUR_FI) {
      return {
        ok: true,
        executed: false,
        reason: "before_refresh_window",
        trigger,
        date: targetDate,
        nowHourFI: now.hour,
        refreshHourFI: AUTO_REFRESH_MIN_HOUR_FI,
      };
    }

    const lastSuccessDate = getSetting("autoRefreshLastSuccessDate", "");
    if (!force && lastSuccessDate === targetDate) {
      return {
        ok: true,
        executed: false,
        reason: "already_done_for_date",
        trigger,
        date: targetDate,
        lastSuccessDate,
      };
    }

    if (targetDate >= SC_REQUIRED_TARGET_DATE && !(await hasScRosterSource())) {
      return {
        ok: true,
        executed: false,
        reason: "sc_rosters_missing",
        trigger,
        date: targetDate,
        requiredFromDate: SC_REQUIRED_TARGET_DATE,
      };
    }

    const readiness = await buildDataReadiness(targetDate);
    if (!readiness.ready) {
      return {
        ok: true,
        executed: false,
        reason: "readiness_false",
        trigger,
        date: targetDate,
        readiness,
      };
    }


    let refreshResult;
    try {
      refreshResult = await forceRefreshTipsenForFile({ fileName: "", seasonId, compareDate });
    } catch (error) {
      refreshResult = {
        file: "",
        status: "error",
        error: String(error?.message ?? "unknown error"),
      };
    }

    if (refreshResult.status !== "ok") {
      return {
        ok: false,
        executed: false,
        reason: "refresh_failed",
        trigger,
        date: targetDate,
        results: [refreshResult],
      };
    }

    const completedAt = new Date().toISOString();
    const snapshotResults = [];
    const snapshotErrors = [];

    if (await isNyheterSnapshotCollectionPaused()) {
      setSetting("autoRefreshLastSuccessDate", targetDate);
      setSetting("autoRefreshLastRunAt", completedAt);

      return {
        ok: true,
        executed: true,
        reason: "done",
        trigger,
        date: targetDate,
        compareDate,
        seasonId,
        completedAt,
        results: [refreshResult],
        snapshots: [],
        snapshotErrors: [],
        snapshotsPaused: true,
        snapshotsPauseReason: "sc_rosters_missing",
        snapshotRequiredFromDate: SC_REQUIRED_TARGET_DATE,
      };
    }

    try {
      const snapshotResult = await collectNyheterSnapshot({
        fileName: "",
        seasonId: String(seasonId),
        compareDate: String(compareDate),
        snapshotDate: targetDate,
        forceRefresh: false,
      });
      snapshotResults.push(snapshotResult);
    } catch (error) {
      snapshotErrors.push({
        file: "",
        error: String(error?.message ?? "unknown error"),
      });
    }

    setSetting("autoRefreshLastSuccessDate", targetDate);
    setSetting("autoRefreshLastRunAt", completedAt);

    return {
      ok: true,
      executed: true,
      reason: "done",
      trigger,
      date: targetDate,
      compareDate,
      seasonId,
      completedAt,
      results: [refreshResult],
      snapshots: snapshotResults,
      snapshotErrors,
    };
  } finally {
    autoRefreshInProgress = false;
  }
}

async function warmTipsenCacheOnStartup() {
  if (!STARTUP_CACHE_WARMUP_ENABLED) {
    console.log("[cache-warmup] startup warmup disabled");
    return;
  }

  const compareDate = getSetting("compareDate", DEFAULT_COMPARE_DATE);
  let rosterSource;
  try {
    rosterSource = await resolveActiveRosterSource(getHelsinkiTodayDate());
  } catch {
    console.log("[cache-warmup] skipped: no active roster source available");
    return;
  }

  console.log(
    `[cache-warmup] started — rosterSource=${rosterSource.sourceKey}, seasonId=${AUTO_REFRESH_SEASON_ID}, compareDate=${compareDate}`
  );

  const startedAt = Date.now();
  try {
    await forceRefreshTipsenForFile({
      fileName: "",
      seasonId: AUTO_REFRESH_SEASON_ID,
      compareDate,
    });
    const durationMs = Date.now() - startedAt;
    console.log(`[cache-warmup] completed (${durationMs}ms)`);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.warn(`[cache-warmup] failed (${durationMs}ms): ${String(error?.message ?? "unknown error")}`);
  }
}
function getCronTokenFromRequest(req) {
  return String(req.headers["x-cron-token"] ?? req.query.token ?? "").trim();
}

function hasTeamValidatorAccess(req) {
  // Open access when no security is configured at all
  if (!ADMIN_PROTECTION_ENABLED && !CRON_JOB_TOKEN) {
    return true;
  }

  const requestToken = getCronTokenFromRequest(req);
  if (CRON_JOB_TOKEN && requestToken === CRON_JOB_TOKEN) {
    return true;
  }

  return hasAdminCredentials(req);
}

function hasNyheterCollectorAccess(req) {
  if (!CRON_JOB_TOKEN) {
    return true;
  }

  const requestToken = getCronTokenFromRequest(req);
  if (requestToken === CRON_JOB_TOKEN) {
    return true;
  }

  return hasAdminCredentials(req);
}

async function handleDailyAutoRefreshRequest(req, res) {
  const requestToken = getCronTokenFromRequest(req);
  if (CRON_JOB_TOKEN && requestToken !== CRON_JOB_TOKEN) {
    res.status(401).json({ error: "Unauthorized cron token" });
    return;
  }

  const forceRaw = String(req.query.force ?? req.body?.force ?? "").trim().toLowerCase();
  const force = ["1", "true", "yes", "y"].includes(forceRaw);
  const date = String(req.query.date ?? req.body?.date ?? "").trim() || undefined;
  const seasonId = String(req.query.seasonId ?? req.body?.seasonId ?? AUTO_REFRESH_SEASON_ID).trim();
  const compareDate = String(
    req.query.compareDate ?? req.body?.compareDate ?? getSetting("compareDate", DEFAULT_COMPARE_DATE)
  ).trim();

  const result = await runDailyAutoRefresh({
    trigger: "cron_endpoint",
    date,
    seasonId,
    compareDate,
    force,
  });

  if (!result.ok) {
    res.status(500).json(result);
    return;
  }

  res.json(result);
}

async function tryAutoRefreshFromScheduler() {
  const result = await runDailyAutoRefresh({ trigger: "scheduler" });
  const summary = `${result.reason} (executed=${result.executed ? "yes" : "no"})`;
  console.log(`[auto-refresh] ${summary}`);
}

if (!getSetting("compareDate")) {
  setSetting("compareDate", DEFAULT_COMPARE_DATE);
}

clearResponseCacheOnVersionChange();

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeLastNameInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const withoutInitials = raw
    .replace(/^[a-z]\.?\s+/i, "")
    .replace(/^[a-z]\.?$/i, "");

  const parts = withoutInitials.split(/\s+/).filter(Boolean);
  const candidate = parts.length > 1 ? parts[parts.length - 1] : withoutInitials;
  return normalizeText(candidate);
}

function extractFirstInitial(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const compact = raw
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/^[a-z]\.\s*/i, (match) => match.replace(/\./g, ""));
  const normalized = normalizeText(compact);
  return normalized ? normalized[0] : "";
}

function extractDisplayLastNameFromFullName(fullNameValue) {
  const fullName = String(fullNameValue ?? "").trim();
  if (!fullName) {
    return "";
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  return parts[parts.length - 1];
}

function normalizeTipsenTeamToken(value) {
  const token = normalizeText(value);
  const aliasMap = {
    ana: "ANA",
    bos: "BOS",
    buf: "BUF",
    car: "CAR",
    cbj: "CBJ",
    col: "COL",
    colu: "CBJ",
    dal: "DAL",
    det: "DET",
    edm: "EDM",
    flo: "FLA",
    lak: "LAK",
    la: "LAK",
    min: "MIN",
    mon: "MTL",
    mtl: "MTL",
    nas: "NSH",
    nsh: "NSH",
    njd: "NJD",
    nyr: "NYR",
    ott: "OTT",
    phi: "PHI",
    pit: "PIT",
    sjs: "SJS",
    tam: "TBL",
    tbl: "TBL",
    tor: "TOR",
    uta: "UTA",
    vgk: "VGK",
    veg: "VGK",
    was: "WSH",
    wsh: "WSH",
    win: "WPG",
    wpg: "WPG",
    anaheim: "ANA",
    boston: "BOS",
    buffalo: "BUF",
    carolina: "CAR",
    columbus: "CBJ",
    colorado: "COL",
    dallas: "DAL",
    detroit: "DET",
    edmonton: "EDM",
    florida: "FLA",
    losangeles: "LAK",
    minnesota: "MIN",
    montreal: "MTL",
    nashville: "NSH",
    newjersey: "NJD",
    nyislanders: "NYI",
    nyrangers: "NYR",
    ottawa: "OTT",
    philadelphia: "PHI",
    pittsburgh: "PIT",
    sanjose: "SJS",
    tampa: "TBL",
    toronto: "TOR",
    utah: "UTA",
    vegas: "VGK",
    washington: "WSH",
    winnipeg: "WPG",
  };

  return aliasMap[token] ?? String(value ?? "").trim().toUpperCase();
}

function parseTipsenPlayerCell(cellValue) {
  const raw = String(cellValue ?? "").trim();
  if (!raw) {
    return null;
  }

  const match = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match) {
    return {
      playerLabel: raw,
      playerName: raw,
      lastNameNormalized: normalizeLastNameInput(raw),
      firstInitial: extractFirstInitial(raw),
      hasGivenNameHint: /\s/.test(raw),
      teamAbbrev: "",
    };
  }

  const playerName = String(match[1] ?? "").trim();
  const teamToken = String(match[2] ?? "").trim();
  return {
    playerLabel: raw,
    playerName,
    lastNameNormalized: normalizeLastNameInput(playerName),
    firstInitial: extractFirstInitial(playerName),
    hasGivenNameHint: /\s/.test(playerName),
    teamAbbrev: normalizeTipsenTeamToken(teamToken),
  };
}

function parseTemporaryRosterEntry(entryValue) {
  if (entryValue && typeof entryValue === "object") {
    const playerName = String(entryValue.playerName ?? "").trim();
    const teamAbbrev = normalizeTipsenTeamToken(String(entryValue.teamAbbrev ?? "").trim());
    if (!playerName || !teamAbbrev) {
      return null;
    }

    return parseTipsenPlayerCell(`${playerName} (${teamAbbrev})`);
  }

  const raw = String(entryValue ?? "").trim();
  if (!raw) {
    return null;
  }

  const commaMatch = raw.match(/^(.*?),\s*([A-Za-z]{2,})$/);
  if (commaMatch) {
    const playerName = String(commaMatch[1] ?? "").trim();
    const teamAbbrev = normalizeTipsenTeamToken(String(commaMatch[2] ?? "").trim());
    if (!playerName || !teamAbbrev) {
      return null;
    }
    return parseTipsenPlayerCell(`${playerName} (${teamAbbrev})`);
  }

  return parseTipsenPlayerCell(raw);
}

function getScRosterRowConfig() {
  return TIPSEN_PLAYER_ROWS.map((rowNumber, index) => {
    if (index < 2) {
      return { rowNumber, role: "Maalivahti", roleKey: "goalie" };
    }
    if (index < 6) {
      return { rowNumber, role: "Puolustaja", roleKey: "defense" };
    }
    return { rowNumber, role: "Hyökkääjä", roleKey: "forward" };
  });
}

function getScRostersPath() {
  return path.join(dataDir, SC_ROSTERS_FILE);
}

function getScRosterCandidatePaths() {
  const candidates = [
    path.join(dataDir, SC_ROSTERS_FILE),
    path.join(rootDir, "data", SC_ROSTERS_FILE),
  ];

  return Array.from(new Set(candidates));
}

async function resolveScRostersPath() {
  for (const candidatePath of getScRosterCandidatePaths()) {
    try {
      const stat = await fs.stat(candidatePath);
      if (stat.isFile()) {
        return candidatePath;
      }
    } catch {
      // Continue to next candidate path.
    }
  }

  throw new Error(`${SC_ROSTERS_FILE} not found`);
}

async function loadScRosters() {
  const filePath = await resolveScRostersPath();
  const raw = await fs.readFile(filePath, "utf8");
  const payload = JSON.parse(raw);

  if (payload?.enabled !== true) {
    throw new Error(`${SC_ROSTERS_FILE} exists but enabled is not true`);
  }

  if (!Array.isArray(payload?.participants) || payload.participants.length === 0) {
    throw new Error(`${SC_ROSTERS_FILE} must contain a non-empty participants array`);
  }

  const rowConfig = getScRosterRowConfig();
  const participantColumns = payload.participants.map((participant, participantIndex) => {
    const name = String(participant?.name ?? "").trim();
    if (!name) {
      throw new Error(`Participant at index ${participantIndex} is missing name`);
    }

    const goalies = Array.isArray(participant?.goalies) ? participant.goalies : [];
    const defenders = Array.isArray(participant?.defenders) ? participant.defenders : [];
    const forwards = Array.isArray(participant?.forwards) ? participant.forwards : [];

    if (goalies.length !== 2 || defenders.length !== 4 || forwards.length !== 6) {
      throw new Error(
        `Participant '${name}' must have exactly 2 goalies, 4 defenders and 6 forwards (got ${goalies.length}/${defenders.length}/${forwards.length})`
      );
    }

    const byRole = {
      goalie: goalies,
      defense: defenders,
      forward: forwards,
    };
    const roleOffsets = {
      goalie: 0,
      defense: 0,
      forward: 0,
    };
    const rosterByRow = new Map();

    for (const row of rowConfig) {
      const roleEntries = byRole[row.roleKey];
      const roleIndex = roleOffsets[row.roleKey];
      const parsed = parseTemporaryRosterEntry(roleEntries[roleIndex]);
      if (!parsed?.playerName || !parsed?.teamAbbrev) {
        throw new Error(
          `Participant '${name}' has invalid ${row.roleKey} entry at position ${roleIndex + 1} (expected 'Name (TEAM)' or { playerName, teamAbbrev })`
        );
      }

      rosterByRow.set(row.rowNumber, parsed);
      roleOffsets[row.roleKey] += 1;
    }

    return {
      name,
      playerCol: -1,
      pointsCol: -1,
      rosterByRow,
    };
  });

  return {
    participantColumns,
    rosterRows: rowConfig.map((row) => ({ rowNumber: row.rowNumber, role: row.role })),
  };
}

async function loadEnabledScRostersRaw() {
  try {
    const filePath = await resolveScRostersPath();
    const raw = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(raw);

    if (payload?.enabled !== true) {
      return null;
    }

    if (!Array.isArray(payload?.participants) || payload.participants.length === 0) {
      return null;
    }

    const stat = await fs.stat(filePath);
    return {
      participants: payload.participants,
      version: String(stat.mtimeMs),
      sourceLabel: SC_ROSTERS_FILE,
      rosterSource: "sc_rosters",
      sourceKey: `sc_rosters:${String(stat.mtimeMs)}`,
    };
  } catch {
    return null;
  }
}

async function getScRostersVersion() {
  try {
    const filePath = await resolveScRostersPath();
    await loadScRosters();
    const stat = await fs.stat(filePath);
    return String(stat.mtimeMs);
  } catch {
    return "";
  }
}

async function hasScRosters() {
  const version = await getScRostersVersion();
  return Boolean(version);
}

async function resolveActiveRosterSource(compareDate) {
  if (compareDate >= SC_REQUIRED_TARGET_DATE) {
    const sc = await loadEnabledScRostersRaw();
    if (sc) {
      return sc;
    }
  }

  throw new Error("No enabled SC roster source found (check period1-rosters.json enabled + participants)");
}

function buildTemporaryParticipantColumns(participants) {
  const rowConfig = getScRosterRowConfig();
  const participantColumns = participants.map((participant, participantIndex) => {
    const name = String(participant?.name ?? "").trim();
    if (!name) {
      throw new Error(`Participant at index ${participantIndex} is missing name`);
    }

    const goalies = Array.isArray(participant?.goalies) ? participant.goalies : [];
    const defenders = Array.isArray(participant?.defenders) ? participant.defenders : [];
    const forwards = Array.isArray(participant?.forwards) ? participant.forwards : [];

    if (goalies.length !== 2 || defenders.length !== 4 || forwards.length !== 6) {
      throw new Error(
        `Participant '${name}' must have exactly 2 goalies, 4 defenders and 6 forwards (got ${goalies.length}/${defenders.length}/${forwards.length})`
      );
    }

    const byRole = {
      goalie: goalies,
      defense: defenders,
      forward: forwards,
    };
    const roleOffsets = {
      goalie: 0,
      defense: 0,
      forward: 0,
    };
    const rosterByRow = new Map();

    for (const row of rowConfig) {
      const roleEntries = byRole[row.roleKey];
      const roleIndex = roleOffsets[row.roleKey];
      const parsed = parseTemporaryRosterEntry(roleEntries[roleIndex]);
      if (!parsed?.playerName || !parsed?.teamAbbrev) {
        throw new Error(
          `Participant '${name}' has invalid ${row.roleKey} entry at position ${roleIndex + 1} (expected 'Name (TEAM)' or { playerName, teamAbbrev })`
        );
      }

      rosterByRow.set(row.rowNumber, parsed);
      roleOffsets[row.roleKey] += 1;
    }

    return {
      name,
      playerCol: -1,
      pointsCol: -1,
      rosterByRow,
    };
  });

  return {
    participantColumns,
    rosterRows: rowConfig.map((row) => ({ rowNumber: row.rowNumber, role: row.role })),
  };
}

async function saveScRoster(participantName, rosterData) {
  const filePath = await resolveScRostersPath();
  
  try {
    const name = String(participantName ?? "").trim();
    if (!name || !Array.isArray(rosterData)) {
      throw new Error("Invalid participant name or roster data");
    }

    let payload = { enabled: true, participants: [] };
    
    try {
      const raw = await fs.readFile(filePath, "utf8");
      payload = JSON.parse(raw);
    } catch {
      // File doesn't exist or is invalid JSON, use default
    }

    if (!Array.isArray(payload.participants)) {
      payload.participants = [];
    }

    // Parse roster into role-based structure
    const goalies = rosterData.filter(p => p.role === "goalie").map(p => `${p.playerName} (${p.teamAbbrev})`);
    const defenders = rosterData.filter(p => p.role === "defense").map(p => `${p.playerName} (${p.teamAbbrev})`);
    const forwards = rosterData.filter(p => p.role === "forward").map(p => `${p.playerName} (${p.teamAbbrev})`);

    // Find and update or add participant
    const existingIndex = payload.participants.findIndex(p => p.name === name);
    const participantEntry = {
      name,
      goalies: goalies.length === 2 ? goalies : [],
      defenders: defenders.length === 4 ? defenders : [],
      forwards: forwards.length === 6 ? forwards : [],
    };

    if (existingIndex >= 0) {
      payload.participants[existingIndex] = participantEntry;
    } else {
      payload.participants.push(participantEntry);
    }

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
    return true;
  } catch (error) {
    console.error(`Failed to save SC roster for ${participantName}:`, error);
    return false;
  }
}

function buildPlayerLastTeamKey(playerName, teamAbbrev) {
  const lastName = normalizeLastNameInput(playerName);
  const team = normalizeTipsenTeamToken(teamAbbrev);
  if (!lastName || !team) {
    return "";
  }
  return `${lastName}|${team}`;
}

function buildPlayerFullTeamKey(playerName, teamAbbrev) {
  const fullName = normalizePersonName(playerName);
  const team = normalizeTipsenTeamToken(teamAbbrev);
  if (!fullName || !team) {
    return "";
  }
  return `${fullName}|${team}`;
}

function parseScRosterText(rosterText) {
  const lines = String(rosterText ?? "").split(/\r?\n/);
  const sectionMap = {
    maalivahdit: "goalie",
    puolustajat: "defense",
    hyokkaajat: "forward",
  };

  const players = [];
  const parseErrors = [];
  let currentRole = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] ?? "").trim();
    if (!line) {
      continue;
    }

    const normalizedHeading = normalizeText(line.replace(/:$/, ""));
    if (sectionMap[normalizedHeading]) {
      currentRole = sectionMap[normalizedHeading];
      continue;
    }

    if (!currentRole) {
      parseErrors.push(`Rivi ${index + 1}: otsikko puuttuu ennen pelaajariviä ('${line}')`);
      continue;
    }

    let playerName = "";
    let teamAbbrev = "";

    const parsedCell = parseTipsenPlayerCell(line);
    if (parsedCell?.playerName && parsedCell?.teamAbbrev) {
      playerName = String(parsedCell.playerName).trim();
      teamAbbrev = normalizeTipsenTeamToken(parsedCell.teamAbbrev);
    } else {
      const separatorIndex = line.lastIndexOf(",");
      if (separatorIndex >= 0) {
        playerName = String(line.slice(0, separatorIndex)).trim();
        const inputTeam = String(line.slice(separatorIndex + 1)).trim();
        teamAbbrev = normalizeTipsenTeamToken(inputTeam);
      }
    }

    if (!playerName || !teamAbbrev) {
      parseErrors.push(`Rivi ${index + 1}: pelaajarivin muoto pitää olla 'Nimi, JOUKKUE' tai 'Nimi (JOUKKUE)'`);
      continue;
    }

    players.push({
      row: index + 1,
      role: currentRole,
      playerName,
      teamAbbrev,
      lastTeamKey: buildPlayerLastTeamKey(playerName, teamAbbrev),
      fullTeamKey: buildPlayerFullTeamKey(playerName, teamAbbrev),
    });
  }

  return {
    players,
    parseErrors,
  };
}

function addEntryToMapArray(map, key, entry) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(entry);
}

function findRankEntry(player, byFullKey, byLastKey) {
  const fullMatches = byFullKey.get(player.fullTeamKey) ?? [];
  if (fullMatches.length === 1) {
    return { entry: fullMatches[0], warning: "" };
  }
  if (fullMatches.length > 1) {
    return {
      entry: fullMatches[0],
      warning: `${player.playerName} (${player.teamAbbrev}): useita full-name osumia rankingissa, käytetään parasta rankia`,
    };
  }

  const lastMatches = byLastKey.get(player.lastTeamKey) ?? [];
  if (lastMatches.length === 1) {
    return { entry: lastMatches[0], warning: "" };
  }
  if (lastMatches.length > 1) {
    return {
      entry: lastMatches[0],
      warning: `${player.playerName} (${player.teamAbbrev}): useita surname-osumia rankingissa, käytetään parasta rankia`,
    };
  }

  return {
    entry: null,
    warning: `${player.playerName} (${player.teamAbbrev}): ei löytynyt rankinglistalta`,
  };
}

function buildOwnershipIndexFromRosters(participants) {
  if (!Array.isArray(participants)) {
    return {
      byLastTeam: new Map(),
      byParticipant: new Map(),
    };
  }

  const byLastTeam = new Map();
  const byParticipant = new Map();

  for (const participant of participants) {
    const name = String(participant?.name ?? "").trim();
    if (!name) {
      continue;
    }

    if (!byParticipant.has(name)) {
      byParticipant.set(name, new Set());
    }

    const allPlayers = [
      ...(Array.isArray(participant.goalies) ? participant.goalies : []),
      ...(Array.isArray(participant.defenders) ? participant.defenders : []),
      ...(Array.isArray(participant.forwards) ? participant.forwards : []),
    ];

    for (const playerStr of allPlayers) {
      const parsed = parseTipsenPlayerCell(playerStr);
      if (!parsed?.playerName || !parsed?.teamAbbrev) {
        continue;
      }

      const key = buildPlayerLastTeamKey(parsed.playerName, parsed.teamAbbrev);
      if (!key) {
        continue;
      }

      if (!byLastTeam.has(key)) {
        byLastTeam.set(key, new Set());
      }
      byLastTeam.get(key).add(name);
      byParticipant.get(name).add(key);
    }
  }

  return {
    byLastTeam,
    byParticipant,
  };
}

async function buildScRankingData({ fileName, seasonId, fromDate, toDate, gameTypeId = 2 }) {
  const cacheKey = `${fileName}|${seasonId}|${fromDate}|${toDate}|${gameTypeId}`;
  const cacheFreshMs = 10 * 60 * 1000;
  if (
    scValidatorRankingCache.data &&
    scValidatorRankingCache.cacheKey === cacheKey &&
    Date.now() - scValidatorRankingCache.cachedAt < cacheFreshMs
  ) {
    return scValidatorRankingCache.data;
  }

  const inFlightRequest = scValidatorRankingInFlightByCacheKey.get(cacheKey);
  if (inFlightRequest) {
    return await inFlightRequest;
  }

  const computePromise = (async () => {
    function encodeSort(sortObj) {
      return encodeURIComponent(JSON.stringify(sortObj));
    }

    function buildStatsSummaryUrl({ entity, start, limit, sortExpr, cayenneExp }) {
      return (
        `https://api.nhle.com/stats/rest/en/${entity}/summary` +
        `?isAggregate=false&isGame=false&start=${start}&limit=${limit}` +
        `&sort=${encodeSort(sortExpr)}` +
        `&cayenneExp=${encodeURIComponent(cayenneExp)}`
      );
    }

    async function fetchStatsSummaryAll({ entity, sortExpr, cayenneExp }) {
    const limit = 200;
    let start = 0;
    let total = Number.POSITIVE_INFINITY;
    const rows = [];

    while (start < total) {
      const url = buildStatsSummaryUrl({
        entity,
        start,
        limit,
        sortExpr,
        cayenneExp,
      });

      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "nhl-stats-web/1.0",
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`NHL stats API ${response.status}: ${body.slice(0, 250)}`);
      }

      const payload = await response.json();
      const pageData = Array.isArray(payload?.data) ? payload.data : [];
      total = Number(payload?.total ?? pageData.length);
      rows.push(...pageData);

      if (pageData.length === 0) {
        break;
      }

      start += pageData.length;
    }

    return rows;
  }

  function normalizeStatsTeamAbbrev(value) {
    const token = String(value ?? "")
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean)
      .pop();
    return token || "";
  }

  const cayenneExp = `seasonId=${seasonId} and gameTypeId=${gameTypeId} and gameDate<="${toDate}" and gameDate>="${fromDate}"`;
  const skaterRows = await fetchStatsSummaryAll({
    entity: "skater",
    sortExpr: [
      { property: "points", direction: "DESC" },
      { property: "goals", direction: "DESC" },
    ],
    cayenneExp,
  });

  const goalieRows = await fetchStatsSummaryAll({
    entity: "goalie",
    sortExpr: [
      { property: "wins", direction: "DESC" },
      { property: "gamesPlayed", direction: "DESC" },
    ],
    cayenneExp,
  });

  const skaters = skaterRows
    .map((row) => ({
      fullName: String(row?.skaterFullName ?? "").trim(),
      teamAbbrev: normalizeStatsTeamAbbrev(row?.teamAbbrevs),
      isGoalie: false,
      points: Number(row?.points ?? 0),
      goals: Number(row?.goals ?? 0),
      wins: 0,
    }))
    .filter((row) => row.fullName && row.teamAbbrev)
    .sort((left, right) => right.points - left.points || right.goals - left.goals || left.fullName.localeCompare(right.fullName));

  const goalies = goalieRows
    .map((row) => ({
      fullName: String(row?.goalieFullName ?? "").trim(),
      teamAbbrev: normalizeStatsTeamAbbrev(row?.teamAbbrevs),
      isGoalie: true,
      points:
        Number(row?.wins ?? 0) * 2 +
        Number(row?.goals ?? 0) +
        Number(row?.assists ?? 0) +
        Number(row?.shutouts ?? 0) * 2,
      goals: 0,
      wins: Number(row?.wins ?? 0),
      gamesPlayed: Number(row?.gamesPlayed ?? 0),
    }))
    .filter((row) => row.fullName && row.teamAbbrev)
    .sort((left, right) => right.wins - left.wins || right.gamesPlayed - left.gamesPlayed || left.fullName.localeCompare(right.fullName));

  const skaterByFullKey = new Map();
  const skaterByLastKey = new Map();
  for (let index = 0; index < skaters.length; index += 1) {
    const row = skaters[index];
    const entry = {
      ...row,
      rank: index + 1,
      fullTeamKey: buildPlayerFullTeamKey(row.fullName, row.teamAbbrev),
      lastTeamKey: buildPlayerLastTeamKey(row.fullName, row.teamAbbrev),
    };

    addEntryToMapArray(skaterByFullKey, entry.fullTeamKey, entry);
    addEntryToMapArray(skaterByLastKey, entry.lastTeamKey, entry);
  }

  const goalieByFullKey = new Map();
  const goalieByLastKey = new Map();
  for (let index = 0; index < goalies.length; index += 1) {
    const row = goalies[index];
    const entry = {
      ...row,
      rank: index + 1,
      fullTeamKey: buildPlayerFullTeamKey(row.fullName, row.teamAbbrev),
      lastTeamKey: buildPlayerLastTeamKey(row.fullName, row.teamAbbrev),
    };

    addEntryToMapArray(goalieByFullKey, entry.fullTeamKey, entry);
    addEntryToMapArray(goalieByLastKey, entry.lastTeamKey, entry);
  }

    const data = {
      skaterByFullKey,
      skaterByLastKey,
      goalieByFullKey,
      goalieByLastKey,
    };

    scValidatorRankingCache = {
      cacheKey,
      cachedAt: Date.now(),
      data,
    };

    return data;
  })();

  scValidatorRankingInFlightByCacheKey.set(cacheKey, computePromise);
  try {
    return await computePromise;
  } finally {
    scValidatorRankingInFlightByCacheKey.delete(cacheKey);
  }
}

async function validateTeam({
  participantName,
  rosterText,
  seasonId,
  rankingFrom,
  rankingTo,
  competitionType,
  previousRosterData,
  previousRosterFile,
}) {
  const errors = [];
  const warnings = [];

  const parsed = parseScRosterText(rosterText);
  if (parsed.parseErrors.length) {
    errors.push(...parsed.parseErrors);
    return {
      status: "FAIL",
      errors,
      warnings,
      diagnostics: {},
    };
  }

  const roster = parsed.players;
  const roleCounts = {
    goalies: roster.filter((item) => item.role === "goalie").length,
    defense: roster.filter((item) => item.role === "defense").length,
    forwards: roster.filter((item) => item.role === "forward").length,
  };

  if (roleCounts.goalies !== 2 || roleCounts.defense !== 4 || roleCounts.forwards !== 6) {
    errors.push(
      `Roolijakauma virhe: odotettu 2 maalivahtia, 4 puolustajaa, 6 hyökkääjää (nyt ${roleCounts.goalies}/${roleCounts.defense}/${roleCounts.forwards})`
    );
  }

  if (roster.length !== 12) {
    errors.push(`Kokonaispelaajamäärä virhe: odotettu 12, nyt ${roster.length}`);
  }

  const seenPlayers = new Set();
  for (const player of roster) {
    if (!player.lastTeamKey) {
      continue;
    }
    if (seenPlayers.has(player.lastTeamKey)) {
      errors.push(`Duplikaattipelaaja: ${player.playerName} (${player.teamAbbrev})`);
    }
    seenPlayers.add(player.lastTeamKey);
  }

  const teamCounts = roster.reduce((acc, player) => {
    const key = player.teamAbbrev;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  for (const [teamAbbrev, count] of Object.entries(teamCounts)) {
    if (count > 2) {
      errors.push(`Liikaa pelaajia samasta joukkueesta: ${teamAbbrev} (${count} kpl, max 2)`);
    }
  }

  // Build ownership index from previous roster data if provided
  let ownership = null;
  if (previousRosterData) {
    // previousRosterData provided (e.g., from period1-rosters.json for Period 1->2 transition)
    ownership = buildOwnershipIndexFromRosters(previousRosterData);
  } else if (previousRosterFile !== undefined) {
    // previousRosterFile parameter was explicitly provided (even if empty)
    // This means Period 1 validation with clean slate - no ownership checks
    ownership = null;
  } else {
    // No previous-phase ownership source was provided for this validation path.
    ownership = null;
  }

  // Only check ownership if we have data (not Period 1)
  if (ownership) {
    const participantPeriod2Keys = ownership.byParticipant.get(participantName) ?? new Set();
    if (participantPeriod2Keys.size > 0) {
      const unchangedPlayers = roster.filter((player) => participantPeriod2Keys.has(player.lastTeamKey));
      const changedCount = roster.length - unchangedPlayers.length;
      if (changedCount < 2) {
        const unchangedList = unchangedPlayers
          .map((player) => `${player.playerName} (${player.teamAbbrev})`)
          .sort((left, right) => left.localeCompare(right))
          .join(", ");
        errors.push(
          `Vaihtosääntö rikki: Stanley Cup -joukkueessa pitää vaihtaa vähintään 2 pelaajaa aiempaan rosteriin verrattuna (nyt vaihdettu ${changedCount}). Samana pysyneet: ${unchangedList}`
        );
      }
    }

    for (const player of roster) {
      const owners = ownership.byLastTeam.get(player.lastTeamKey);
      if (!owners || owners.size === 0) {
        continue;
      }
      if (!owners.has(participantName)) {
        const ownerNames = Array.from(owners.values()).sort((a, b) => a.localeCompare(b));
        errors.push(
          `Omistussääntö rikki: ${player.playerName} (${player.teamAbbrev}) oli aiemmassa rosterissa osallistujalla ${ownerNames.join(", ")}, ei ${participantName}`
        );
      }
    }
  }

  const ranking = await buildScRankingData({
    fileName: competitionType || "",
    seasonId,
    fromDate: rankingFrom,
    toDate: rankingTo,
  });

  const selectedSkaters = roster.filter((item) => item.role !== "goalie");
  const selectedGoalies = roster.filter((item) => item.role === "goalie");

  const skaterRankedSelections = [];
  for (const skater of selectedSkaters) {
    const match = findRankEntry(skater, ranking.skaterByFullKey, ranking.skaterByLastKey);
    if (match.warning) {
      warnings.push(match.warning);
    }
    if (match.entry) {
      skaterRankedSelections.push({
        playerName: skater.playerName,
        teamAbbrev: skater.teamAbbrev,
        rank: match.entry.rank,
      });
    }
  }

  const skaterRanks = skaterRankedSelections.map((item) => item.rank);

  const skaterBandCounts = {};
  for (const rank of skaterRanks) {
    const band = Math.floor((rank - 1) / 10) + 1;
    skaterBandCounts[band] = (skaterBandCounts[band] ?? 0) + 1;
  }

  const skaterRankedWithBand = skaterRankedSelections.map((item) => ({
    ...item,
    band: Math.floor((item.rank - 1) / 10) + 1,
  }));

  const maxBand = Math.max(0, ...Object.keys(skaterBandCounts).map((value) => Number.parseInt(value, 10)));
  let cumulative = 0;
  for (let band = 1; band <= maxBand; band += 1) {
    const currentBandCount = skaterBandCounts[band] ?? 0;
    const previousBandsCount = cumulative;
    cumulative += currentBandCount;
    if (cumulative > band) {
      const startRank = (band - 1) * 10 + 1;
      const endRank = band * 10;
      const bandLabel = `${startRank}-${endRank}`;
      const allowedInCurrentBand = Math.max(0, band - previousBandsCount);
      const currentBandPlayers = skaterRankedWithBand
        .filter((item) => item.band === band)
        .sort((left, right) => left.rank - right.rank)
        .map((item) => `${item.playerName} (${item.teamAbbrev}) #${item.rank}`)
        .join(", ");

      errors.push(
        `Ulkopelaajien bandisääntö rikki: bandissa ${bandLabel} valittu ${currentBandCount} pelaajaa (max ${allowedInCurrentBand}), koska bandeissa 1-${band - 1} on jo ${previousBandsCount} valintaa. Pelaajat: ${currentBandPlayers}`
      );
      break;
    }
  }

  const goalieRanks = [];
  for (const goalie of selectedGoalies) {
    const match = findRankEntry(goalie, ranking.goalieByFullKey, ranking.goalieByLastKey);
    if (match.warning) {
      warnings.push(match.warning);
    }
    if (match.entry) {
      goalieRanks.push(match.entry.rank);
    }
  }

  if (goalieRanks.length === 2) {
    const goalieRankSum = goalieRanks[0] + goalieRanks[1];
    if (goalieRankSum < 29) {
      errors.push(`Maalivahtien rank-summa liian pieni: ${goalieRankSum} (min 29)`);
    }
  } else if (selectedGoalies.length === 2) {
    warnings.push("Maalivahtien rank-summaa ei voitu varmistaa täysin, koska rankingosuma puuttuu");
  }

  return {
    status: errors.length > 0 ? "FAIL" : "PASS",
    errors,
    warnings,
    diagnostics: {
      participantName,
      roleCounts,
      teamCounts,
      skaterBandCounts,
      knownSkaterRanks: skaterRanks,
      knownGoalieRanks: goalieRanks,
      rankingWindow: {
        from: rankingFrom,
        to: rankingTo,
      },
      competitionType: competitionType || "",
    },
  };
}

function buildCompareIndexes(compareItems) {
  const byTeamAndLast = new Map();
  const byTeamLastAndInitial = new Map();
  const byLastName = new Map();
  const byLastAndInitial = new Map();

  for (const item of compareItems ?? []) {
    if (item?.status === "fetch_error") {
      continue;
    }

    const teamAbbrev = String(item.teamAbbrev ?? "").trim().toUpperCase();
    const itemName = item.inputName || item.fullName || "";
    const lastNameNormalized = normalizeLastNameInput(itemName);
    const firstInitial = extractFirstInitial(itemName);
    if (!lastNameNormalized) {
      continue;
    }

    if (teamAbbrev) {
      byTeamAndLast.set(`${teamAbbrev}|${lastNameNormalized}`, item);
      if (firstInitial) {
        const key = `${teamAbbrev}|${lastNameNormalized}|${firstInitial}`;
        if (!byTeamLastAndInitial.has(key)) {
          byTeamLastAndInitial.set(key, []);
        }
        byTeamLastAndInitial.get(key).push(item);
      }
    }

    if (!byLastName.has(lastNameNormalized)) {
      byLastName.set(lastNameNormalized, []);
    }
    byLastName.get(lastNameNormalized).push(item);

    if (firstInitial) {
      const key = `${lastNameNormalized}|${firstInitial}`;
      if (!byLastAndInitial.has(key)) {
        byLastAndInitial.set(key, []);
      }
      byLastAndInitial.get(key).push(item);
    }
  }

  return { byTeamAndLast, byTeamLastAndInitial, byLastName, byLastAndInitial };
}

function pickTipsenTeamCandidate(players, parsedCell) {
  if (!Array.isArray(players) || players.length === 0) {
    return null;
  }

  const byLastName = players.filter(
    (candidate) => normalizeLastNameInput(candidate?.lastName?.default ?? "") === parsedCell.lastNameNormalized
  );

  const exactPool = byLastName.length > 0 ? byLastName : players;
  const byInitial = parsedCell.firstInitial && parsedCell.hasGivenNameHint
    ? exactPool.filter(
        (candidate) => extractFirstInitial(candidate?.firstName?.default ?? "") === parsedCell.firstInitial
      )
    : exactPool;

  const narrowed = byInitial.length > 0 ? byInitial : exactPool;

  const fuzzyCandidates = narrowed
    .map((candidate) => {
      const candidateLastName = normalizeLastNameInput(candidate?.lastName?.default ?? "");
      const distance = levenshteinDistance(parsedCell.lastNameNormalized, candidateLastName);
      const samePrefix = parsedCell.lastNameNormalized.slice(0, 4) === candidateLastName.slice(0, 4);
      return {
        candidate,
        distance,
        samePrefix,
      };
    })
    .filter((entry) => {
      const input = parsedCell.lastNameNormalized;
      const target = normalizeLastNameInput(entry.candidate?.lastName?.default ?? "");
      if (!target || !input) {
        return false;
      }

      if (target === input) {
        return true;
      }

      if (entry.samePrefix && entry.distance <= 5) {
        return true;
      }

      return target.includes(input) || input.includes(target);
    })
    .sort((left, right) => {
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return (right.candidate?.points ?? 0) - (left.candidate?.points ?? 0);
    });

  return fuzzyCandidates[0]?.candidate ?? null;
}

async function resolveTipsenLiveSnapshot({ parsedCell, seasonId, compareDate, teamCache, snapshotCache, gameTypeId = 2 }) {
  const cacheKey = `${parsedCell.teamAbbrev}|${parsedCell.lastNameNormalized}|${parsedCell.firstInitial}`;
  if (snapshotCache.has(cacheKey)) {
    return snapshotCache.get(cacheKey);
  }

  if (!parsedCell.teamAbbrev || !parsedCell.lastNameNormalized) {
    snapshotCache.set(cacheKey, null);
    return null;
  }

  if (!teamCache.has(parsedCell.teamAbbrev)) {
    teamCache.set(parsedCell.teamAbbrev, await buildTeamPlayerIndex(parsedCell.teamAbbrev));
  }

  const teamBundle = teamCache.get(parsedCell.teamAbbrev);
  const teamPlayers = teamBundle?.players ?? [];
  const candidate = pickTipsenTeamCandidate(teamPlayers, parsedCell);

  if (!candidate?.playerId) {
    snapshotCache.set(cacheKey, null);
    return null;
  }

  try {
    const [landing, gameLogPayload] = await Promise.all([
      fetchJsonDirect(`/player/${candidate.playerId}/landing`),
      fetchJsonDirect(`/player/${candidate.playerId}/game-log/${seasonId}/${gameTypeId}`),
    ]);

    const gameLog = Array.isArray(gameLogPayload?.gameLog) ? gameLogPayload.gameLog : [];
    const gamesUntilDate = gameLog.filter((game) => String(game.gameDate) <= compareDate);
    const isGoalie = String(landing?.position ?? "").toUpperCase() === "G";
    const comparePoints = isGoalie
      ? sumGoalieFantasyPoints(gamesUntilDate)
      : gamesUntilDate.reduce((sum, game) => sum + Number(game?.points ?? 0), 0);
    const todayPoints = isGoalie ? sumGoalieFantasyPoints(gameLog) : Number(candidate?.points ?? 0);
    const deltaPoints = Number.isFinite(todayPoints) && Number.isFinite(comparePoints) ? todayPoints - comparePoints : null;
    const fullName = `${landing?.firstName?.default ?? ""} ${landing?.lastName?.default ?? ""}`.trim();

    const snapshot = {
      deltaPoints,
      matchedFullName: fullName,
      matchedLastName: String(landing?.lastName?.default ?? "").trim(),
      teamAbbrev: String(landing?.currentTeamAbbrev ?? parsedCell.teamAbbrev ?? "").trim().toUpperCase(),
      source: "nhl_live_fallback",
    };
    snapshotCache.set(cacheKey, snapshot);
    return snapshot;
  } catch {
    snapshotCache.set(cacheKey, null);
    return null;
  }
}

function pickField(row, keys) {
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    if (keys.includes(normalized) && value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error) {
  const message = String(error?.message ?? "");
  return /\b429\b|rate.?limit|too many requests/i.test(message);
}

function isTransientUpstreamError(error) {
  const message = String(error?.message ?? "");
  return /\b429\b|rate.?limit|too many requests|timeout|timed out|econnreset|socket hang up|fetch failed/i.test(
    message
  );
}

async function waitForMcpThrottleSlot() {
  if (!useMcpBridge || MCP_MIN_CALL_INTERVAL_MS <= 0) {
    return;
  }

  let releaseLock = null;
  const previousLock = mcpThrottleLock;
  mcpThrottleLock = new Promise((resolve) => {
    releaseLock = resolve;
  });

  await previousLock;
  try {
    const waitMs = Math.max(0, mcpNextAllowedAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    mcpNextAllowedAt = Date.now() + MCP_MIN_CALL_INTERVAL_MS;
  } finally {
    releaseLock();
  }
}

async function fetchJson(pathname) {
  if (!useMcpBridge) {
    return fetchJsonDirect(pathname);
  }

  const routeMap = [
    {
      pattern: /^\/standings\/now$/,
      call: () => callMcpTool("get_standings_now", {}),
    },
    {
      pattern: /^\/club-stats\/([A-Z]{2,3})\/now$/,
      call: (match) => callMcpTool("get_team_stats_now", { teamAbbrev: match[1] }),
    },
    {
      pattern: /^\/player\/(\d+)\/landing$/,
      call: (match) => callMcpTool("get_player_landing", { playerId: Number.parseInt(match[1], 10) }),
    },
    {
      pattern: /^\/player\/(\d+)\/game-log\/(\d{8})\/(\d+)$/,
      call: (match) => callMcpTool("get_player_game_log", {
        playerId: Number.parseInt(match[1], 10),
        seasonId: match[2],
        gameTypeId: Number.parseInt(match[3], 10),
      }),
    },
  ];

  for (const route of routeMap) {
    const match = pathname.match(route.pattern);
    if (match) {
      try {
        return await route.call(match);
      } catch (error) {
        if (!isTransientUpstreamError(error)) {
          throw error;
        }

        console.warn(`MCP request failed for ${pathname}, falling back to direct NHL API: ${error.message}`);
        return fetchJsonDirect(pathname);
      }
    }
  }

  throw new Error(`Unsupported MCP-mapped path: ${pathname}`);
}

async function fetchJsonDirect(pathname) {
  const url = `${NHL_API_BASE}${pathname}`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "nhl-stats-web/1.0",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`NHL API ${response.status}: ${body.slice(0, 300)}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      if (isRateLimitError(error)) {
        await sleep(attempt * 2000);
      } else {
        await sleep(attempt * 500);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error(`Failed direct NHL API fetch: ${pathname}`);
}

function normalizePersonName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatInjuryTimeline(injuryItem) {
  const returnDate = String(injuryItem?.details?.returnDate ?? "").trim();
  const shortComment = String(injuryItem?.shortComment ?? "").trim();
  const longComment = String(injuryItem?.longComment ?? "").trim();

  if (shortComment && /day-to-day/i.test(shortComment)) {
    return shortComment;
  }

  if (longComment && /day-to-day/i.test(longComment)) {
    return longComment;
  }

  if (returnDate) {
    return `At least ${returnDate}`;
  }

  if (shortComment) {
    return shortComment;
  }

  if (longComment) {
    return longComment;
  }

  return "";
}

async function fetchEspnNhlInjuries() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(ESPN_NHL_INJURIES_URL, {
      headers: {
        accept: "application/json",
        "user-agent": "nhl-stats-web/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ESPN injuries ${response.status}: ${body.slice(0, 200)}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildInjuryLookup(payload) {
  const map = new Map();
  const teams = Array.isArray(payload?.injuries) ? payload.injuries : [];

  for (const teamEntry of teams) {
    const injuries = Array.isArray(teamEntry?.injuries) ? teamEntry.injuries : [];

    for (const injuryItem of injuries) {
      const athleteName = injuryItem?.athlete?.displayName;
      const nameKey = normalizePersonName(athleteName);
      if (!nameKey) {
        continue;
      }

      const status = String(injuryItem?.status ?? injuryItem?.type?.description ?? "").trim() || "Injured";
      const timeline = formatInjuryTimeline(injuryItem);
      map.set(nameKey, {
        status,
        timeline,
        source: "espn",
      });
    }
  }

  return map;
}

async function getInjuryLookup() {
  const now = Date.now();
  const maxAgeMs = 15 * 60 * 1000;
  if (injuryCache.data.size > 0 && now - injuryCache.fetchedAt < maxAgeMs) {
    return injuryCache.data;
  }

  if (injuryCacheFetchPromise) {
    return await injuryCacheFetchPromise;
  }

  injuryCacheFetchPromise = (async () => {
    try {
      const payload = await fetchEspnNhlInjuries();
      const lookup = buildInjuryLookup(payload);
      injuryCache = {
        fetchedAt: Date.now(),
        data: lookup,
      };
      return lookup;
    } catch (error) {
      console.warn(`Injury lookup unavailable: ${error.message}`);
      return injuryCache.data;
    } finally {
      injuryCacheFetchPromise = null;
    }
  })();

  return await injuryCacheFetchPromise;
}

function resolveInjuryForPlayer({ matchedFullName, playerLabel }, injuryLookup) {
  const fullNameKey = normalizePersonName(matchedFullName);
  if (fullNameKey && injuryLookup.has(fullNameKey)) {
    return injuryLookup.get(fullNameKey);
  }

  const labelKey = normalizePersonName(playerLabel);
  if (labelKey && injuryLookup.has(labelKey)) {
    return injuryLookup.get(labelKey);
  }

  return null;
}

function getResultText(result) {
  const textContent = (result?.content ?? []).find((part) => part?.type === "text")?.text;
  if (!textContent) {
    throw new Error("MCP tool returned empty response content");
  }
  return textContent;
}

function parseToolJson(result) {
  const text = getResultText(result);

  if (result?.isError) {
    throw new Error(`MCP tool error: ${text}`);
  }

  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    throw new Error(`MCP non-JSON response: ${trimmed.slice(0, 200)}`);
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`MCP JSON parse failed: ${error.message}; payload: ${trimmed.slice(0, 200)}`);
  }
}

async function createMcpClient() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["src/server.js"],
    cwd: rootDir,
  });

  const client = new Client(
    {
      name: "nhl-stats-web-client",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);
  mcpClientInitialized = true;
  return client;
}

async function getMcpClient() {
  if (!mcpClientPromise) {
    mcpClientPromise = createMcpClient();
  }

  try {
    return await mcpClientPromise;
  } catch (error) {
    mcpClientPromise = null;
    mcpClientInitialized = false;
    throw error;
  }
}

async function ensureMcpClientReady(timeoutMs = 30000) {
  if (mcpClientInitialized) return;
  
  const startTime = Date.now();
  while (!mcpClientInitialized && Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  if (!mcpClientInitialized) {
    throw new Error(`MCP client failed to initialize within ${timeoutMs}ms`);
  }
}

async function callMcpTool(name, args) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let timeoutId = null;
    try {
      await waitForMcpThrottleSlot();
      const client = await getMcpClient();
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`MCP tool timeout after ${MCP_TOOL_TIMEOUT_MS}ms (${name})`));
        }, MCP_TOOL_TIMEOUT_MS);
      });

      const result = await Promise.race([client.callTool({ name, arguments: args }), timeoutPromise]);
      return parseToolJson(result);
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      const backoffMs = isRateLimitError(error) ? attempt * 3000 : attempt * 500;
      await sleep(backoffMs);
      mcpClientPromise = null;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  throw new Error(`Failed MCP tool call: ${name}`);
}

function extractSeasonStats(playerLanding, seasonId, gameTypeId = 2) {
  const requested = Number.parseInt(String(seasonId), 10);
  const seasonRow = (playerLanding.seasonTotals ?? []).find(
    (row) => row?.season === requested && row?.gameTypeId === gameTypeId && row?.leagueAbbrev === "NHL"
  );

  const featuredBranch = gameTypeId === 3 ? "playoffs" : "regularSeason";
  const featured = playerLanding?.featuredStats?.[featuredBranch]?.subSeason;
  const featuredSeason = playerLanding?.featuredStats?.season;

  if (seasonRow) {
    return {
      gamesPlayed: seasonRow.gamesPlayed ?? null,
      goals: seasonRow.goals ?? null,
      assists: seasonRow.assists ?? null,
      points: seasonRow.points ?? null,
      pim: seasonRow.pim ?? null,
      plusMinus: seasonRow.plusMinus ?? null,
      shots: seasonRow.shots ?? null,
    };
  }

  if (featured && Number(featuredSeason) === requested) {
    return {
      gamesPlayed: featured.gamesPlayed ?? null,
      goals: featured.goals ?? null,
      assists: featured.assists ?? null,
      points: featured.points ?? null,
      pim: featured.pim ?? null,
      plusMinus: featured.plusMinus ?? null,
      shots: featured.shots ?? null,
    };
  }

  return null;
}

function getGoalieGameFantasyPoints(game) {
  const isWin = String(game?.decision ?? "").toUpperCase() === "W";
  const winsPoints = isWin ? 2 : 0;
  const skaterPoints = Number(game?.goals ?? 0) + Number(game?.assists ?? 0);
  const shutoutPoints = Number(game?.shutouts ?? 0) > 0 ? 2 : 0;
  return winsPoints + skaterPoints + shutoutPoints;
}

function sumGoalieFantasyPoints(games) {
  return (games ?? []).reduce((sum, game) => sum + getGoalieGameFantasyPoints(game), 0);
}

async function hasScRosterSource() {
  return hasScRosters();
}

async function isNyheterSnapshotCollectionPaused() {
  return !(await hasScRosterSource());
}

async function resolveTeamMap() {
  const standings = await fetchJson("/standings/now");
  const map = new Map();

  for (const entry of standings.standings ?? []) {
    const teamAbbrev = entry?.teamAbbrev?.default;
    const placeName = entry?.placeName?.default;
    const teamCommon = entry?.teamCommonName?.default;
    const fullTeamName = entry?.teamName?.default;

    if (teamAbbrev) {
      map.set(normalizeText(teamAbbrev), teamAbbrev);
    }
    if (placeName) {
      map.set(normalizeText(placeName), teamAbbrev);
    }
    if (teamCommon) {
      map.set(normalizeText(teamCommon), teamAbbrev);
    }
    if (fullTeamName) {
      map.set(normalizeText(fullTeamName), teamAbbrev);
    }
  }

  map.set("njdevils", "NJD");
  map.set("newjerseydevils", "NJD");
  map.set("nyrangers", "NYR");
  map.set("newyorkrangers", "NYR");
  map.set("sanjose", "SJS");
  map.set("sanjosesharks", "SJS");
  map.set("montreal", "MTL");

  return map;
}

async function buildTeamPlayerIndex(teamAbbrev) {
  const clubStats = await fetchJson(`/club-stats/${teamAbbrev}/now`);
  const players = [...(clubStats.skaters ?? []), ...(clubStats.goalies ?? [])];
  const index = new Map();

  for (const player of players) {
    const key = normalizeText(player?.lastName?.default ?? "");
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(player);
  }

  return { clubStats, index, players };
}

function levenshteinDistance(a, b) {
  const left = a ?? "";
  const right = b ?? "";

  if (left === right) {
    return 0;
  }

  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}

function selectBestCandidate(candidates) {
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => {
    const pointsA = a.player?.points ?? -1;
    const pointsB = b.player?.points ?? -1;
    if (pointsB !== pointsA) {
      return pointsB - pointsA;
    }
    return (b.player?.gamesPlayed ?? 0) - (a.player?.gamesPlayed ?? 0);
  });

  return candidates[0];
}

function buildInputPlayersFromRosterParticipants(participants) {
  const seenKeys = new Set();
  const players = [];
  let rowNumber = 1;

  for (const participant of participants ?? []) {
    const roleGroups = [
      { entries: Array.isArray(participant?.goalies) ? participant.goalies : [], sourceSectionType: "goalies" },
      { entries: Array.isArray(participant?.defenders) ? participant.defenders : [], sourceSectionType: "" },
      { entries: Array.isArray(participant?.forwards) ? participant.forwards : [], sourceSectionType: "" },
    ];

    for (const roleGroup of roleGroups) {
      for (const item of roleGroup.entries) {
        const parsed = parseTemporaryRosterEntry(item);
        if (!parsed?.playerName || !parsed?.teamAbbrev) {
          continue;
        }

        const dedupeKey = buildPlayerLastTeamKey(parsed.playerName, parsed.teamAbbrev);
        if (!dedupeKey || seenKeys.has(dedupeKey)) {
          continue;
        }

        seenKeys.add(dedupeKey);
        players.push({
          rowNumber,
          lastName: parsed.playerName,
          teamName: parsed.teamAbbrev,
          playerId: null,
          fullName: parsed.playerName,
          normalizedLastName: normalizeLastNameInput(parsed.playerName),
          sourceSectionType: roleGroup.sourceSectionType,
        });
        rowNumber += 1;
      }
    }
  }

  return players;
}

async function resolvePlayersFromRosterParticipants(participants) {
  const players = buildInputPlayersFromRosterParticipants(participants);
  return resolvePlayersFromInputPlayers(players);
}

async function resolvePlayersFromInputPlayers(players) {
  const teamMap = await resolveTeamMap();
  const teamCache = new Map();
  const allTeamAbbrevs = Array.from(new Set([...teamMap.values()].filter(Boolean)));

  const resolvedPlayers = [];
  const unresolvedItems = [];

  for (const player of players) {
    if (!player.playerId && player.lastName && player.teamName) {
      const teamAbbrev = teamMap.get(normalizeText(player.teamName));
      const normalizedLastName = player.normalizedLastName || normalizeLastNameInput(player.lastName);
      const candidatePool = [];

      if (teamAbbrev) {
        if (!teamCache.has(teamAbbrev)) {
          teamCache.set(teamAbbrev, await buildTeamPlayerIndex(teamAbbrev));
        }

        const teamIndex = teamCache.get(teamAbbrev).index;
        const teamCandidates = teamIndex.get(normalizedLastName) ?? [];
        for (const candidate of teamCandidates) {
          candidatePool.push({ player: candidate, teamAbbrev, matchStrategy: "team_exact" });
        }
      }

      if (candidatePool.length === 0) {
        for (const fallbackTeamAbbrev of allTeamAbbrevs) {
          if (fallbackTeamAbbrev === teamAbbrev) {
            continue;
          }

          if (!teamCache.has(fallbackTeamAbbrev)) {
            teamCache.set(fallbackTeamAbbrev, await buildTeamPlayerIndex(fallbackTeamAbbrev));
          }

          const fallbackIndex = teamCache.get(fallbackTeamAbbrev).index;
          const fallbackCandidates = fallbackIndex.get(normalizedLastName) ?? [];

          for (const candidate of fallbackCandidates) {
            candidatePool.push({
              player: candidate,
              teamAbbrev: fallbackTeamAbbrev,
              matchStrategy: "team_fallback",
            });
          }
        }
      }

      if (candidatePool.length === 0) {
        for (const fuzzyTeamAbbrev of allTeamAbbrevs) {
          if (!teamCache.has(fuzzyTeamAbbrev)) {
            teamCache.set(fuzzyTeamAbbrev, await buildTeamPlayerIndex(fuzzyTeamAbbrev));
          }

          const teamPlayers = teamCache.get(fuzzyTeamAbbrev).players;
          for (const candidate of teamPlayers) {
            const candidateLastName = normalizeText(candidate?.lastName?.default ?? "");
            if (!candidateLastName) {
              continue;
            }

            const distance = levenshteinDistance(normalizedLastName, candidateLastName);
            const lengthGap = Math.abs(normalizedLastName.length - candidateLastName.length);
            const samePrefix = normalizedLastName.slice(0, 4) === candidateLastName.slice(0, 4);
            if (distance <= 2 && lengthGap <= 2 && samePrefix) {
              candidatePool.push({
                player: candidate,
                teamAbbrev: fuzzyTeamAbbrev,
                matchStrategy: "team_fuzzy_fallback",
              });
            }
          }
        }
      }

      const bestMatch = selectBestCandidate(candidatePool);
      if (!bestMatch) {
        unresolvedItems.push({
          inputName: player.fullName,
          inputTeam: player.teamName,
          teamAbbrev: teamAbbrev ?? "",
          playerId: null,
          status: teamAbbrev ? "player_not_found" : "team_not_found",
          error: teamAbbrev
            ? `No player with last name '${player.lastName}' found from NHL teams (input team: ${teamAbbrev})`
            : `Could not map team '${player.teamName}' to NHL team and no surname fallback match was found`,
          rowNumber: player.rowNumber,
        });
        continue;
      }

      player.playerId = bestMatch.player.playerId;
      player.matchStrategy = bestMatch.matchStrategy;
      player.inputTeamAbbrev = teamAbbrev ?? "";
      player.matchedTeamAbbrev = bestMatch.teamAbbrev;
      player.matchedCurrentSeasonStats = {
        gamesPlayed: bestMatch.player?.gamesPlayed ?? null,
        goals: bestMatch.player?.goals ?? null,
        assists: bestMatch.player?.assists ?? null,
        points: bestMatch.player?.points ?? null,
      };
    }

    if (!player.playerId) {
      unresolvedItems.push({
        inputName: player.fullName,
        inputTeam: player.teamName,
        playerId: null,
        status: "missing_player_id",
        error: "Roster entry could not be resolved to an NHL player from surname+team",
        rowNumber: player.rowNumber,
      });
      continue;
    }

    resolvedPlayers.push(player);
  }

  return {
    totalRows: players.length,
    resolvedPlayers,
    unresolvedItems,
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }

      results[current] = await worker(items[current], current);
    }
  }

  const workers = [];
  const count = Math.min(Math.max(concurrency, 1), items.length || 1);
  for (let i = 0; i < count; i += 1) {
    workers.push(runner());
  }

  await Promise.all(workers);
  return results;
}

function isAdminProtectedPath(requestPath) {
  const pathValue = String(requestPath ?? "");
  return [
    "/admin.html",
    "/app.js",
    "/team-validator.html",
    "/team-validator.js",
    "/api/team-validator",
    "/api/settings/compare-date",
  ].some((prefix) => pathValue === prefix || pathValue.startsWith(`${prefix}/`));
}

function parseBasicAuthHeader(authorizationHeader) {
  const value = String(authorizationHeader ?? "");
  if (!value.startsWith("Basic ")) {
    return null;
  }

  const encodedPart = value.slice(6).trim();
  if (!encodedPart) {
    return null;
  }

  try {
    const decoded = Buffer.from(encodedPart, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return null;
    }

    return {
      user: decoded.slice(0, separatorIndex),
      pass: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function requireAdminAccess(req, res, next) {
  if (!ADMIN_PROTECTION_ENABLED || !isAdminProtectedPath(req.path)) {
    next();
    return;
  }

  const credentials = parseBasicAuthHeader(req.get("authorization"));
  const authorized = credentials?.user === ADMIN_BASIC_USER && credentials?.pass === ADMIN_BASIC_PASS;

  if (authorized) {
    next();
    return;
  }

  res.set("WWW-Authenticate", 'Basic realm="NHL Admin"');

  if (String(req.path).startsWith("/api/")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.status(401).send("Unauthorized");
}

function hasAdminCredentials(req) {
  if (!ADMIN_PROTECTION_ENABLED) {
    return false;
  }

  const credentials = parseBasicAuthHeader(req.get("authorization"));
  return credentials?.user === ADMIN_BASIC_USER && credentials?.pass === ADMIN_BASIC_PASS;
}

function isTruthyQueryValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y"].includes(normalized);
}

app.use(requireAdminAccess);

app.use(express.static(path.join(rootDir, "public"), { index: false }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(rootDir, "public", "lagen.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/version", (_req, res) => {
  res.json({
    name: "nhl-stats",
    commitSha,
    buildTimestamp,
    appBootedAt,
    railway: {
      projectId: process.env.RAILWAY_PROJECT_ID || "",
      serviceId: process.env.RAILWAY_SERVICE_ID || "",
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID || "",
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || "",
      environmentName: process.env.RAILWAY_ENVIRONMENT || "",
    },
    paths: {
      rootDir,
      storageRoot,
      dataDir,
      volumeMountPath: process.env.RAILWAY_VOLUME_MOUNT_PATH || "",
    },
  });
});

app.get("/api/data-readiness", async (req, res) => {
  try {
    const dateInput = String(req.query.date ?? "").trim();
    const targetDate = dateInput || getHelsinkiTodayDate();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      res.status(400).json({ error: "date must be in format YYYY-MM-DD" });
      return;
    }

    const readiness = await buildDataReadiness(targetDate);
    res.json(readiness);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/cron/daily-refresh", handleDailyAutoRefreshRequest);
app.get("/api/cron/daily-refresh", handleDailyAutoRefreshRequest);

app.get("/api/settings", (_req, res) => {
  const compareDate = getSetting("compareDate", DEFAULT_COMPARE_DATE);
  const competitionType = getActiveCompetitionType();
  const rankingWindow = getRankingWindowForCompetition(competitionType);
  const periodCalendars = buildCompetitionPeriodCalendarsSnapshot();

  res.json({
    compareDate,
    competitionType,
    rankingWindow: {
      rankingFrom: rankingWindow.rankingFrom,
      rankingTo: rankingWindow.rankingTo,
    },
    rankingWindows: buildCompetitionRankingWindowsSnapshot(),
    periodCalendar: periodCalendars[competitionType],
    periodCalendars,
  });
});

app.get("/api/settings/audit", (req, res) => {
  const competitionType = normalizeCompetitionType(req.query.competitionType);
  const limit = Number.parseInt(String(req.query.limit ?? "30"), 10);
  const entries = listSettingsAuditEntries({
    competitionType,
    limit,
  });
  res.json({
    count: entries.length,
    entries,
  });
});

app.post("/api/settings/competition-type", (req, res) => {
  const competitionType = normalizeCompetitionType(req.body?.competitionType);
  if (!competitionType) {
    res.status(400).json({
      error: `competitionType must be one of: ${SUPPORTED_COMPETITION_TYPES.join(", ")}`,
    });
    return;
  }

  const oldCompetitionType = getActiveCompetitionType();
  setActiveCompetitionType(competitionType);
  if (oldCompetitionType !== competitionType) {
    appendSettingsAuditEntry({
      actor: getActorFromRequest(req),
      competitionType,
      settingKey: "competitionType",
      oldValue: oldCompetitionType,
      newValue: competitionType,
      overrideUsed: false,
      reason: "",
    });
  }

  const rankingWindow = getRankingWindowForCompetition(competitionType);
  res.json({
    competitionType,
    rankingWindow: {
      rankingFrom: rankingWindow.rankingFrom,
      rankingTo: rankingWindow.rankingTo,
    },
    periodCalendar: buildCompetitionPeriodCalendarsSnapshot()[competitionType],
  });
});

app.post("/api/settings/ranking-window", (req, res) => {
  const competitionType = normalizeCompetitionType(req.body?.competitionType);
  const rankingFrom = String(req.body?.rankingFrom ?? "").trim();
  const rankingTo = String(req.body?.rankingTo ?? "").trim();
  const overrideRequested = isTruthyQueryValue(req.body?.override);
  const reason = String(req.body?.reason ?? "").trim();

  if (!competitionType) {
    res.status(400).json({
      error: `competitionType must be one of: ${SUPPORTED_COMPETITION_TYPES.join(", ")}`,
    });
    return;
  }

  const editPermission = ensureCompetitionSettingsEditable({ req, competitionType, overrideRequested });
  if (!editPermission.ok) {
    res.status(editPermission.statusCode).json({ error: editPermission.error, setupState: editPermission.setupState });
    return;
  }

  if (!isIsoDate(rankingFrom) || !isIsoDate(rankingTo)) {
    res.status(400).json({ error: "rankingFrom and rankingTo must be in format YYYY-MM-DD" });
    return;
  }

  if (rankingFrom > rankingTo) {
    res.status(400).json({ error: "rankingFrom must be less than or equal to rankingTo" });
    return;
  }

  const oldWindow = getRankingWindowForCompetition(competitionType);
  setRankingWindowForCompetition({ competitionType, rankingFrom, rankingTo });

  if (oldWindow.rankingFrom !== rankingFrom || oldWindow.rankingTo !== rankingTo) {
    appendSettingsAuditEntry({
      actor: getActorFromRequest(req),
      competitionType,
      settingKey: "rankingWindow",
      oldValue: JSON.stringify({ rankingFrom: oldWindow.rankingFrom, rankingTo: oldWindow.rankingTo }),
      newValue: JSON.stringify({ rankingFrom, rankingTo }),
      overrideUsed: overrideRequested,
      reason,
    });
  }

  res.json({
    competitionType,
    rankingFrom,
    rankingTo,
    setupState: getSetupStateForCompetition(competitionType),
  });
});

app.post("/api/settings/period-windows", (req, res) => {
  const competitionType = normalizeCompetitionType(req.body?.competitionType);
  const periodWindowsInput = req.body?.periodWindows;
  const overrideRequested = isTruthyQueryValue(req.body?.override);
  const reason = String(req.body?.reason ?? "").trim();

  if (!competitionType) {
    res.status(400).json({
      error: `competitionType must be one of: ${SUPPORTED_COMPETITION_TYPES.join(", ")}`,
    });
    return;
  }

  const editPermission = ensureCompetitionSettingsEditable({ req, competitionType, overrideRequested });
  if (!editPermission.ok) {
    res.status(editPermission.statusCode).json({ error: editPermission.error, setupState: editPermission.setupState });
    return;
  }

  let normalizedWindows;
  try {
    normalizedWindows = normalizeAndValidatePeriodWindows(periodWindowsInput, competitionType);
  } catch (error) {
    res.status(400).json({ error: String(error?.message ?? "Invalid period windows") });
    return;
  }

  const oldWindows = getPeriodWindowsForCompetition(competitionType);
  setPeriodWindowsForCompetition(competitionType, normalizedWindows);

  appendSettingsAuditEntry({
    actor: getActorFromRequest(req),
    competitionType,
    settingKey: "periodWindows",
    oldValue: JSON.stringify(oldWindows),
    newValue: JSON.stringify(normalizedWindows),
    overrideUsed: overrideRequested,
    reason,
  });

  res.json({
    competitionType,
    periodWindows: normalizedWindows,
    setupState: getSetupStateForCompetition(competitionType),
    lockMetadata: getLockMetadataForCompetition(competitionType),
  });
});

app.post("/api/settings/setup-action", (req, res) => {
  const competitionType = normalizeCompetitionType(req.body?.competitionType);
  const action = String(req.body?.action ?? "").trim().toLowerCase();
  const overrideRequested = isTruthyQueryValue(req.body?.override);
  const reason = String(req.body?.reason ?? "").trim();

  if (!competitionType) {
    res.status(400).json({
      error: `competitionType must be one of: ${SUPPORTED_COMPETITION_TYPES.join(", ")}`,
    });
    return;
  }

  if (action !== "initialize" && action !== "lock") {
    res.status(400).json({ error: "action must be 'initialize' or 'lock'" });
    return;
  }

  const editPermission = ensureCompetitionSettingsEditable({ req, competitionType, overrideRequested });
  if (!editPermission.ok) {
    res.status(editPermission.statusCode).json({ error: editPermission.error, setupState: editPermission.setupState });
    return;
  }

  const currentSetupState = getSetupStateForCompetition(competitionType);
  const currentWindows = getPeriodWindowsForCompetition(competitionType);

  try {
    normalizeAndValidatePeriodWindows(currentWindows, competitionType);
  } catch {
    res.status(400).json({ error: "Valid period windows are required before setup actions" });
    return;
  }

  if (action === "initialize") {
    if (currentSetupState === "draft") {
      setSetupStateForCompetition(competitionType, "initialized");
      appendSettingsAuditEntry({
        actor: getActorFromRequest(req),
        competitionType,
        settingKey: "setupState",
        oldValue: currentSetupState,
        newValue: "initialized",
        overrideUsed: overrideRequested,
        reason,
      });
    }

    res.json({
      competitionType,
      setupState: getSetupStateForCompetition(competitionType),
      periodWindows: getPeriodWindowsForCompetition(competitionType),
      lockMetadata: getLockMetadataForCompetition(competitionType),
    });
    return;
  }

  if (currentSetupState !== "initialized" && !overrideRequested) {
    res.status(409).json({ error: "Competition must be initialized before locking", setupState: currentSetupState });
    return;
  }

  const previousState = currentSetupState;
  setSetupStateForCompetition(competitionType, "locked");
  const actor = getActorFromRequest(req);
  const lockMetadata = {
    lockedAt: new Date().toISOString(),
    lockedBy: actor,
  };
  setLockMetadataForCompetition(competitionType, lockMetadata);

  appendSettingsAuditEntry({
    actor,
    competitionType,
    settingKey: "setupState",
    oldValue: previousState,
    newValue: "locked",
    overrideUsed: overrideRequested,
    reason,
  });

  appendSettingsAuditEntry({
    actor,
    competitionType,
    settingKey: "periodWindowsLock",
    oldValue: "",
    newValue: JSON.stringify(lockMetadata),
    overrideUsed: overrideRequested,
    reason,
  });

  res.json({
    competitionType,
    setupState: "locked",
    periodWindows: getPeriodWindowsForCompetition(competitionType),
    lockMetadata,
  });
});

app.get("/api/nyheter/snapshots", (req, res) => {
  try {
    const fileName = String(req.query.file ?? "").trim();
    const seasonId = String(req.query.seasonId ?? "").trim();
    const compareDate = String(req.query.compareDate ?? "").trim();
    const limit = Number.parseInt(String(req.query.limit ?? "14"), 10);
    const snapshots = listNyheterSnapshots({ fileName, seasonId, compareDate, limit });

    res.json({
      count: snapshots.length,
      snapshots,
    });
  } catch (error) {
    res.status(500).json({ error: String(error?.message ?? "unknown error") });
  }
});

async function handleNyheterCollectRequest(req, res) {
  if (!hasNyheterCollectorAccess(req)) {
    res.status(401).json({ error: "Unauthorized nyheter collector access" });
    return;
  }

  try {
    const fileName = String(req.query.file ?? req.body?.file ?? "").trim();
    const seasonId = String(req.query.seasonId ?? req.body?.seasonId ?? AUTO_REFRESH_SEASON_ID).trim();
    const compareDate = String(
      req.query.compareDate ?? req.body?.compareDate ?? getSetting("compareDate", DEFAULT_COMPARE_DATE)
    ).trim();
    const snapshotDate = String(req.query.snapshotDate ?? req.body?.snapshotDate ?? getHelsinkiTodayDate()).trim();
    const forceRefresh = isTruthyQueryValue(req.query.forceRefresh ?? req.body?.forceRefresh ?? "");
    const allowOverwrite = isTruthyQueryValue(req.query.allowOverwrite ?? req.body?.allowOverwrite ?? "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      res.status(400).json({ error: "snapshotDate must be in format YYYY-MM-DD" });
      return;
    }

    if (!/^\d{8}$/.test(seasonId)) {
      res.status(400).json({ error: "seasonId must be an 8-digit string, e.g. 20252026" });
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(compareDate)) {
      res.status(400).json({ error: "compareDate must be in format YYYY-MM-DD" });
      return;
    }

    const result = await collectNyheterSnapshot({
      fileName,
      seasonId,
      compareDate,
      snapshotDate,
      forceRefresh,
      allowOverwrite,
    });

    res.json({ ok: true, result });
  } catch (error) {
    if (error instanceof NyheterSnapshotConflictError) {
      res.status(409).json({ ok: false, error: error.message, code: "snapshot_exists" });
      return;
    }

    res.status(500).json({ ok: false, error: String(error?.message ?? "unknown error") });
  }
}

app.post("/api/nyheter/collect", handleNyheterCollectRequest);
app.get("/api/nyheter/collect", handleNyheterCollectRequest);

app.post("/api/team-validator", teamValidatorRateLimiter, async (req, res) => {
  if (!hasTeamValidatorAccess(req)) {
    res.status(401).json({ error: "Unauthorized team-validator access" });
    return;
  }

  try {
    const participantName = String(req.body?.participantName ?? "").trim();
    const rosterText = String(req.body?.rosterText ?? "").trim();
    const seasonId = String(req.body?.seasonId ?? SC_VALIDATOR_SEASON_ID).trim();
    const competitionType = normalizeCompetitionType(req.body?.competitionType ?? getActiveCompetitionType());
    if (!competitionType) {
      res.status(400).json({
        ok: false,
        error: `competitionType must be one of: ${SUPPORTED_COMPETITION_TYPES.join(", ")}`,
      });
      return;
    }
    const rankingWindow = getRankingWindowForCompetition(competitionType);
    const rankingFrom = String(req.body?.rankingFrom ?? rankingWindow.rankingFrom).trim();
    const rankingTo = String(req.body?.rankingTo ?? rankingWindow.rankingTo).trim();
    
    // Check if previousRosterFile was explicitly provided (not undefined)
    const previousRosterFileProvided = req.body?.previousRosterFile !== undefined;
    const previousRosterFile = String(req.body?.previousRosterFile ?? "").trim();

    if (!participantName) {
      res.status(400).json({ ok: false, error: "participantName is required" });
      return;
    }

    if (!rosterText) {
      res.status(400).json({ ok: false, error: "rosterText is required" });
      return;
    }

    if (!/^\d{8}$/.test(seasonId)) {
      res.status(400).json({ ok: false, error: "seasonId must be an 8-digit string, e.g. 20252026" });
      return;
    }

    if (!isIsoDate(rankingFrom) || !isIsoDate(rankingTo)) {
      res.status(400).json({ ok: false, error: "rankingFrom and rankingTo must be in format YYYY-MM-DD" });
      return;
    }

    if (rankingFrom > rankingTo) {
      res.status(400).json({ ok: false, error: "rankingFrom must be less than or equal to rankingTo" });
      return;
    }

    // Load previous roster data if provided
    let previousRosterData = null;
    if (previousRosterFileProvided && previousRosterFile === "period1-rosters.json") {
      const loaded = await loadScRosters();
      if (loaded?.participants) {
        previousRosterData = loaded.participants;
      }
    }

    const result = await validateTeam({
      participantName,
      rosterText,
      seasonId,
      rankingFrom,
      rankingTo,
      competitionType,
      previousRosterData,
      previousRosterFile: previousRosterFileProvided ? previousRosterFile : undefined,
    });

    // If validation passes, save to the SC roster file.
    let savedToScRosters = false;
    if (result?.status === "PASS") {
      const parsed = parseScRosterText(rosterText);
      if (Array.isArray(parsed?.players)) {
        savedToScRosters = await saveScRoster(participantName, parsed.players);
      }
    }

    res.json({
      ok: true,
      result: {
        ...result,
        savedToScRosters,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error?.message ?? "unknown error") });
  }
});

app.post("/api/settings/compare-date", (req, res) => {
  const compareDate = String(req.body?.compareDate ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(compareDate)) {
    res.status(400).json({ error: "compareDate must be in format YYYY-MM-DD" });
    return;
  }

  setSetting("compareDate", compareDate);
  res.json({ compareDate });
});

app.get("/api/players-stats-compare", playersCompareRateLimiter, async (req, res) => {
  try {
    const compareDateInput = String(req.query.compareDate ?? "").trim();
    const compareDate = compareDateInput || getSetting("compareDate", DEFAULT_COMPARE_DATE);
    const forceRefreshRaw = String(req.query.forceRefresh ?? "").trim().toLowerCase();
    const forceRefresh = ["1", "true", "yes", "y"].includes(forceRefreshRaw);
    const seasonId = String(req.query.seasonId ?? "20252026");
    const fileName = String(req.query.file ?? "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(compareDate)) {
      res.status(400).json({ error: "compareDate must be in format YYYY-MM-DD" });
      return;
    }

    if (!/^\d{8}$/.test(seasonId)) {
      res.status(400).json({ error: "seasonId must be an 8-digit string, e.g. 20252026" });
      return;
    }

    const rosterSourceDate = getSetting("compareDate", DEFAULT_COMPARE_DATE);
    const rosterSource = await resolveActiveRosterSource(rosterSourceDate);
    const dataWindowKey = getHelsinkiDateWindowKey();
    const cacheKey = [RESPONSE_CACHE_VERSION, seasonId, rosterSource.sourceKey, compareDate, dataWindowKey].join("|");
    const cachedResponse = forceRefresh ? null : getCachedCompareResponse(cacheKey);
    if (cachedResponse) {
      res.json({
        ...cachedResponse,
        cache: {
          ...(cachedResponse.cache ?? {}),
          hit: true,
          window: dataWindowKey,
          timezone: "Europe/Helsinki",
          refreshHourLocal: 10,
        },
      });
      return;
    }

    const { totalRows, resolvedPlayers, unresolvedItems } = await resolvePlayersFromRosterParticipants(rosterSource.participants);

    const compareCompetitionType = getActiveCompetitionType();
    const compareGameTypeId = getGameTypeId(compareCompetitionType);

    const resolvedItems = await runWithConcurrency(resolvedPlayers, PLAYER_FETCH_CONCURRENCY, async (player) => {
      try {
        let landing;
        let gameLogPayload;

        if (useMcpBridge) {
          landing = await fetchJson(`/player/${player.playerId}/landing`);
          gameLogPayload = await fetchJson(`/player/${player.playerId}/game-log/${seasonId}/${compareGameTypeId}`);
        } else {
          [landing, gameLogPayload] = await Promise.all([
            fetchJson(`/player/${player.playerId}/landing`),
            fetchJson(`/player/${player.playerId}/game-log/${seasonId}/${compareGameTypeId}`),
          ]);
        }

        const stats = extractSeasonStats(landing, seasonId, compareGameTypeId);
        const gameLog = Array.isArray(gameLogPayload?.gameLog) ? gameLogPayload.gameLog : [];
        const gamesUntilDate = gameLog.filter((game) => String(game.gameDate) <= compareDate);
        const isGoalie =
          String(landing?.position ?? "").toUpperCase() === "G" || player.sourceSectionType === "goalies";
        const comparePoints = isGoalie
          ? sumGoalieFantasyPoints(gamesUntilDate)
          : gamesUntilDate.reduce((sum, game) => sum + Number(game?.points ?? 0), 0);
        const matchedStats = player.matchedCurrentSeasonStats ?? null;
        const todayGamesPlayed = Number.isFinite(Number(matchedStats?.gamesPlayed))
          ? Number(matchedStats.gamesPlayed)
          : (stats?.gamesPlayed ?? null);
        const goalieGoals = gameLog.reduce((sum, game) => sum + Number(game?.goals ?? 0), 0);
        const goalieAssists = gameLog.reduce((sum, game) => sum + Number(game?.assists ?? 0), 0);
        const skaterPointsFromLog = gameLog.reduce((sum, game) => sum + Number(game?.points ?? 0), 0);
        const todayGoals = isGoalie
          ? goalieGoals
          : Number.isFinite(Number(matchedStats?.goals))
            ? Number(matchedStats.goals)
            : (stats?.goals ?? null);
        const todayAssists = isGoalie
          ? goalieAssists
          : Number.isFinite(Number(matchedStats?.assists))
            ? Number(matchedStats.assists)
            : (stats?.assists ?? null);
        const todayPoints = isGoalie
          ? sumGoalieFantasyPoints(gameLog)
          : skaterPointsFromLog;

        return {
          inputName: player.fullName,
          inputTeam: player.teamName,
          rowNumber: player.rowNumber,
          isGoalie,
          playerId: landing.playerId,
          fullName: `${landing.firstName?.default ?? ""} ${landing.lastName?.default ?? ""}`.trim(),
          lastName: String(landing.lastName?.default ?? "").trim(),
          teamAbbrev: landing.currentTeamAbbrev ?? player.matchedTeamAbbrev ?? player.inputTeamAbbrev ?? "",
          isActive: Boolean(landing.isActive),
          seasonId,
          compareDate,
          gamesPlayed: todayGamesPlayed,
          goals: todayGoals,
          assists: todayAssists,
          points: todayPoints,
          todayPoints,
          comparePoints,
          deltaPoints:
            Number.isFinite(todayPoints) && Number.isFinite(comparePoints) ? todayPoints - comparePoints : null,
          matchStrategy: player.matchStrategy ?? (player.playerId ? "id_direct" : "unknown"),
          matchedTeamAbbrev: player.matchedTeamAbbrev ?? "",
          status: stats ? "ok" : "season_not_found",
          error: stats ? "" : `No NHL regular season stats found for season ${seasonId}`,
        };
      } catch (error) {
        return {
          inputName: player.fullName,
          inputTeam: player.teamName,
          playerId: player.playerId,
          status: "fetch_error",
          error: error.message,
          rowNumber: player.rowNumber,
        };
      }
    });

    const responsePayload = {
      file: fileName || rosterSource.sourceLabel,
      seasonId,
      compareDate,
      totalRows,
      items: [...unresolvedItems, ...resolvedItems],
      rosterSource: rosterSource.rosterSource,
      cache: {
        hit: false,
        window: dataWindowKey,
        timezone: "Europe/Helsinki",
        refreshHourLocal: 10,
        fetchedAt: new Date().toISOString(),
      },
    };

    setCachedCompareResponse(cacheKey, responsePayload);
    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/tipsen-summary", async (req, res) => {
  try {
    const compareDateInput = String(req.query.compareDate ?? "").trim();
    const compareDate = compareDateInput || getSetting("compareDate", DEFAULT_COMPARE_DATE);
    const forceRefreshRaw = String(req.query.forceRefresh ?? "").trim().toLowerCase();
    const forceRefresh = ["1", "true", "yes", "y"].includes(forceRefreshRaw);
    const seasonId = String(req.query.seasonId ?? "20252026");
    const fileName = String(req.query.file ?? "").trim();
    const includeCacheDebug = hasAdminCredentials(req) && isTruthyQueryValue(req.query.debugCache);

    if (!/^[\d]{4}-[\d]{2}-[\d]{2}$/.test(compareDate)) {
      res.status(400).json({ error: "compareDate must be in format YYYY-MM-DD" });
      return;
    }

    if (!/^\d{8}$/.test(seasonId)) {
      res.status(400).json({ error: "seasonId must be an 8-digit string, e.g. 20252026" });
      return;
    }
    const payload = await getTipsenSummaryPayload({
      fileName,
      seasonId,
      compareDate,
      forceRefresh,
      includeCacheDebug,
    });
    res.json(payload);
  } catch (error) {
    if (error instanceof EndpointProxyError) {
      res.status(error.statusCode).json(error.payload);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

function assertStartupSecurityConfig() {
  const hasAdminUser = ADMIN_BASIC_USER.length > 0;
  const hasAdminPass = ADMIN_BASIC_PASS.length > 0;

  if (hasAdminUser !== hasAdminPass) {
    throw new Error(
      "Invalid admin auth configuration: both ADMIN_BASIC_USER and ADMIN_BASIC_PASS must be set together or both left empty"
    );
  }
}

function assertStartupEnvVarValidation() {
  const numericChecks = [
    { name: "PORT", value: PORT, min: 1, max: 65535 },
    { name: "MCP_TOOL_TIMEOUT_MS", value: MCP_TOOL_TIMEOUT_MS, min: 1 },
    { name: "PLAYER_FETCH_CONCURRENCY", value: PLAYER_FETCH_CONCURRENCY, min: 1 },
    { name: "MCP_MIN_CALL_INTERVAL_MS", value: MCP_MIN_CALL_INTERVAL_MS, min: 0 },
    { name: "AUTO_REFRESH_MIN_HOUR_FI", value: AUTO_REFRESH_MIN_HOUR_FI, min: 0, max: 23 },
    { name: "AUTO_REFRESH_CHECK_INTERVAL_MS", value: AUTO_REFRESH_CHECK_INTERVAL_MS, min: 1 },
    { name: "STARTUP_CACHE_WARMUP_DELAY_MS", value: STARTUP_CACHE_WARMUP_DELAY_MS, min: 0 },
    { name: "PLAYERS_COMPARE_RATE_LIMIT_WINDOW_MS", value: PLAYERS_COMPARE_RATE_LIMIT_WINDOW_MS, min: 1 },
    { name: "PLAYERS_COMPARE_RATE_LIMIT_MAX", value: PLAYERS_COMPARE_RATE_LIMIT_MAX, min: 1 },
    { name: "TEAM_VALIDATOR_RATE_LIMIT_WINDOW_MS", value: TEAM_VALIDATOR_RATE_LIMIT_WINDOW_MS, min: 1 },
    { name: "TEAM_VALIDATOR_RATE_LIMIT_MAX", value: TEAM_VALIDATOR_RATE_LIMIT_MAX, min: 1 },
  ];

  for (const check of numericChecks) {
    if (Number.isNaN(check.value)) {
      throw new Error(`Invalid config: ${check.name} must be a valid number, got ${process.env[check.name] || check.value}`);
    }
    if (check.min !== undefined && check.value < check.min) {
      throw new Error(`Invalid config: ${check.name} must be >= ${check.min}, got ${check.value}`);
    }
    if (check.max !== undefined && check.value > check.max) {
      throw new Error(`Invalid config: ${check.name} must be <= ${check.max}, got ${check.value}`);
    }
  }
}

assertStartupSecurityConfig();
assertStartupEnvVarValidation();

app.listen(PORT, async () => {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    // Verify dataDir is writable by attempting a test write
    const testFile = path.join(dataDir, `.startup-writeability-check-${Date.now()}`);
    try {
      await fs.writeFile(testFile, "");
      await fs.unlink(testFile);
    } catch (error) {
      throw new Error(`Data directory not writable at ${dataDir}: ${error.message}`);
    }
  } catch (error) {
    console.error(`[startup] Failed to verify data directory: ${error.message}`);
    process.exit(1);
  }

  if (useMcpBridge) {
    try {
      await getMcpClient();
    } catch (error) {
      console.error(`[startup-mcp] Failed to initialize MCP client: ${error.message}`);
      console.error("[startup-mcp] App will continue but MCP-dependent features will fail at runtime.");
    }
  }
  console.log(`Web UI running at http://localhost:${PORT}`);
  console.log(`Storage root: ${storageRoot}`);
  console.log(`Settings DB: ${settingsDbPath}`);
  console.log(`Response cache version: ${RESPONSE_CACHE_VERSION}`);
  console.log(`Players compare concurrency: ${PLAYER_FETCH_CONCURRENCY}`);
  console.log(`MCP min call interval: ${MCP_MIN_CALL_INTERVAL_MS}ms`);
  console.log(
    useMcpBridge ? "NHL data source: MCP server tools (stdio)" : `NHL data source: direct API (${NHL_API_BASE})`
  );
  console.log(`Admin protection: ${ADMIN_PROTECTION_ENABLED ? "enabled" : "disabled"}`);
  console.log(
    `Team-validator access: ${
      ADMIN_PROTECTION_ENABLED || CRON_JOB_TOKEN
        ? "requires admin basic auth or x-cron-token"
        : "locked (configure admin auth or CRON_JOB_TOKEN)"
    }`
  );
  console.log(
    `Rate limits: /api/players-stats-compare=${PLAYERS_COMPARE_RATE_LIMIT_MAX}/${PLAYERS_COMPARE_RATE_LIMIT_WINDOW_MS}ms, /api/team-validator=${TEAM_VALIDATOR_RATE_LIMIT_MAX}/${TEAM_VALIDATOR_RATE_LIMIT_WINDOW_MS}ms`
  );
  console.log(`Auto refresh scheduler: ${AUTO_REFRESH_SCHEDULER_ENABLED ? "enabled" : "disabled"}`);
  console.log(`Startup cache warmup: ${STARTUP_CACHE_WARMUP_ENABLED ? "enabled" : "disabled"}`);
  if (STARTUP_CACHE_WARMUP_ENABLED) {
    console.log(`Startup cache warmup delay: ${Math.max(0, STARTUP_CACHE_WARMUP_DELAY_MS)}ms`);
    setTimeout(async () => {
      try {
        if (useMcpBridge) {
          await ensureMcpClientReady();
        }
        await warmTipsenCacheOnStartup();
      } catch (error) {
        console.error(`[cache-warmup] startup warmup failed: ${error.message}`);
      }
    }, Math.max(0, STARTUP_CACHE_WARMUP_DELAY_MS));
  }
  if (AUTO_REFRESH_SCHEDULER_ENABLED) {
    console.log(`Auto refresh schedule: check every ${AUTO_REFRESH_CHECK_INTERVAL_MS}ms, min hour FI ${AUTO_REFRESH_MIN_HOUR_FI}`);
    setTimeout(() => {
      tryAutoRefreshFromScheduler().catch((error) => {
        console.error(`[auto-refresh] initial check failed: ${error.message}`);
      });
    }, 5000);

    setInterval(() => {
      tryAutoRefreshFromScheduler().catch((error) => {
        console.error(`[auto-refresh] scheduled check failed: ${error.message}`);
      });
    }, Math.max(60000, AUTO_REFRESH_CHECK_INTERVAL_MS));
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    try {
      if (mcpClientPromise) {
        const client = await mcpClientPromise;
        await client.close();
      }
    } catch {
    }
    try {
      settingsDb.close();
    } catch {
    }
    process.exit(0);
  });
}
