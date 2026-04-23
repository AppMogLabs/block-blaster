# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Functional scaffold — every phase of `block-blaster-tasks.md` is wired up. The repo compiles shape-wise (contracts, TS types, React tree), but must be `npm install`-ed and env-configured before running end-to-end. See README for the quick start.

Spec docs still live at the root as design references:
- `block-blaster-prd.md` — product requirements (canonical visual/gameplay spec)
- `block-blaster-tasks.md` — original phased tasks; each still carries the Definition of Done used for QA

**Defaults to MegaETH testnet** (carrot RPC, chain id 6343). Switch to mainnet (4326) only via env vars — don't hardcode.

## Architecture (planned)

Block Blaster is a real-time onchain arcade PWA tied to MegaETH's block production rate. Difficulty modes map directly to chain throughput: Easy = 1 block/sec, Medium = 10, Hard = 50, Real-time = 100 (full chain at 10ms blocks).

**Stack:** Next.js 14 App Router (PWA via `next-pwa`) + Tailwind + Phaser 3 for the game canvas + Privy for X-OAuth embedded wallets + ethers.js v6 + Hardhat + Solidity 0.8.24 / OpenZeppelin 5.x. Chain: **MegaETH testnet `6343`** by default, mainnet `4326` via env. (The PRD's `6342` is incorrect — the real mainnet id is `4326`.)

**Three-tier flow that requires cross-file understanding:**

1. **Client game (Phaser in `components/game/GameCanvas.tsx` + `game/scenes/`)** runs the loop locally and tracks score. Phaser must be dynamically imported with `ssr: false`.
2. **Session + mint backend (Vercel edge routes under `app/api/`)** is the *trust boundary*. `/api/session` issues an HMAC-SHA256 signed, single-use, 10-minute session token keyed to a wallet. `/api/mint` re-validates the token, checks the score is plausible for `(difficultyMode, elapsed)`, marks the session used, then calls `mint()` on $BLOK and `submitScore()` on the leaderboard using `BACKEND_WALLET_PRIVATE_KEY`. **The client never signs or pays gas** — the backend wallet is the only authorized minter and is the owner of both contracts.
3. **Onchain contracts (`contracts/`)**: `BlokToken.sol` (ERC-20, decimals=0, owner-only `mint`) and `Leaderboard.sol` (top-100 per-mode displacement list, owner-only `submitScore`, emits `NewHighScore`). Both are `Ownable` with the backend wallet as owner.

Anti-cheat lives entirely in the session/mint API — if you change scoring rules in the Phaser scene, update the score-plausibility check in `/api/session/validate` in lockstep or cheating becomes trivial.

**Block visuals:** All players (guest and signed-in) see the same colour-only MegaETH-branded blocks. There is **no X-avatar pipeline** — the earlier plan to render Twitter followings as block faces has been dropped. Ignore any tasks/text in the PRD or tasks doc referring to `avatarUrl`, `/api/twitter/following`, `TWITTER_BEARER_TOKEN`, or avatar preloading.

**MegaETH live data (`hooks/useMegaEth.ts`)** polls `eth_blockNumber` every 1s and derives TPS from a 5-second rolling window; used by the home ticker and loading screen.

## Brand Constraints (enforced across UI and game)

- Background: Night Sky `#19191A` everywhere (including PWA `theme_color` and `background_color`).
- Accent palette (blocks + UI accents): `#F5AF94 #F5949D #FF8AA8 #F786C6 #90D79F #6DD0A9 #7EAAD4 #70BAD2`. Rare blocks use gold `#FFD700` outline and are 1.2× size, take 2 hits, worth 100 pts.
- Fonts: Helvetica Neue for UI; **Wudoo Mono for all numbers** (score, block numbers on block faces, chain stats). Wudoo Mono is loaded locally from `public/fonts/WudooMono.woff2`.
- Blocks render as 3D-styled cubes (front + top + right face with shaded variants) via Phaser Graphics — not flat sprites.
- Footer always shows "Powered by MegaETH". Do not imply partnership.

## Commands

- `npm run dev` / `npm run build && npm start` — Next.js (prod required to exercise service worker)
- `npm run typecheck` — `tsc --noEmit`
- `npm run hardhat:compile` / `npm run hardhat:test` — contracts
- `npm run deploy:blok` / `npm run deploy:leaderboard` — deploys via `--network megaeth` (testnet; use `megaethMainnet` for prod)
- `npm run prelaunch` — `scripts/prelaunch-check.ts` verifies deployed contracts, ownership, and a test mint + submit
- `npm run test:e2e` — Playwright (specs not yet written)

## Key invariants (don't break these)

1. **Score plausibility is server-enforced.** `lib/session.ts:validateSession` calls `maxPlausibleScore()` from `lib/difficulty.ts`. If you change scoring (base pts, rare-block value, combo multipliers, rare ratio) in `game/scenes/GameScene.ts`, update the constants in `lib/difficulty.ts:maxPlausibleScore` in the same commit or cheating becomes trivial.
2. **Single-use sessions.** `lib/session.ts` uses an in-memory `Map` with a `globalThis` stash. Fine for dev; **must be replaced with a persistent store (Vercel KV / Upstash) before production** or a player can reuse a session across serverless invocations.
3. **Backend wallet is the sole minter.** `BlokToken` and `Leaderboard` are `Ownable` and the `mint` / `submitScore` functions are `onlyOwner`. Never expose the private key or call these functions from the client.
4. **Phaser is client-only.** `components/game/GameCanvas.tsx` is dynamically imported with `ssr: false` from `app/game/GameView.tsx`. Don't import anything from `game/` into a server component.
5. **Privy is optional.** `hooks/useAuth.ts` returns a guest-mode shape when `NEXT_PUBLIC_PRIVY_APP_ID` is unset, so the app remains fully playable without sign-in — just without the commit-to-chain step.

## Required Environment Variables

Per Task 1.2, `lib/config.ts` must validate these at startup and fail loudly if missing:
`NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `MEGAETH_RPC_URL`, `BACKEND_WALLET_PRIVATE_KEY`, `BLOK_CONTRACT_ADDRESS`, `LEADERBOARD_CONTRACT_ADDRESS`, `SESSION_SECRET`. (`TWITTER_BEARER_TOKEN` dropped — no longer used.)

## Out of Scope for v1

Multiplayer, NFTs/achievements, App Store, $BLOK DEX listing, wallet-connect (Privy embedded only). Don't add these without explicit direction.
