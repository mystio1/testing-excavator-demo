import type { NextConfig } from "next";

// Two build targets share this one config: the web deployment (Render, live
// server) and the Android bundle (static export baked into the APK — see
// scripts/build-android.mjs, which also strips src/app/api and src/proxy.ts
// before running this build since Route Handlers that read the request and
// Proxy can't be statically exported). BUILD_TARGET is only ever set by that
// script, never in normal dev/deploy.
const isAndroidBuild = process.env.BUILD_TARGET === "android";
const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy for the live web app (production only — `next dev`
 * needs eval/websockets for HMR).
 *
 * Documented exceptions (see docs/security.md):
 *  - script-src 'unsafe-inline': Next.js injects inline bootstrap/hydration
 *    scripts into every page. A nonce-based policy would require rendering
 *    every page dynamically through the proxy; tracked as a follow-up. All
 *    other directives are tight: no third-party script origins, no eval,
 *    no framing, no plugins, same-origin form posts and XHR only.
 *  - style-src 'unsafe-inline': Tailwind/Base UI set inline style attributes
 *    (positioning of popovers/dialogs).
 *  - img-src data: blob: — letterhead logos/signature are stored as data URLs
 *    and bill previews render them; blob: is used for client-side downloads.
 *  - fonts are self-hosted by next/font (font-src 'self').
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): the assistant's voice input needs it, and an empty
  // allowlist makes the browser refuse outright WITHOUT ever prompting — so a
  // "please allow the microphone" message could never be acted on. (self)
  // grants it to this origin alone; a third-party iframe still cannot ask.
  // Everything else stays off, including the camera.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const productionOnlyHeaders = [
  // No includeSubDomains/preload: the parent domain hosts other apps.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  ...(isAndroidBuild ? { output: "export" } : {}),
  // Do not advertise the framework on every response (scripts/check-headers.mjs asserts it is gone).
  poweredByHeader: false,
  // `headers()` is not supported by `output: "export"` (the Android bundle is
  // served from local assets inside the APK, not by this server), so it is only
  // defined for the web build.
  ...(isAndroidBuild
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [...baseSecurityHeaders, ...(isProduction ? productionOnlyHeaders : [])],
            },
            {
              // API responses carry per-user data: never let a shared cache store them.
              source: "/api/:path*",
              headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
            },
          ];
        },
      }),
  // Cloudflare quick tunnels get a fresh random *.trycloudflare.com subdomain
  // every restart — wildcarding it here means the dev server never needs to
  // be reconfigured when the tunnel URL changes, only restarted.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Hides the on-screen Next.js dev-mode route indicator — operators/owners
  // using the tunnel link shouldn't see framework chrome.
  devIndicators: false,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
