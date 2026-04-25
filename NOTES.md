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
