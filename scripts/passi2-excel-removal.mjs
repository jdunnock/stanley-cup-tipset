// Passi 2: Remove all Excel (xlsx/multer) code from web-server.js
import { readFileSync, writeFileSync } from 'node:fs';

const filePath = 'src/web-server.js';
let src = readFileSync(filePath, 'utf8');

// ---- 1. Remove XLSX and multer imports ----
src = src.replace("import XLSX from \"xlsx\";\nimport multer from \"multer\";\n", "");

// ---- 2. Remove Excel-specific constants ----
src = src.replace("const DEFAULT_EXCEL_FILE = \"NHL tipset 2026 jan-apr period1.xlsx\";\n", "");
src = src.replace("const DEFAULT_SHEET_NAME = \"Spelarna\";\n", "");
src = src.replace("const TIPSEN_SHEET_NAME = \"Tipsen\";\n", "");
src = src.replace("const PERIOD3_VALIDATOR_DEFAULT_FILE = \"NHL tipset 2026 jan-apr period2.xlsx\";\n", "");

// ---- 3. Remove multer upload variable ----
src = src.replace(
  "const upload = multer({\n  storage: multer.memoryStorage(),\n  limits: {\n    fileSize: 10 * 1024 * 1024,\n  },\n});\n\n",
  ""
);

// ---- 4. Remove fileName from validateTeam signature ----
src = src.replace(
  "async function validateTeam({\n  participantName,\n  rosterText,\n  fileName,\n  seasonId,",
  "async function validateTeam({\n  participantName,\n  rosterText,\n  seasonId,"
);

// ---- 5. Fix buildPeriod2OwnershipIndex caller ----
src = src.replace(
  "  } else {\n    // No previousRosterFile parameter provided - this is Period 2->3 transition\n    // Build ownership index from Period 2 Excel data\n    ownership = await buildPeriod2OwnershipIndex(fileName);\n  }",
  "  } else {\n    // Period 2 Excel removed — no ownership check\n    ownership = null;\n  }"
);

// ---- 6. Remove buildPeriod2OwnershipIndex function ----
// Find the function and remove it
const bpoi_start = "async function buildPeriod2OwnershipIndex(fileName) {";
const bpoi_end = "\nfunction buildOwnershipIndexFromRosters(participants) {";
const bpoi_startIdx = src.indexOf(bpoi_start);
const bpoi_endIdx = src.indexOf(bpoi_end);
if (bpoi_startIdx === -1 || bpoi_endIdx === -1) {
  console.error("FAIL: buildPeriod2OwnershipIndex markers not found");
  process.exit(1);
}
src = src.slice(0, bpoi_startIdx) + src.slice(bpoi_endIdx + 1); // +1 removes the leading \n

// ---- 7. Fix collectNyheterSnapshot - remove listExcelFiles call ----
src = src.replace(
  "} = {}) {\n  const files = await listExcelFiles();\n  if (await isNyheterSnapshotCollectionPaused(files)) {",
  "} = {}) {\n  if (await isNyheterSnapshotCollectionPaused()) {"
);

// ---- 8. Fix runDailyAutoRefresh - remove files dependency ----
// Replace: const files = await listExcelFiles();...hasPeriod3RosterSource(files)
src = src.replace(
  "    const files = await listExcelFiles();\n\n    if (targetDate >= PERIOD3_REQUIRED_TARGET_DATE && !(await hasPeriod3RosterSource(files))) {",
  "    if (targetDate >= PERIOD3_REQUIRED_TARGET_DATE && !(await hasPeriod3RosterSource())) {"
);

// Remove: if (!files.length) guard
src = src.replace(
  "\n    if (!files.length) {\n      return {\n        ok: true,\n        executed: false,\n        reason: \"no_excel_files\",\n        trigger,\n        date: targetDate,\n      };\n    }\n",
  "\n"
);

