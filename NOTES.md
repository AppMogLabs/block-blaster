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

## Pre-mainnet checklist (do NOT launch real-money without these)

Captured from the pre-public-test audit (commit `81a39f9` + this session). Items below are tolerated on testnet; every one is a real exposure if the chain has actual economic value.

### Auth & abuse
- [ ] `/api/wager/forfeit` — currently anyone can POST `{walletAddress}` and burn any player's active wager. Add Privy identity-token verification (same pattern as `/api/faucet-drip`, see `lib/privyAuth.ts`). NOTES already flagged this; the audit re-flagged as grief-vector, not just "not signed".
- [ ] `/api/session/validate` — no rate limit. Free signature-verification oracle. Add `await sessionRateLimit().check(ip)` to match `/api/session`.
- [ ] `/api/faucet-drip` — if it survives the gas-sponsorship migration, drop drip amount from `0.001` ETH to `0.0001` ETH (`DRIP_AMOUNT` in `app/api/faucet-drip/route.ts`). Cuts mainnet sponsorship cost 10x with adequate headroom for an approve() at MegaETH gas prices. Better: delete the endpoint entirely once sponsorship is verified working end-to-end.
- [ ] Privy gas-sponsorship policy attached + tested. Policy created during testnet bring-up restricts sponsored txs to `approve(GameRewards, *)` on BlokToken. Verify the policy is selected on the Gas sponsorship page (not just created in Policies) and that an unrelated tx (e.g., a transfer) gets refused sponsorship.
- [ ] Verify default policy semantics are deny-by-default. With one ALLOW rule and default-deny, only the matching tx is sponsored. With default-allow, every tx is sponsored — useless. Privy may surface this as a top-level toggle.

### Economic / state
- [ ] Score plausibility ceiling — Real-time mode allows up to ~163k $BLOK per 30s run (`lib/difficulty.ts:maxPlausibleScore`, slack=1.25, peakComboMultiplier=3, durationSec+5 cap). Calibrate against $BLOK token economics before any DEX listing or NFT redemption.
- [ ] First-bank ceiling shape — a player can legitimately bank zero for 34s then bank the maximum in one shot. The system can't distinguish "earned over 30s" from "teleported to max at second 34". If $BLOK has value, consider per-bank-elapsed ceilings, not just session-elapsed.
- [ ] Tighten `approved` predicate in `useBlok.ts:102`. Currently treats any allowance > 0 as approved; partial allowance from a prior session passes the gate then transferFrom reverts. Change to `=== "max"` or `>= 100`.
- [ ] Display approve spender address in the Approve UI (`components/ApproveBanner.tsx`). MaxUint256 grant to GameRewards is sensitive — show the address users are approving so a build-time supply-chain compromise can't silently swap the spender.

### Resilience / correctness
- [ ] Harden `lib/sessionStore.ts` and `lib/rateLimit.ts` to throw in production if KV env vars are missing, instead of silently falling back to in-process Map. Single-use session guarantee collapses across serverless instances if KV is gone.
- [ ] Rate limiter fails open on KV error. Implement a conservative local fallback (e.g., 2/min in-memory) instead of returning `{ ok: true }` unconditionally on KV failure (`lib/rateLimit.ts:80-107`).
- [ ] `/api/bank` doesn't `await recordTx.wait()` before responding 200. If `recordBank` reverts on-chain (e.g., wager settlement edge case), the client believes the bank settled. Either await the wait or return a separate status field.
- [ ] `getChain()` singleton in `lib/chain.ts` never invalidates. One MegaETH RPC blip pins all routes to a dead provider until cold start. Add a health check or reset path on `CALL_EXCEPTION`.
- [ ] `approve()` 45s timeout in `useBlok.ts` doesn't `refresh()` the balance after timing out. Late-landing tx leaves the user staring at the banner forever. Add `refresh()` in a finally block.
- [ ] `?mode=99` in the URL crashes the game route (`app/game/GameView.tsx:34`). Validate `modeId` before the type cast. Cosmetic on testnet, error-page on mainnet.
- [ ] Nuke visual fires before the API call resolves (`app/game/GameView.tsx`). Disconnect-WiFi exploit gives a free nuke. Tolerable on testnet (no real $BLOK lost) — for mainnet, await the API or add a revert path.

### Pre-launch verification
- [ ] Smoke-test the full new-user flow on a fresh X account: sign in → welcome modal → approve (sponsored, no user gas) → play → bank → win → leaderboard → wager. End-to-end, no errors, no banner stuck.
- [ ] Top up `BACKEND_WALLET_PRIVATE_KEY` mainnet ETH balance. Without it, every mint, recordBank, spendNuke, etc. reverts.
- [ ] Replace bug-reporting placeholder in TESTING.md.
- [ ] Confirm `KV_REST_API_URL` + `KV_REST_API_TOKEN` are set in mainnet Vercel env (NOT just testnet).
- [ ] Confirm `PRIVY_APP_SECRET` is set in mainnet Vercel env.

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
