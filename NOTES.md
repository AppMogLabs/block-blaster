# Continuation Notes

Last session ended at commit `a025957` (TESTING.md + dead-code cleanup + tx-hash toast links).

## Current state — beta-ready

- **Live URL**: https://block-blaster.app (Vercel auto-deploys on push to `main`)
- **Network**: MegaETH testnet (chain id 6343)
- **Contracts (testnet)**:
  - `BlokToken`: `0xe57fF003aE4803C30d616493E9237ba17c3756F0`
  - `Leaderboard`: `0xa8086c3c9C513CE79673f132f3b1D3205c19F47E`
  - `GameRewards`: `0xADB8E6593FfF04b983B55CB9606329307B54e46d`
  - GameRewards has the secondary minter slot on BlokToken; backend wallet is owner of all three.
- **Backend wallet**: `0x3382189F8a29607FdDf3D692B10a2D74480a503F`. User reported ~1 testnet ETH balance.
- **Tests**: 65 Hardhat + 21 Vitest = 86 total, all passing. `npm test` runs everything.

## What's done

- All four phases of onchain mechanics: contracts, API endpoints, frontend wire-up, dual-condition nuke + sweep reload + wager.
- Banking model: cumulative mid-run mints to wallet via `/api/bank` (non-consuming session). `/api/game-end` consumes the session on win/death and burns active wager on death via `recordDeath`.
- Privy with X / Email / Google login, Privy embedded wallet, auto-drip 0.001 ETH on first sign-in, `clientsClaim: true` PWA so deploys take over open tabs.
- Wallet chip + explorer link in every header (`components/ui/WalletChip.tsx`).
- Wallet key export via Privy (`components/ui/ExportWalletButton.tsx`, on home page below "How it works").
- Tx hash link in every success toast via `lib/txLink.ts`.
- Per-mode personal best chip in the game HUD; "NEW PB" flash when the run beats it.
- Active-wager banner on `/difficulty` with Resume + Forfeit buttons + `/api/wager/forfeit` escape hatch.

## What I need from the user before mass beta

1. **Replace the bug-reporting placeholder in `TESTING.md`** with their preferred channel (currently says `[replace with your preferred channel — Discord link / X DM / Google form URL]`).
2. **Top up backend wallet ETH** if it's been a while. Check at `https://megaeth-testnet-v2.blockscout.com/address/0x3382189F8a29607FdDf3D692B10a2D74480a503F`. Each new tester eats ~0.001 ETH for the drip + small fractions for tx gas.
3. **Smoke test** the full first-time flow once on a fresh account before sending the link out.
4. **Promo video**: I gave a shot list and tooling recommendations earlier in the session. User said they'd handle this.

## Suggested next priorities (in order)

1. **Vercel Analytics** — user mentioned the agent was setting it up. Verify it lands and we have data flowing.
2. **Backend wallet balance monitoring** — simple cron or alert. If wallet drains, every drip + tx silently fails.
3. **Viral share post-run**: after a win, an X tweet button with `"I scored {N} $BLOK on Block Blaster ← view tx"` linking to the explorer. Already have the share URL infra, just needs the tx hash + better copy.
4. **First-run tooltips** in `GameView.tsx`: "hold to sweep", "click bank to mint", etc. Single-show via localStorage flag.
5. **Atomic mint + leaderboard submit** — audit finding L-01 follow-up. Currently `/api/bank` mints + submits as separate txs. A `GameRewards.bankAtomic()` method would unify them. Not urgent.
6. **React component tests** — the optimistic balance / nuke gate / wager flow have no unit coverage. `@testing-library/react` + jsdom setup.
7. **Mobile sweep gesture polish** — user tested on iOS, but if reports come in about hold-to-sweep being awkward, consider tap-and-hold-anywhere semantics.

## Pre-mainnet checklist

Most of the original checklist was shipped as a batch ahead of mainnet (this commit). What's left is design / verification work that can't be solved by code alone.

