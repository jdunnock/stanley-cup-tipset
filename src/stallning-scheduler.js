import { runStallningJob } from "./stallning-job.js";

function getHelsinkiDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function nextRunIso(hour = 9, minute = 0) {
  const now = new Date();
  const helsinki = getHelsinkiDateParts(now);

  const utcNow = Date.UTC(
    helsinki.year,
    helsinki.month - 1,
    helsinki.day,
    helsinki.hour,
    helsinki.minute,
    helsinki.second
  );

  let target = Date.UTC(helsinki.year, helsinki.month - 1, helsinki.day, hour, minute, 0);
  if (target <= utcNow) {
    target += 24 * 60 * 60 * 1000;
  }

  return new Date(target).toISOString();
}

export function createStallningScheduler({ hour = 9, minute = 0 } = {}) {
  let timeoutHandle = null;
  let intervalHandle = null;
  let lastRun = null;
  let lastSuccessful = null;
  let lastError = null;
  let nextRun = nextRunIso(hour, minute);

  async function execute(trigger) {
    lastRun = await runStallningJob({ trigger });
    nextRun = nextRunIso(hour, minute);
    if (lastRun.status === "success") {
      lastSuccessful = lastRun;
      lastError = null;
    } else {
      lastError = { message: lastRun.details, at: lastRun.finishedAt };
    }
    return lastRun;
  }

  function msUntilNextRun() {
    return Math.max(1000, new Date(nextRun).getTime() - Date.now());
  }

  function start() {
    if (timeoutHandle || intervalHandle) {
      return;
    }

    timeoutHandle = setTimeout(async () => {
      await execute("scheduler");
      intervalHandle = setInterval(() => {
        execute("scheduler").catch(() => {});
      }, 24 * 60 * 60 * 1000);
    }, msUntilNextRun());
  }

  function stop() {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  async function runNow() {
    return execute("manual");
  }

  function getStatus() {
    return {
      timezone: "Europe/Helsinki",
      scheduledHour: hour,
      scheduledMinute: minute,
      nextRun,
      lastRun,
      lastSuccessful,
      lastError,
      active: Boolean(timeoutHandle || intervalHandle),
    };
  }

  return { start, stop, runNow, getStatus };
}