// Replace runWithConcurrency(files...) with single call
src = src.replace(
  "    const refreshResults = await runWithConcurrency(files, 2, async (fileName) => {\n      try {\n        return await forceRefreshTipsenForFile({ fileName, seasonId, compareDate });\n      } catch (error) {\n        return {\n          file: fileName,\n          status: \"error\",\n          error: String(error?.message ?? \"unknown error\"),\n        };\n      }\n    });\n\n    const failed = refreshResults.filter((item) => item.status !== \"ok\");\n    if (failed.length > 0) {\n      return {\n        ok: false,\n        executed: false,\n        reason: \"refresh_failed\",\n        trigger,\n        date: targetDate,\n        results: refreshResults,\n      };\n    }",
  "    let refreshResult;\n    try {\n      refreshResult = await forceRefreshTipsenForFile({ fileName: \"\", seasonId, compareDate });\n    } catch (error) {\n      refreshResult = {\n        file: \"\",\n        status: \"error\",\n        error: String(error?.message ?? \"unknown error\"),\n      };\n    }\n\n    if (refreshResult.status !== \"ok\") {\n      return {\n        ok: false,\n        executed: false,\n        reason: \"refresh_failed\",\n        trigger,\n        date: targetDate,\n        results: [refreshResult],\n      };\n    }"
);

// Fix isNyheterSnapshotCollectionPaused(files) and files.length in first return
src = src.replace(
  "    if (await isNyheterSnapshotCollectionPaused(files)) {\n      setSetting(\"autoRefreshLastSuccessDate\", targetDate);\n      setSetting(\"autoRefreshLastRunAt\", completedAt);\n\n      return {\n        ok: true,\n        executed: true,\n        reason: \"done\",\n        trigger,\n        date: targetDate,\n        compareDate,\n        seasonId,\n        files: files.length,\n        completedAt,\n        results: refreshResults,\n        snapshots: [],\n        snapshotErrors: [],\n        snapshotsPaused: true,\n        snapshotsPauseReason: \"period3_rosters_missing\",\n        snapshotRequiredFromDate: PERIOD3_REQUIRED_TARGET_DATE,\n      };\n    }",
  "    if (await isNyheterSnapshotCollectionPaused()) {\n      setSetting(\"autoRefreshLastSuccessDate\", targetDate);\n      setSetting(\"autoRefreshLastRunAt\", completedAt);\n\n      return {\n        ok: true,\n        executed: true,\n        reason: \"done\",\n        trigger,\n        date: targetDate,\n        compareDate,\n        seasonId,\n        completedAt,\n        results: [refreshResult],\n        snapshots: [],\n        snapshotErrors: [],\n        snapshotsPaused: true,\n        snapshotsPauseReason: \"period3_rosters_missing\",\n        snapshotRequiredFromDate: PERIOD3_REQUIRED_TARGET_DATE,\n      };\n    }"
);

// Replace for loop over files with single collectNyheterSnapshot call
src = src.replace(
  "    for (const fileName of files) {\n      try {\n        const snapshotResult = await collectNyheterSnapshot({\n          fileName,\n          seasonId: String(seasonId),\n          compareDate: String(compareDate),\n          snapshotDate: targetDate,\n          forceRefresh: false,\n        });\n        snapshotResults.push(snapshotResult);\n      } catch (error) {\n        snapshotErrors.push({\n          file: fileName,\n          error: String(error?.message ?? \"unknown error\"),\n        });\n      }\n    }",
  "    try {\n      const snapshotResult = await collectNyheterSnapshot({\n        fileName: \"\",\n        seasonId: String(seasonId),\n        compareDate: String(compareDate),\n        snapshotDate: targetDate,\n        forceRefresh: false,\n      });\n      snapshotResults.push(snapshotResult);\n    } catch (error) {\n      snapshotErrors.push({\n        file: \"\",\n        error: String(error?.message ?? \"unknown error\"),\n      });\n    }"
);

// Fix final return - remove files.length and refreshResults
src = src.replace(
  "      compareDate,\n      seasonId,\n      files: files.length,\n      completedAt,\n      results: refreshResults,\n      snapshots: snapshotResults,\n      snapshotErrors,",
  "      compareDate,\n      seasonId,\n      completedAt,\n      results: [refreshResult],\n      snapshots: snapshotResults,\n      snapshotErrors,"
);

