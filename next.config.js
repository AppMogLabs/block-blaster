/** @type {import('next').NextConfig} */
const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // skipWaiting + clientsClaim together force the new SW to take control of
  // open tabs immediately on deploy, instead of waiting for every old tab to
  // close. Without clientsClaim, users can end up running a week-old bundle.
  skipWaiting: true,
  clientsClaim: true,
  fallbacks: {
    document: "/offline",
  },
});

// Content Security Policy for Privy embedded wallets + MegaETH RPC.
// Privy guidance: https://docs.privy.io/security/implementation-guide/content-security-policy
//   - auth.privy.io hosts the embedded-wallet iframe
//   - challenges.cloudflare.com serves Turnstile (Privy's CAPTCHA)
//   - *.rpc.privy.systems is Privy's RPC proxy
// Next.js (prod) emits inline runtime scripts → 'unsafe-inline' is required.
// 'unsafe-eval' is needed by some wallet SDKs and Phaser shaders.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://auth.privy.io https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
  [
    "connect-src 'self'",
    "https://auth.privy.io",
    "https://*.rpc.privy.systems",
    "https://*.privy.io",
    "wss://*.privy.io",
    "https://carrot.megaeth.com",
    "https://*.megaeth.com",
    "wss://carrot.megaeth.com",
    "wss://*.megaeth.com",
    "https://explorer-api.walletconnect.com",
    "https://relay.walletconnect.com",
    "wss://relay.walletconnect.com",
    "wss://relay.walletconnect.org",
  ].join(" "),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  webpack: (config) => {
    // Phaser ships with dependencies that assume a browser globals; ensure no SSR issues
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

module.exports = withPWA(nextConfig);
