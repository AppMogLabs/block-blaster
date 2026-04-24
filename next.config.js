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

const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Phaser ships with dependencies that assume a browser globals; ensure no SSR issues
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

module.exports = withPWA(nextConfig);