// ---- 9. Rewrite warmTipsenCacheOnStartup ----
const warmStart = "async function warmTipsenCacheOnStartup() {";
const warmEnd = "\nfunction getCronTokenFromRequest(req) {";
const warmStartIdx = src.indexOf(warmStart);
const warmEndIdx = src.indexOf(warmEnd);
if (warmStartIdx === -1 || warmEndIdx === -1) {
  console.error("FAIL: warmTipsenCacheOnStartup markers not found");
  process.exit(1);
}
const newWarm = `async function warmTipsenCacheOnStartup() {
  if (!STARTUP_CACHE_WARMUP_ENABLED) {
    console.log("[cache-warmup] startup warmup disabled");
    return;
  }

  const compareDate = getSetting("compareDate", DEFAULT_COMPARE_DATE);
  let rosterSource;
  try {
    rosterSource = await resolveActiveTemporaryRosterSource(getHelsinkiTodayDate());
  } catch {
    console.log("[cache-warmup] skipped: no active roster source available");
    return;
  }

  console.log(
    \`[cache-warmup] started — rosterSource=\${rosterSource.sourceKey}, seasonId=\${AUTO_REFRESH_SEASON_ID}, compareDate=\${compareDate}\`
  );

  const startedAt = Date.now();
  try {
    await forceRefreshTipsenForFile({
      fileName: "",
      seasonId: AUTO_REFRESH_SEASON_ID,
      compareDate,
    });
    const durationMs = Date.now() - startedAt;
    console.log(\`[cache-warmup] completed (\${durationMs}ms)\`);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.warn(\`[cache-warmup] failed (\${durationMs}ms): \${String(error?.message ?? "unknown error")}\`);
  }
}
`;
src = src.slice(0, warmStartIdx) + newWarm + src.slice(warmEndIdx + 1);

// ---- 10. Remove getSectionColumns, parseSpelarnaReferenceRows, isLikelyPlayerRow ----
const secColStart = "\nfunction getSectionColumns(headerRow) {";
const pickFieldStart = "\nfunction pickField(row, keys) {";
const secColIdx = src.indexOf(secColStart);
const pickFieldIdx = src.indexOf(pickFieldStart);
if (secColIdx === -1 || pickFieldIdx === -1) {
  console.error("FAIL: getSectionColumns or pickField markers not found");
  process.exit(1);
}
src = src.slice(0, secColIdx) + src.slice(pickFieldIdx);

// ---- 11. Remove listExcelFiles, hasPeriod3Excel, toSafeDataPath, resolveExistingExcelPath, parseExcelPlayers ----
//     Replace with simplified hasPeriod3RosterSource and isNyheterSnapshotCollectionPaused
const listExcelStart = "\nasync function listExcelFiles() {";
const resolveTeamStart = "\nasync function resolveTeamMap() {";
const listExcelIdx = src.indexOf(listExcelStart);
const resolveTeamIdx = src.indexOf(resolveTeamStart);
if (listExcelIdx === -1 || resolveTeamIdx === -1) {
  console.error(`FAIL: listExcelFiles=${listExcelIdx} resolveTeamMap=${resolveTeamIdx}`);
  process.exit(1);
}
const newHelpers = `
async function hasPeriod3RosterSource() {
  return hasTemporaryPeriod3Rosters();
}

async function isNyheterSnapshotCollectionPaused() {
  return !(await hasPeriod3RosterSource());
}

`;
src = src.slice(0, listExcelIdx) + newHelpers + src.slice(resolveTeamIdx + 1);

// ---- 12. Remove resolvePlayersForFile function ----
src = src.replace(
  "async function resolvePlayersForFile(fileName) {\n  const filePath = await resolveExistingExcelPath(fileName);\n  const players = parseExcelPlayers(filePath);\n  return resolvePlayersFromInputPlayers(players);\n}\n\n",
  ""
);

// ---- 13. Remove /api/excel-files endpoint ----
// ---- Also clean isAdminProtectedPath: remove retired route entries ----
src = src.replace(
  '    "/api/upload-excel",\n    "/api/settings/compare-date",\n    "/api/spelarna-reconciliation",',
  '    "/api/settings/compare-date",'
);

