import { runStallningJob } from "../src/stallning-job.js";

async function main() {
  const result = await runStallningJob({ trigger: "script" });
  console.log(JSON.stringify(result, null, 2));

  if (result.status !== "success") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
