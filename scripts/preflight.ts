import { config } from "dotenv";
import { formatPreflightText, runDeploymentPreflight } from "../lib/deploy/preflight";

config({ path: ".env" });
config({ path: ".env.local", override: true });

async function main() {
  const connect = process.argv.includes("--connect");
  const asJson = process.argv.includes("--json");
  const report = await runDeploymentPreflight({
    env: process.env,
    cwd: process.cwd(),
    connect,
  });

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatPreflightText(report));
  }
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Preflight failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
