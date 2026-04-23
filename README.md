# Block Blaster

A real-time onchain arcade PWA built on **MegaETH**. Blast descending blocks before they stack — difficulty scales with the chain's actual block production rate (1, 10, 50, or 100 blocks / sec).

> **Status**: functional scaffold. Contracts compile + tests pass (33/33). Session + mint APIs, rate limiting, PWA manifest, service worker, and Playwright smoke tests are wired. Still needs contract deployment + env config before it runs end-to-end.

---

## Quick start (local dev)

```bash
# 1. install
npm install

# 2. configure env
cp .env.local.example .env.local
# fill in at minimum: SESSION_SECRET, BACKEND_WALLET_PRIVATE_KEY
# (Privy/Upstash optional in dev; contract addresses become required after deploy)

# 3. compile + unit-test contracts
npm run hardhat:compile
npm run hardhat:test

# 4. run the app
npm run dev
# → http://localhost:3000 (guest mode works without Privy or deployed contracts)
```

## Deploy runbook (testnet → mainnet)

This is the order that gets you from a fresh clone to `block-blaster.app` serving real users.

### 1. Provision managed services

| Service | Purpose | Env vars it provides |
|---|---|---|
| **Privy** (privy.io) | X-OAuth embedded wallets | `NEXT_PUBLIC_PRIVY_APP_ID` (+ optional `PRIVY_APP_SECRET`) |
| **Upstash Redis** (upstash.com) | Session-replay + rate limiting | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |
| **Vercel** | Hosting + CI/CD | — |

Both Privy and Upstash have generous free tiers. If you use **Vercel KV** instead of Upstash, it exposes the same `KV_REST_API_URL`/`KV_REST_API_TOKEN` REST interface — `lib/sessionStore.ts` and `lib/rateLimit.ts` work with either.

### 2. Fund + document the backend wallet

```bash
# generate a dedicated signer — never reuse a personal wallet
openssl rand -hex 32 > backend.key
# → BACKEND_WALLET_PRIVATE_KEY is the contents of this file (prepend 0x)
```

Fund the wallet's address with a small amount of MegaETH testnet ETH (faucet: https://www.megaeth.com — look for the testnet faucet) so it can pay gas for `mint()` + `submitScore()`.

### 3. Deploy contracts (testnet first)

```bash
# 3a. Deploy $BLOK with your backend wallet as owner.
npm run deploy:blok
# → copy the printed address to BLOK_CONTRACT_ADDRESS + NEXT_PUBLIC_BLOK_CONTRACT_ADDRESS

# 3b. Deploy Leaderboard with the same owner.
npm run deploy:leaderboard
# → copy to LEADERBOARD_CONTRACT_ADDRESS + NEXT_PUBLIC_LEADERBOARD_CONTRACT_ADDRESS

# 3c. Verify end-to-end: funds + ownership + one mint + one submit
npm run prelaunch
# → exits 0 if wallet is funded, owns both contracts, and can mint/submit
```

### 4. Wire up Vercel

```bash
# Link the repo
vercel link  # or: push to github.com/AppMogLabs/block-blaster and import via Vercel UI

# Add env vars (from your filled .env.local)
vercel env add SESSION_SECRET production
vercel env add BACKEND_WALLET_PRIVATE_KEY production
vercel env add MEGAETH_RPC_URL production
vercel env add BLOK_CONTRACT_ADDRESS production
vercel env add LEADERBOARD_CONTRACT_ADDRESS production
vercel env add KV_REST_API_URL production
vercel env add KV_REST_API_TOKEN production
vercel env add NEXT_PUBLIC_PRIVY_APP_ID production
vercel env add NEXT_PUBLIC_BLOK_CONTRACT_ADDRESS production
vercel env add NEXT_PUBLIC_LEADERBOARD_CONTRACT_ADDRESS production
# (repeat for preview + development environments as needed)

# Attach the custom domain
vercel domains add block-blaster.app
```

Push to `main` → Vercel auto-deploys. First deploy should succeed because `getServerConfig()` validates every required var at first request.

### 5. Mainnet switch

When you're ready for production chain:

1. Redeploy both contracts against `--network megaethMainnet` (defined in `hardhat.config.ts`).
2. Update Vercel env vars:
   - `MEGAETH_RPC_URL` → `https://mainnet.megaeth.com/rpc`
   - `NEXT_PUBLIC_MEGAETH_RPC_URL` → same
   - `NEXT_PUBLIC_MEGAETH_CHAIN_ID` → `4326`
   - `NEXT_PUBLIC_MEGAETH_EXPLORER` → mainnet explorer URL
   - `BLOK_CONTRACT_ADDRESS` / `LEADERBOARD_CONTRACT_ADDRESS` + their `NEXT_PUBLIC_*` pairs → mainnet addresses
3. Redeploy (`vercel --prod`).

> **Note on chain IDs**: the PRD incorrectly says mainnet is `6342`. The real mainnet id is **`4326`**, testnet is **`6343`**. `lib/config.ts` defaults to `6343`.

