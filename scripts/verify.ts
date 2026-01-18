import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.js";

loadEnv();

type Mode = "browser" | "example" | "convex";

const args = process.argv.slice(2);
const modeIndex = args.indexOf("--mode");
const mode =
  (modeIndex !== -1 ? args[modeIndex + 1] : undefined) ??
  process.env.VERIFY_MODE ??
  "browser";
const appIndex = args.indexOf("--app");
const app = appIndex !== -1 ? args[appIndex + 1] : undefined;
const useTemplate = args.includes("--use-template");

const normalizedMode = (mode === "example" ? "example" : mode) as Mode;
const script =
  normalizedMode === "convex" ? "verify-convex.ts" : "run-browser.ts";

const scriptArgs: string[] = [];
if (normalizedMode === "example" || app === "example") {
  scriptArgs.push("--app", "example");
}
if (useTemplate) {
  scriptArgs.push("--use-template");
}

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const scriptPath = resolve(scriptsDir, script);

const result = spawnSync("node", [scriptPath, ...scriptArgs], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
