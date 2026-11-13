// Builds the static-exported bundle Capacitor packages into the Android
// APK. Runs in the same repo as the live Render deployment, so it has to
// temporarily remove the two things static export can't contain — the API
// Route Handlers (they read the request/cookies, which `output: "export"`
// doesn't support), proxy.ts (Proxy/middleware isn't supported by static
// export either) and instrumentation.ts (a server-side hook) — then restore them no matter how the build turns out, so
// the working tree is never left half-modified.
import { existsSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

const MOVES = [
  ["src/app/api", "src/app/_api.android-build-excluded"],
  ["src/proxy.ts", "src/proxy.ts.android-build-excluded"],
  // Server-only hooks (request error logging) — meaningless in a static bundle.
  ["src/instrumentation.ts", "src/instrumentation.ts.android-build-excluded"],
];

// Plain rename() fails with EPERM on Windows while `next dev` is running
// (it holds a lock on the watched directory) — copy + remove works around
// that the same way earlier route restructures in this repo did.
async function moveAside(from, to) {
  await cp(from, to, { recursive: true });
  await rm(from, { recursive: true, force: true });
}

async function setAside() {
  for (const [from, to] of MOVES) {
    if (existsSync(from)) await moveAside(from, to);
  }
}

async function restore() {
  for (const [from, to] of MOVES) {
    if (existsSync(to)) await moveAside(to, from);
  }
}

async function run(cmd, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, BUILD_TARGET: "android" },
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
  });
}

async function main() {
  await rm("out", { recursive: true, force: true });
  // `next dev` writes .next/dev/types/validator.ts, which imports every route
  // under src/app/api. This build moves src/app/api aside, so that generated
  // file then points at modules that are not there and `next build` fails type
  // checking — meaning the Android build broke for anyone who had run the dev
  // server in the same checkout, with an error naming routes they never
  // touched. The dev server's own types are rebuilt next time it starts.
  await rm(".next/dev", { recursive: true, force: true });
  await setAside();
  try {
    await run("npx", ["next", "build"]);
  } finally {
    await restore();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
