import { spawn } from "node:child_process";
// Spawn JS entrypoints with the current Node executable: same behavior on Windows and Unix.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const apiRoot = fileURLToPath(new URL("../apps/api", import.meta.url));
const webRoot = fileURLToPath(new URL("../apps/web", import.meta.url));
const apiRequire = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const webRequire = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const children = [
  spawn(
    process.execPath,
    [apiRequire.resolve("tsx/cli"), "watch", "src/server.ts"],
    { cwd: apiRoot, stdio: "inherit", env: process.env },
  ),
  spawn(
    process.execPath,
    [
      join(dirname(webRequire.resolve("vite/package.json")), "bin/vite.js"),
      "--host",
      "127.0.0.1",
    ],
    { cwd: webRoot, stdio: "inherit", env: process.env },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children) {
  child.on("error", (e) => {
    console.error(e.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
