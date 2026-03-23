import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const AUDIT_LOG_FILE = path.resolve(process.cwd(), "data", "stallning-audit.log");

export async function runStallningJob({ trigger = "manual" } = {}) {
  const startedAt = new Date();

  const result = {
    trigger,
    status: "success",
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    datasetVersion: `playoff-${startedAt.toISOString().slice(0, 10)}`,
    details: "Scheduler skeleton run completed.",
  };

  try {
    await mkdir(path.dirname(AUDIT_LOG_FILE), { recursive: true });
    result.finishedAt = new Date().toISOString();
    await appendFile(AUDIT_LOG_FILE, `${JSON.stringify(result)}\n`, "utf8");
    return result;
  } catch (error) {
    result.status = "error";
    result.finishedAt = new Date().toISOString();
    result.details = String(error?.message || error);
    return result;
  }
}
