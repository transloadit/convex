import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url);
mkdirSync(distDir, { recursive: true });

const packageJson = {
  type: "module",
};

writeFileSync(
  join(distDir.pathname, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`,
);
