import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Client/UI code must never pull server-only modules into the browser (or
  // into the Android static bundle, which has no server): importing the
  // database client, money helpers (Prisma runtime), services, audit, etc. at
  // RUNTIME would bundle Prisma/pg. `import type` is fine and is how pages
  // derive their data types (see src/lib/plain.ts).
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    ignores: ["src/app/api/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/db",
                "@/lib/money",
                "@/lib/audit",
                "@/lib/idempotency",
                "@/lib/rateLimit",
                "@/lib/tx",
                "@/lib/with-api",
                "@/lib/logger",
                "@/lib/request-context",
                "@/generated/*",
                "@/lib/services/*",
              ],
              allowTypeImports: true,
              message:
                "Server-only module — use `import type` in UI code (a runtime import would bundle Prisma/pg into the browser and the Android static build).",
            },
          ],
        },
      ],
    },
  },
  // Playwright fixtures take a callback named `use` — that is the framework's
  // own API for providing a fixture to a test, and it has nothing to do with
  // React's `use`. The React hooks rule cannot tell them apart and reports a
  // rules-of-hooks violation in a file with no React in it at all.
  {
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    // Generated/native output: the Capacitor-synced web bundle inside the APK
    // project and its Gradle build — not source we write.
    "android/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
