import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    // .tsx as well: the agent's DOM controller is tested against the app's
    // REAL dialog components, which have to be rendered to prove that a value
    // the controller sets actually reaches React's state (see
    // tests/agent/real-forms.test.tsx).
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    // DB-backed tests create their own throwaway tenants (unique business
    // codes) and clean them up, but the Supabase session pooler is capped at 15
    // connections and every test file opens its own Prisma pool, so files run
    // one at a time (the whole suite takes ~3.5 minutes). In CI (a local
    // Postgres service) this is simply the safe, deterministic default.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
