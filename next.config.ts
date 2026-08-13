import type { NextConfig } from "next";

/**
 * Security headers (FR-SEC-27..31). CSRF for server actions is enforced by Next's
 * built-in same-origin check plus SameSite=Lax session cookies. The CSP permits the
 * inline/eval that the Next dev runtime needs; Phase 12 tightens it with nonces.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: http://localhost:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Standalone server output for the production Docker image (Phase 12 deployment).
  output: "standalone",
  // Node-only OCR libs — leave them as runtime requires, never bundle them (they use
  // worker threads / WASM and dynamic requires that a bundler would break). OCR runs
  // server-side, so the browser CSP does not affect their model fetches.
  serverExternalPackages: ["tesseract.js", "unpdf"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