### Done in code (this batch)
- ✅ `/api/wager/forfeit` — Privy identity-token auth required; wallet must match auth claim
- ✅ `/api/session/validate` — rate-limited via `sessionRateLimit`
- ✅ Drip amount `0.001 → 0.0001` ETH (`MIN_BALANCE` adjusted)
- ✅ `approved` predicate strict — only `=== "max"` counts
- ✅ ApproveBanner displays spender contract address with explorer link
- ✅ `lib/sessionStore.ts` + `lib/rateLimit.ts` hard-fail in production if KV missing
- ✅ Rate limiter falls back to a conservative 2/min/key in-memory cap on KV outage instead of fail-open
- ✅ `/api/bank` awaits `recordTx.wait()` before 200
- ✅ `approve()` refreshes balance in `finally` so a late-landing tx clears the banner
- ✅ `?mode=99` URL no longer crashes — invalid values fall back to Easy

### Still required for mainnet (not shipped)
- [ ] **Top up `BACKEND_WALLET_PRIVATE_KEY` mainnet ETH** sufficient for `0.0001 × expected_users + headroom for game ops`. ~`0.2 ETH` for 1k launch users.
- [ ] **Backend wallet balance monitoring** — cron/alert when balance dips below threshold. Without it, drips silently 500 and gameplay locks.
- [ ] **Confirm `KV_REST_API_URL` + `KV_REST_API_TOKEN` set in mainnet Vercel env** (separate from preview/testnet env). The hard-fail above will crash boot otherwise.
- [ ] **Confirm `PRIVY_APP_SECRET` set in mainnet Vercel env**. JWT auth on `/api/faucet-drip` and `/api/wager/forfeit` will 500 otherwise.
- [ ] **Replace bug-reporting placeholder in TESTING.md** with the real channel.
- [ ] **Smoke-test the full new-user flow on mainnet** with a fresh X account: sign in → welcome modal → approve → play → bank → win → leaderboard → wager. End-to-end, no errors.

### Deferred — design decisions, not blocking
- [ ] **Score plausibility ceiling review** — Real-time mode allows up to ~163k $BLOK per 30s run (`lib/difficulty.ts:maxPlausibleScore`). Calibrate vs $BLOK economics before any DEX listing or NFT redemption.
- [ ] **First-bank ceiling shape** — a player can legitimately bank zero for 34s then bank max in one shot. If $BLOK has real value, consider per-bank-elapsed ceilings.
- [ ] **`getChain()` invalidation on RPC failure** — singleton in `lib/chain.ts` pins routes to a dead provider until cold start. Marginal value on MegaETH; revisit if outages are observed.
- [ ] **Nuke visual fires before API call resolves** — disconnect-WiFi exploit gives a free nuke. Awaiting the API would add latency; user accepted as is.
- [ ] **Privy gas sponsorship + Smart Wallets** — sponsorship is enabled in dashboard but doesn't fire for embedded EOA wallets. Would need ERC-4337 Smart Wallets refactor. Not blocking — faucet-drip path is the working approach.

## Known limitations / debt

- `/api/wager/forfeit` has no signature verification — testnet-only acceptable, but pre-mainnet needs a Privy JWT check.
- The 500ms settle delay in `ApproveBanner` is a workaround, not a proper state machine.
- Session store + rate limiter share Upstash Redis; no per-user TTL eviction beyond what we set explicitly.
- `next-pwa` is on the older 5.6.0 line; could move to 5.6.x or replace with `serwist` later.

## Key files for next session

- **Frontend gameplay**: `app/game/GameView.tsx` (all the React-side mechanics), `game/scenes/GameScene.ts` (Phaser logic).
- **API**: `app/api/{balance,bank,nuke,sweep-reload,wager,wager/forfeit,game-end,faucet-drip}/route.ts`.
- **Hooks**: `hooks/useBlok.ts` (live BLOK state + approve/optimistic).
- **Contracts**: `contracts/{BlokToken,GameRewards,Leaderboard}.sol`.
- **Tests**: `test/*.test.ts` (Hardhat), `vitest-tests/*.test.ts` (Vitest).
- **Docs**: `TESTING.md` for testers, `README.md` for deploy runbook, `CLAUDE.md` for invariants.
