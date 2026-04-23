# Block Blaster — Product Requirements Document
**For Claude Code | AppMog | v1.0**

---

## Overview

Block Blaster is a real-time onchain arcade game built on MegaETH. Players shoot descending blocks before they stack to the top of the screen — a mechanic inspired by Photo Blitz (AppMog's iOS app) but reimagined for the web and blockchain. The game's core hook is that its difficulty modes are tied directly to MegaETH's block production rate: 100 blocks per second at 10ms block times. Easy mode is 1 block per second. Real-time mode is the actual chain.

The game is a PWA (Progressive Web App) — no App Store, works on desktop and mobile, installable to home screen.

---

## Branding & Visual Identity

### MegaETH Brand Integration
The game should feel native to the MegaETH ecosystem. Reference assets are at:
- https://www.megaeth.com/brand-kit
- https://mega.etherscan.io/brandassets

**Colours (from MegaETH brand kit):**
- Moon White: `#ECE8E8`
- Full Moon: `#DFD9D9`
- Night Sky: `#19191A` (primary background)
- Accent palette: `#F5AF94`, `#F5949D`, `#FF8AA8`, `#F786C6`, `#90D79F`, `#6DD0A9`, `#7EAAD4`, `#70BAD2`

**Typography:**
- Primary: Helvetica Neue (titles, body, buttons)
- Secondary: Wudoo Mono (monospace, used for block numbers, stats, chain data — gives a technical terminal feel)

**Mascots:** Fluffey (rabbit with lightning ears) and Meka (battle robot) are MegaETH's mascots. They can be referenced in UI/illustrations if SVG assets are available from the brand kit download. Do not alter them.

**Logo usage:** Use "Powered by MegaETH" attribution in the footer. Do not imply partnership or endorsement.

### Game Visual Style
- Dark background (Night Sky `#19191A`)
- Neon/glow accents using the MegaETH colour palette
- Blocks should have a subtle glow and feel weighty — not flat squares
- Wudoo Mono for all in-game numbers (score, block counts, chain stats)
- Clean, minimal UI — the game is the focus

---

## Tech Stack

| Layer | Technology |
|---|---|
| Game engine | Phaser.js (canvas-based, handles mouse + touch natively) |
| Frontend framework | Next.js (PWA configured) |
| Wallet & auth | Privy (embedded wallets, X/Twitter OAuth login) |
| Blockchain | MegaETH mainnet (EVM compatible, 10ms blocks, 100k TPS) |
| Smart contracts | Solidity — ERC-20 token + leaderboard contract |
| Backend/API | Vercel serverless edge functions |
| Twitter API | X API v2 (pay-as-you-go) for fetching following list |
| Styling | Tailwind CSS |

---

## User Flow

### 1. Landing / Home Screen
- Game title: **BLOCK BLASTER**
- Tagline: *"The chain never stops. Can you keep up?"*
- Two CTAs: **Play as Guest** | **Sign in with X**
- Brief explainer of the concept (1–2 lines max)
- "Powered by MegaETH" with logo

### 2. Sign In with X (optional for v1, required for token rewards)
- Privy handles the OAuth flow
- On success: embedded wallet silently created — user never sees seed phrase or wallet address unless they ask
- After sign-in: fetch the user's following list via X API v2, sort by `public_metrics.followers_count` descending, take top 50
- Profile pictures pulled from Twitter CDN (`pbs.twimg.com`) — reliable, fast, no IPFS
- These avatars are used as block face textures in the game (see Block Design section)
- Guest players get generic block designs (see below)

### 3. Difficulty Selection
Present four modes clearly. The chain context is the sell:

| Mode | Blocks per second | Description |
|---|---|---|
| **Easy** | 1 | 1 in 100 blocks descends |
| **Medium** | 10 | 1 in 10 blocks descends |
| **Hard** | 50 | 1 in 2 blocks descends |
| **Real-time** | 100 | Every block. Good luck. |

Show the live MegaETH block number ticking in the corner during selection — sets the scene immediately.

### 4. Loading Screen
- "Loading the chain..." with blocks appearing one by one
- Preload all sprite assets before game starts — no mid-game pop-in
- Show current MegaETH TPS and block height as flavour text

### 5. Gameplay (see full mechanics below)

### 6. Game Over / Score Banking
**Survived (reached end of timer or chose to bank):**
- Score displayed with animation
- "Commit to chain" CTA
- Backend validates session, mints ERC-20 tokens equal to score to player's Privy wallet
- Transaction hash displayed with link to MegaETH explorer
- Leaderboard updated

**Died (stack reached the top):**
- "Chain buried you." message
- Score shown but not minted — nothing committed
- "Try again" CTA
- Option to share score on X regardless

---

## Gameplay Mechanics

### Core Loop
Blocks descend from the top of the screen at a rate determined by difficulty mode. The player shoots blocks before they land. Missed blocks stack at the bottom (Tetris-style). If the stack reaches the top of the screen, game over. Survive long enough to bank your score.

### Controls
- **Desktop:** Mouse to aim, click to shoot. Cursor acts as crosshair.
- **Mobile:** Tap directly on a block to shoot it.
- Phaser handles both input methods natively — one codebase.
- Hit detection uses a forgiving radius around each block (not pixel-perfect). Radius slightly tightens on Hard and Real-time modes.

### Block Design
Blocks are 3D-styled cubes with slight glow, styled using the MegaETH colour palette. Each block gets a unique colour combination drawn from the brand accent colours (`#F5AF94`, `#F5949D`, `#FF8AA8`, `#F786C6`, `#90D79F`, `#6DD0A9`, `#7EAAD4`, `#70BAD2`). No external assets or API calls required for block rendering.

All blocks display their **block number** (Wudoo Mono font) on the face — ties the visual to the chain.

### Scoring
- Base score per block destroyed: 10 points
- **Combo multiplier:** Destroy 5 blocks in quick succession = 2x multiplier. 10 in a row = 3x. Resets on miss.
- **Rare blocks:** Every ~20 blocks, a gold-outlined rare block appears worth 100 points. Faster, takes 2 hits.
- Score is displayed live in Wudoo Mono, top right.

### Stack & Combos
- Missed blocks stack from the bottom row upward
- **Combo clear:** Destroy 5 blocks consecutively without a miss = bottom row of the stack is cleared (visual reward: row explodes, screen flash)
- Stack height shown as a warning indicator on the left side — green > yellow > red as it rises

### Game Session
- Each game is timed: Easy = 90 seconds, Medium = 60 seconds, Hard = 45 seconds, Real-time = 30 seconds
- Player can choose to **bank early** at any point before the timer runs out — score is locked in and committed to chain
- If stack reaches the top before timer ends: game over, no mint
- If timer runs out with stack below the top: automatic bank and mint

---

## Smart Contracts

### ERC-20 Token: $BLOK
- Name: Block Blaster Token
- Symbol: $BLOK
- Decimals: 0 (whole numbers only — score maps 1:1)
- Mint function callable only by the game's backend wallet (owner-controlled)
- No max supply cap for v1 (can add later)
- Deploy to MegaETH mainnet

### Leaderboard Contract
- Stores: player address, score, timestamp, difficulty mode
- Top 100 scores per difficulty mode queryable onchain
- Emits event on new high score

### Backend Minting Flow
1. Game session starts: backend issues a signed session token to client
2. Game ends (survived): client sends session token + final score to backend API
3. Backend validates: session token is valid, hasn't been used before, score is within plausible range for difficulty + time played
4. Backend wallet calls `mint(playerAddress, score)` on $BLOK contract
5. Transaction hash returned to client, displayed to player
6. Leaderboard contract updated

Anti-cheat: session tokens are single-use, server-generated, tied to wallet address. Score range validation prevents impossibly high scores.

---

## Transaction Sponsorship (Paymaster)
Players should never pay gas. The game backend sponsors all minting transactions. MegaETH gas fees are negligible. Use a paymaster or simply have the backend wallet fund and submit all mint transactions directly. Player's Privy embedded wallet receives tokens without needing ETH for gas.

---

## PWA Configuration
- Installable to home screen on iOS and Android
- Fullscreen mode (no browser chrome)
- App icon: Block Blaster logo (to be designed — use MegaETH colour palette)
- Splash screen on load
- Offline: show "You need to be online to play" — no offline mode needed for v1

---

## Leaderboard UI
- Accessible from home screen
- Shows top 20 scores globally, filterable by difficulty mode
- Columns: rank, X handle (if signed in) or truncated wallet address, score, difficulty, date
- Live — reads directly from leaderboard contract
- Player's own best score highlighted if signed in

---

## Screens Summary

1. **Home/Landing** — title, tagline, play options, live block ticker
2. **Auth** — Privy X OAuth (if signing in)
3. **Difficulty Select** — four modes with chain context
4. **Loading** — asset preload with chain flavour
5. **Game** — full screen Phaser canvas
6. **Game Over (survived)** — score, mint CTA, share button
7. **Game Over (died)** — score (unminted), retry CTA, share button
8. **Leaderboard** — global top scores by difficulty
9. **Wallet** — simple view of $BLOK balance (accessible from menu)

---

## Out of Scope for v1
- Multiplayer / PvP mode
- NFT collection themes
- Achievement NFTs (onchain achievements as soulbound tokens — future)
- Mobile app / App Store submission
- $BLOK token trading or DEX listing
- Wallet connect (MetaMask etc.) — Privy embedded wallets only for v1

---

## Reference
- Photo Blitz (AppMog) — the combo mechanic, difficulty scaling, and session banking are directly inspired by this app. The core "objects descend, player reacts, combos matter" loop is proven.
- MegaETH docs: https://docs.megaeth.com
- MegaETH explorer: https://mega.etherscan.io
- Privy docs: https://docs.privy.io
- Phaser.js: https://phaser.io

---

*AppMog | Block Blaster v1.0 PRD*