// ---- Also fix handleNyheterCollectRequest: remove DEFAULT_EXCEL_FILE ----
src = src.replace(
  '    const fileName = String(req.query.file ?? req.body?.file ?? DEFAULT_EXCEL_FILE).trim();',
  '    const fileName = String(req.query.file ?? req.body?.file ?? "").trim();'
);

// ---- 13. Remove /api/excel-files endpoint ----
src = src.replace(
  "app.get(\"/api/excel-files\", async (_req, res) => {\n  try {\n    const files = await listExcelFiles();\n    res.json({ files });\n  } catch (error) {\n    res.status(500).json({ error: error.message });\n  }\n});\n\n",
  ""
);

// ---- 14. Remove /api/upload-excel endpoint ----
const uploadStart = "\napp.post(\"/api/upload-excel\",";
const playersCompareStart = "\napp.get(\"/api/players-stats-compare\",";
const uploadIdx = src.indexOf(uploadStart);
const playersCompareIdx = src.indexOf(playersCompareStart);
if (uploadIdx === -1 || playersCompareIdx === -1) {
  console.error(`FAIL: upload-excel=${uploadIdx} players-stats-compare=${playersCompareIdx}`);
  process.exit(1);
}
src = src.slice(0, uploadIdx) + src.slice(playersCompareIdx);

// ---- 15. Remove fileName from team-validator endpoint ----
src = src.replace(
  "    const fileName = String(req.body?.file ?? PERIOD3_VALIDATOR_DEFAULT_FILE).trim();\n    const seasonId = String(req.body?.seasonId ?? PERIOD3_VALIDATOR_SEASON_ID).trim();",
  "    const seasonId = String(req.body?.seasonId ?? PERIOD3_VALIDATOR_SEASON_ID).trim();"
);
src = src.replace(
  "      participantName,\n      rosterText,\n      fileName,\n      seasonId,",
  "      participantName,\n      rosterText,\n      seasonId,"
);

// ---- 16. Remove /api/spelarna-reconciliation endpoint ----
const spelStart = "\napp.get(\"/api/spelarna-reconciliation\",";
const appListenStart = "\napp.listen(PORT,";
const spelIdx = src.indexOf(spelStart);
const appListenIdx = src.indexOf(appListenStart);
if (spelIdx === -1 || appListenIdx === -1) {
  console.error(`FAIL: spelarna-reconciliation=${spelIdx} app.listen=${appListenIdx}`);
  process.exit(1);
}
src = src.slice(0, spelIdx) + src.slice(appListenIdx);

// ---- 17. Remove "Excel source folders" startup log ----
src = src.replace(
  "  console.log(`Excel source folders: ${rootDir} and ${dataDir}`);\n",
  ""
);

// ---- Validate result ----
const checks = [
  ['import XLSX', false],
  ['import multer', false],
  ['const DEFAULT_EXCEL_FILE', false],
  ['DEFAULT_SHEET_NAME', false],
  ['TIPSEN_SHEET_NAME', false],
  ['PERIOD3_VALIDATOR_DEFAULT_FILE', false],
  ['buildPeriod2OwnershipIndex', false],
  ['listExcelFiles', false],
  ['resolveExistingExcelPath', false],
  ['parseExcelPlayers', false],
  ['hasPeriod3Excel', false],
  ['parseSpelarnaReferenceRows', false],
  ['upload.single', false],
  ['app.get("/api/spelarna-reconciliation"', false],
  ['app.post("/api/upload-excel"', false],
  ['app.get("/api/excel-files"', false],
  ['resolvePlayersForFile', false],
  ['hasPeriod3RosterSource()', true],
  ['isNyheterSnapshotCollectionPaused()', true],
  ['warmTipsenCacheOnStartup', true],
  ['app.listen', true],
];

let ok = true;
for (const [str, shouldExist] of checks) {
  const exists = src.includes(str);
  if (exists !== shouldExist) {
    console.error(`FAIL: "${str}" should ${shouldExist ? 'exist' : 'not exist'} but ${exists ? 'does' : 'does not'}`);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log('All checks passed!');
writeFileSync(filePath, src);
console.log('Written to', filePath);