---

## Architecture at a glance

- **Client game** (`components/game/GameCanvas.tsx` + `game/scenes/GameScene.ts`) — Phaser 3, dynamically imported (no SSR), emits score/combo/timer events to React via a `Phaser.Events.EventEmitter`. Wrapped in `GameErrorBoundary` so Phaser crashes render a retry card instead of a blank route.
- **Session & mint backend** (`app/api/session/*`, `app/api/mint/route.ts`) — HMAC-SHA256 signed, single-use, 10-minute tokens. Plausibility check enforced server-side against `lib/difficulty.ts` (pinned against drift by `test/ScoreDrift.test.ts`). Wallet-keyed rate limiting at 12 session-issues/min and 10 mints/min via `lib/rateLimit.ts`. The backend wallet is the sole minter.
- **Contracts** (`contracts/BlokToken.sol`, `contracts/Leaderboard.sol`) — OpenZeppelin `Ownable`, owner-only write surface. Leaderboard keeps a sorted top-100 per mode using bubble-insert with strict `>` comparison (earlier submissions win ties). Slots pre-allocated to amortize MegaETH's fresh-storage cost.
- **Live data** (`hooks/useMegaEth.ts`) — 1-second polling of `eth_blockNumber`, TPS derived from a 5-second rolling window.
- **Logging** (`lib/logger.ts`) — one-line JSON per event with `ts`, `level`, `route`, `event`, plus structured fields. Drops into Vercel log drain, Datadog, or any tail collector.

See `CLAUDE.md` for invariants future Claude Code sessions must preserve.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build && npm start` | Production build — exercises the service worker |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run hardhat:compile` / `hardhat:test` | Contracts (33 tests including drift + edge cases) |
| `npm run deploy:blok` / `deploy:leaderboard` | Deploy (uses `--network megaeth` = testnet) |
| `npm run prelaunch` | `scripts/prelaunch-check.ts` — ownership + mint + submit against deployed contracts |
| `npm run test:e2e` | Playwright (boots dev server if `E2E_BASE_URL` unset) |

## Environment variables

Required at runtime (server throws on missing via `getServerConfig()`):

| Var | What it is |
|---|---|
| `MEGAETH_RPC_URL` | RPC endpoint the backend wallet uses for mint/submit |
| `BACKEND_WALLET_PRIVATE_KEY` | Signer that owns BLOK + Leaderboard. `0x`-prefixed hex. |
| `BLOK_CONTRACT_ADDRESS` | Deployed $BLOK address |
| `LEADERBOARD_CONTRACT_ADDRESS` | Deployed leaderboard address |
| `SESSION_SECRET` | HMAC-SHA256 key. `openssl rand -hex 32` |

Recommended in prod (otherwise the APIs silently fall back to in-memory Map/counter, which a single cold start wipes — CLAUDE.md flags this as an invariant):

| Var | What it is |
|---|---|
| `KV_REST_API_URL` | Upstash Redis or Vercel KV REST URL |
| `KV_REST_API_TOKEN` | Matching bearer token |

Public (exposed to client bundle — safe):

| Var | What it is |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app id (enables X sign-in; absent → guest mode only) |
| `NEXT_PUBLIC_MEGAETH_RPC_URL` | RPC the client uses for the live-block ticker |
| `NEXT_PUBLIC_MEGAETH_CHAIN_ID` | `6343` (testnet) or `4326` (mainnet) |
| `NEXT_PUBLIC_MEGAETH_EXPLORER` | Blockscout URL for tx hash links |
| `NEXT_PUBLIC_BLOK_CONTRACT_ADDRESS` | Client reads token balance / decimals from this |
| `NEXT_PUBLIC_LEADERBOARD_CONTRACT_ADDRESS` | Client reads top-100 from this |

## MegaETH notes

- Base fee is stable at 0.001 gwei — do not add EIP-1559 priority fee buffers.
- Block time ~10 ms. The mint API returns the tx hash immediately without waiting for a receipt; inclusion is effectively instant. If you need stronger guarantees, `await mintTx.wait()` in `app/api/mint/route.ts`.
- Fresh SSTORE is expensive on MegaEVM; `Leaderboard.sol` pre-allocates the 100-slot ring so slot reuse dominates.

## What's intentionally missing

- **PNG icons**: `public/icons/icon-192.svg` and `icon-512.svg` ship. Replace with PNG raster if your target platforms need it.
- **Wudoo Mono font file**: drop a licensed `WudooMono.woff2` into `public/fonts/` and uncomment the `@font-face` block in `app/globals.css`. A system monospace fallback is in place.
- **Full mint E2E**: `e2e/` covers home/difficulty/game-flow/rate-limit/session; the mint flow itself is only covered at the session-validation layer because a real mint requires funded testnet env vars. Add a `mint.spec.ts` once contracts are deployed.

## License

Internal project — AppMog.
