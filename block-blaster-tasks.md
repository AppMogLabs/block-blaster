# Block Blaster — Claude Code Task Breakdown
**AppMog | v1.0 | Based on PRD v1.0**

> Hand each task to Claude Code as a standalone prompt. Tasks are ordered by dependency — complete earlier phases before starting later ones.

---

## Phase 1 — Project Scaffold

### Task 1.1 — Initialize Next.js + PWA Project
**Prompt for Claude Code:**
Create a new Next.js 14 (App Router) project called `block-blaster`. Configure it as a Progressive Web App using `next-pwa`. Set up Tailwind CSS. Add the MegaETH brand font stack: Helvetica Neue as the primary font via CSS, and Wudoo Mono loaded as a local web font (create a placeholder `public/fonts/WudooMono.woff2` slot and configure it in `globals.css`). Set the global background colour to `#19191A` (Night Sky). Add a `manifest.json` under `public/` with app name "Block Blaster", theme colour `#19191A`, and display mode `fullscreen`.

**Definition of Done:**
- `npx next dev` starts without errors
- `/` route renders a dark (`#19191A`) page
- `manifest.json` is valid (verify with Chrome DevTools > Application > Manifest — no errors shown)
- PWA lighthouse score for installability shows no blocking issues
- Tailwind utility classes apply correctly (test with a sample `bg-red-500` div)
- `next-pwa` service worker registers in production build (`npx next build && npx next start`)

---

### Task 1.2 — Environment Variables & Config
**Prompt for Claude Code:**
Create a `.env.local.example` file documenting every required environment variable for the project. Variables needed: `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `MEGAETH_RPC_URL`, `BACKEND_WALLET_PRIVATE_KEY`, `BLOK_CONTRACT_ADDRESS`, `LEADERBOARD_CONTRACT_ADDRESS`, `TWITTER_BEARER_TOKEN`, `SESSION_SECRET`. Add a `lib/config.ts` that imports and validates all env vars at startup, throwing a clear error if any are missing.

**Definition of Done:**
- `.env.local.example` exists with all variables documented with comments
- `lib/config.ts` exports typed config object
- Starting the dev server without env vars throws a human-readable error listing which vars are missing (not a cryptic undefined error)
- No secrets are committed — `.env.local` is in `.gitignore`

---

## Phase 2 — Smart Contracts

### Task 2.1 — $BLOK ERC-20 Token Contract
**Prompt for Claude Code:**
Write a Solidity smart contract (`contracts/BlokToken.sol`) for the $BLOK ERC-20 token. Spec: name "Block Blaster Token", symbol "BLOK", decimals 0, no max supply cap. Only the contract owner can call `mint(address to, uint256 amount)`. Use OpenZeppelin's `ERC20` and `Ownable` base contracts. Write a Hardhat deploy script (`scripts/deployBlok.ts`) that deploys to MegaETH mainnet (chain ID: 6342). Write a test file (`test/BlokToken.test.ts`) covering: owner can mint, non-owner cannot mint, decimals returns 0, minted balance is reflected correctly.

**Definition of Done:**
- `npx hardhat compile` completes with no errors or warnings
- `npx hardhat test` — all tests pass (4 tests minimum)
- Contract is under 24KB compiled bytecode
- `mint` function emits the standard ERC-20 `Transfer` event from zero address
- Deploy script logs the deployed contract address on success

---

### Task 2.2 — Leaderboard Contract
**Prompt for Claude Code:**
Write a Solidity contract (`contracts/Leaderboard.sol`). It stores scores as structs: `{ address player, uint256 score, uint256 timestamp, uint8 difficultyMode }`. Four difficulty modes (0=Easy, 1=Medium, 2=Hard, 3=Realtime). Only owner can call `submitScore(address player, uint256 score, uint8 mode)`. Contract maintains a top-100 list per difficulty mode — if new score is in the top 100, it replaces the lowest entry. Emits `NewHighScore(address indexed player, uint256 score, uint8 mode)` when a new entry makes the top 100. Exposes `getTopScores(uint8 mode) returns (ScoreEntry[100])`. Write Hardhat tests covering: submit score, top-100 displacement logic, event emission, non-owner rejection.

**Definition of Done:**
- `npx hardhat compile` — no errors
- `npx hardhat test` — all tests pass
- `getTopScores` returns entries sorted by score descending
- Gas estimate for `submitScore` is under 200k gas
- Top-100 displacement logic tested: when 101st score submitted that beats the lowest, lowest is removed

---

## Phase 3 — Backend API

### Task 3.1 — Session Token API
**Prompt for Claude Code:**
Create a Vercel edge function at `app/api/session/route.ts`. `POST /api/session` accepts `{ walletAddress: string }` in the body. It generates a cryptographically signed session token using `SESSION_SECRET` (HMAC-SHA256) that encodes: `{ walletAddress, issuedAt, sessionId: uuid, used: false }`. Returns `{ token: string }`. Sessions expire after 10 minutes. Store issued session IDs server-side using Vercel KV (or a simple in-memory Map for local dev with a comment noting production needs persistent storage). `POST /api/session/validate` accepts `{ token, score, difficultyMode }` — verifies signature, checks not expired, checks not already used, validates score is within plausible range for the given difficulty mode and session duration. Returns `{ valid: boolean, reason?: string }`.

**Definition of Done:**
- `POST /api/session` returns a token string
- Token is not decodeable without `SESSION_SECRET`
- `POST /api/session/validate` returns `valid: true` for a fresh valid token with a plausible score
- Returns `valid: false` with reason for: expired token, already-used token, impossible score (e.g. score > max_blocks_per_second × time × 100 points)
- A token cannot be validated twice (single-use enforced)
- Unit tests for the validation logic covering all rejection cases

---

### Task 3.2 — Mint API
**Prompt for Claude Code:**
Create `app/api/mint/route.ts`. `POST /api/mint` accepts `{ token: string, score: number, walletAddress: string, difficultyMode: number }`. Flow: (1) call the session validate logic — if invalid, return 400 with reason. (2) Mark session as used. (3) Using `BACKEND_WALLET_PRIVATE_KEY`, call `mint(walletAddress, score)` on the `BLOK_CONTRACT_ADDRESS` contract via `ethers.js` connected to `MEGAETH_RPC_URL`. (4) Call `submitScore` on the leaderboard contract. (5) Return `{ txHash: string, leaderboardTxHash: string }`. Handle RPC errors gracefully — return 500 with a human-readable message. Log all mint attempts (wallet, score, txHash) for audit.

**Definition of Done:**
- Valid session + score results in a real on-chain mint transaction (testable on MegaETH testnet first)
- `txHash` returned is a valid transaction hash (64 hex chars prefixed with `0x`)
- Re-submitting the same token returns 400 (single-use enforcement working end-to-end)
- An impossibly high score returns 400 before any chain interaction
- Mint and leaderboard update both succeed or the error is reported clearly (no silent failures)

---

### Task 3.3 — Twitter Following Fetch API
**Prompt for Claude Code:**
Create `app/api/twitter/following/route.ts`. `GET /api/twitter/following?userId=<twitter_user_id>` fetches the user's following list using X API v2 with `TWITTER_BEARER_TOKEN`. Request fields: `id,name,username,profile_image_url,public_metrics`. Sort the list by `public_metrics.followers_count` descending. Return the top 50. Map each to `{ twitterId, username, displayName, profileImageUrl }`. Cache the result per userId for 5 minutes (use Vercel edge cache headers). Handle X API rate limits — return 429 with a `Retry-After` header if hit.

**Definition of Done:**
- Returns an array of exactly ≤50 objects sorted by follower count descending
- Profile image URLs point to `pbs.twimg.com` (Twitter CDN, not proxied)
- Response includes `Cache-Control: max-age=300` header
- Returns an empty array (not an error) if the user follows nobody
- Rate limit response is handled — 429 is returned to the client with a retry suggestion
- Works with a real Twitter bearer token in a `.env.local` test

---

## Phase 4 — Auth & Wallet (Privy)

### Task 4.1 — Privy Provider Setup
**Prompt for Claude Code:**
Install and configure Privy in the Next.js app. Create `components/providers/PrivyProvider.tsx` wrapping children with `<PrivyProvider appId={config.privyAppId}>`. Configure it to: support X/Twitter OAuth as the only login method, enable embedded wallets (created automatically on login, user never shown seed phrase), set the appearance theme to dark matching Night Sky `#19191A`. Wrap the root layout in this provider. Create a `hooks/useAuth.ts` hook that exposes: `{ isAuthenticated, user, walletAddress, login, logout, isLoading }`.

**Definition of Done:**
- App compiles with Privy provider wrapping layout
- `useAuth` hook returns all six fields with correct TypeScript types
- Calling `login()` triggers the Privy X OAuth modal
- After successful OAuth, `isAuthenticated` is `true` and `walletAddress` is a non-null string
- After `logout()`, `isAuthenticated` is `false` and `walletAddress` is `null`
- No console errors in browser during auth flow

---

## Phase 5 — Game Engine

### Task 5.1 — Phaser.js Integration with Next.js
**Prompt for Claude Code:**
Install Phaser 3. Create a `components/game/GameCanvas.tsx` React component that dynamically imports Phaser (no SSR — `ssr: false`), mounts a Phaser game instance into a `div` ref on mount, and destroys it on unmount. The game config should use Canvas renderer, match the parent div's width/height, and have a black background (`#19191A`). Create a `game/scenes/` directory for Phaser scenes. Add a placeholder `BootScene` that just shows the text "Phaser Ready" in white. The React component should accept a `sceneKey` prop to determine which scene to launch.

**Definition of Done:**
- `<GameCanvas />` renders without SSR errors
- Phaser canvas mounts correctly inside the component div
- "Phaser Ready" text visible on screen from BootScene
- Destroying the component (unmounting) calls `game.destroy(true)` — no memory leaks (verify with Chrome memory profiler: no Phaser event listeners remaining after unmount)
- Canvas resizes correctly when the browser window is resized (add a resize handler)

---

### Task 5.2 — Block Rendering System
**Prompt for Claude Code:**
In Phaser, create a `Block` class (`game/objects/Block.ts`). Each block is rendered as a 3D-styled cube using Phaser Graphics: a front face, a top face, and a right side face using slightly lighter/darker variants of the block's accent colour. Pick the accent colour from a seeded random selection of the MegaETH palette: `#F5AF94`, `#F5949D`, `#FF8AA8`, `#F786C6`, `#90D79F`, `#6DD0A9`, `#7EAAD4`, `#70BAD2`. Add a subtle glow effect using Phaser's `setBlendMode` or a glow pipeline. Each block displays its block number on its face using Wudoo Mono (load as a bitmap font or web font in Phaser). Blocks have a `blockNumber: number`, `speed: number`, `isRare: boolean` property. Rare blocks have a gold (`#FFD700`) outline and are 1.2x the size of regular blocks.

**Definition of Done:**
- A block renders as a visible 3D-styled cube (3 visible faces with colour variation) not a flat square
- Block number text is legible on the block face in Wudoo Mono
- Colour is randomly picked from the 8-colour palette
- Rare blocks visually distinct: gold outline, slightly larger
- Blocks can be instantiated with different `speed` values and descend at those speeds
- No rendering errors in Phaser console

---

### Task 5.3 — Core Game Scene (Descend & Stack)
**Prompt for Claude Code:**
Create `game/scenes/GameScene.ts`. It accepts config: `{ difficultyMode: 0|1|2|3, blockRate: number }`. Blocks spawn at the top of the screen at the given `blockRate` (blocks per second), at random X positions, and descend downward at a speed proportional to difficulty. When a block reaches the bottom, it stacks. Maintain a stack array — stacked blocks don't move, they sit in rows at the bottom. If any column in the stack reaches the top of the screen, emit a `GAME_OVER` event. Show a danger indicator on the left side: green when stack height < 33%, yellow when 33–66%, red when > 66%. Show the live score (Wudoo Mono, top-right). Show a countdown timer (top-left). Timer durations: Easy=90s, Medium=60s, Hard=45s, Realtime=30s. When timer hits 0, emit `GAME_WIN`. The scene should emit events that React can listen to for score updates and game end.

**Definition of Done:**
- Blocks spawn at the correct rate for each difficulty mode
- Stacking works: missed blocks pile up visually at the bottom from left to right, then next row
- Game over fires when stack reaches the top (tested by setting blockRate very high)
- Timer counts down accurately (± 100ms tolerance)
- Game win fires when timer hits 0 with stack not full
- Danger indicator visibly changes colour at correct thresholds
- Score display updates in real time

---

### Task 5.4 — Shooting Mechanic & Hit Detection
**Prompt for Claude Code:**
In `GameScene`, add shooting mechanic. Desktop: clicking the canvas fires a "shot" at the clicked coordinate. Mobile: tapping a block fires a shot at that block. A shot is a small projectile (use a bright dot or a small line) that travels from the bottom-center of the screen toward the click/tap point at high speed. Hit detection: a block is hit if the shot's position overlaps within a forgiving radius of the block's center. Radius: 40px on Easy/Medium, 30px on Hard/Realtime. On hit: block is destroyed with a small particle burst (use Phaser ParticleEmitter — simple 6-particle burst in the block's colour). Score increases by 10 (or 100 for rare blocks). Combo tracking: hits within 1 second of each other increment a combo counter. 5-combo = 2x multiplier. 10-combo = 3x multiplier. Any miss resets combo. Display combo multiplier near the score.

**Definition of Done:**
- Clicking/tapping fires a visible projectile from bottom-center
- Blocks are destroyed on hit with particle effect
- Hit radius is forgiving (can click slightly off-center and still register a hit)
- Miss (clicking empty space or off a block) does NOT destroy any block
- Combo counter increments correctly and resets on miss
- Score multiplier applies correctly (2x at 5-combo, 3x at 10-combo)
- Rare blocks require 2 hits before destruction
- Combo clear: 5 consecutive hits clear the bottom row of the stack with a flash effect (screen brief white flash, row disappears)

---

### Task 5.5 — Block Avatar Texture (Signed-in Users)
**Prompt for Claude Code:**
Extend the `Block` class to optionally render a circular avatar image on the block face (for signed-in users). Accept an optional `avatarUrl: string` prop. Load the image using Phaser's texture loader (`this.load.image(key, url)`) where key is the Twitter user ID. Render the avatar as a circular crop on the front face of the block using a Phaser RenderTexture with a circular mask. For guest users (no avatar), show the standard colour block with block number only. Preload all avatar images during the loading screen — not lazily during gameplay.

**Definition of Done:**
- Signed-in user sees Twitter profile pictures on block faces
- Avatars are circular (masked), not square
- All avatars preloaded before game starts (no pop-in mid-game)
- Guest user sees standard colour blocks — no broken image placeholders
- If an avatar URL fails to load, block gracefully falls back to colour-only rendering

---

## Phase 6 — UI Screens

### Task 6.1 — Home / Landing Screen
**Prompt for Claude Code:**
Create `app/page.tsx` as the home screen. Layout: centered, full viewport height, dark background. Display "BLOCK BLASTER" in large Helvetica Neue bold, white. Tagline: *"The chain never stops. Can you keep up?"* in a smaller weight. Two CTA buttons: "Play as Guest" (navigates to `/difficulty`) and "Sign in with X" (triggers Privy login, then navigates to `/difficulty` on success). Below the buttons: a live block number ticker showing the current MegaETH block height, updating every second (fetch from MegaETH RPC using `eth_blockNumber`). Footer: "Powered by MegaETH" in small text. Use MegaETH accent colours for button hover states.

**Definition of Done:**
- Page renders correctly on mobile (375px) and desktop (1280px)
- "Sign in with X" triggers Privy OAuth modal
- After successful login, user is redirected to `/difficulty`
- "Play as Guest" goes to `/difficulty` without login
- Live block number ticks upward every 1 second (confirm by watching for 5 seconds)
- Block number renders in Wudoo Mono font
- No layout shift on load (fonts preloaded or fallback specified)

---

### Task 6.2 — Difficulty Select Screen
**Prompt for Claude Code:**
Create `app/difficulty/page.tsx`. Show four difficulty cards in a grid (2×2 on desktop, 1-column on mobile). Each card: mode name (Easy/Medium/Hard/Real-time), blocks per second, short description from PRD. Cards use MegaETH accent colours — use a different accent per card. Selecting a card navigates to `/game?mode=<0|1|2|3>`. Live MegaETH block number ticker in the corner (reuse the component from Task 6.1). If user is authenticated, show their X handle in the top-right corner.

**Definition of Done:**
- Four difficulty cards render correctly
- Each card has a visually distinct accent colour
- Clicking a card navigates to `/game` with the correct `mode` query param
- Block number ticker is live and updating
- Authenticated user's handle displays correctly (e.g., "@tonygraz")
- Cards have hover/press states

---

### Task 6.3 — Loading Screen
**Prompt for Claude Code:**
Create a loading screen component shown when navigating to `/game`. It displays: "Loading the chain..." with blocks appearing one by one (animate 5 block icons appearing sequentially using CSS keyframes or Framer Motion). Show current MegaETH TPS and block height as flavour text (fetch once on mount). Preload all game assets (Phaser textures, avatar images for signed-in users) during this screen. When all assets are ready and a minimum 2-second display time has passed, auto-navigate into the full game view.

**Definition of Done:**
- Loading screen shows for at least 2 seconds
- Block icons animate in sequentially (not all at once)
- MegaETH block height and TPS values display (static on load is fine — no need to tick during loading)
- Game does not start until assets are confirmed preloaded
- No broken image or font errors after loading completes

---

### Task 6.4 — Game Over Screens
**Prompt for Claude Code:**
Create two game-over states rendered as overlays on top of the game canvas (not a new page). **Survived state** (triggered by `GAME_WIN` event or manual bank): show score with a count-up animation, "Commit to chain" primary button (calls the mint API), transaction hash with a link to `https://mega.etherscan.io/tx/<hash>` once minting completes, "Share on X" button (pre-fills tweet with score and game link), "Play again" secondary button. **Died state** (triggered by `GAME_OVER` event): show "Chain buried you." in large text, show score (greyed out — not minted), "Try again" button, "Share on X" button.

**Definition of Done:**
- Survived overlay appears immediately on `GAME_WIN` with score animation (count-up over 1 second)
- "Commit to chain" calls `POST /api/mint` and shows a loading spinner during the request
- Transaction hash appears as a clickable link to the MegaETH explorer after successful mint
- Died overlay appears immediately on `GAME_OVER` with "Chain buried you." message
- "Share on X" opens Twitter intent URL in a new tab with pre-filled text
- "Play again" / "Try again" resets game state and returns to Difficulty Select

---

### Task 6.5 — Leaderboard Screen
**Prompt for Claude Code:**
Create `app/leaderboard/page.tsx`. Fetch top-20 scores from the leaderboard contract (read via `ethers.js` on the client, or via a `/api/leaderboard?mode=<0|1|2|3>` server route). Display as a table: rank, X handle or truncated wallet address (`0x1234...5678`), score in Wudoo Mono, difficulty badge, date. Four tabs for filtering by difficulty. If the user is authenticated and has a score on the board, highlight their row. Show a loading skeleton while fetching. Leaderboard is accessible from the home screen via a "Leaderboard" nav link.

**Definition of Done:**
- Leaderboard renders top-20 for each difficulty tab
- Scores are sorted correctly (highest first)
- Wallet addresses are truncated: first 6 + last 4 chars
- Authenticated user's row is visually highlighted (different background or accent colour)
- Loading skeleton shows during fetch (no blank flash)
- Difficulty tab switching fetches the correct data

---

### Task 6.6 — Wallet Balance Screen
**Prompt for Claude Code:**
Create a simple wallet view accessible from a nav menu icon. Display the user's $BLOK token balance (fetched from the $BLOK contract using `balanceOf`). Show wallet address (truncated). Show a "What is $BLOK?" tooltip/explainer. If the user is not authenticated, show a prompt to sign in. This can be a modal or a `/wallet` page — use a modal for simplicity.

**Definition of Done:**
- $BLOK balance fetches correctly from contract and displays as a whole number (decimals: 0)
- Balance updates after a successful mint without requiring page refresh (poll every 30 seconds or listen to Transfer event)
- Unauthenticated users see a sign-in prompt, not an empty balance
- Truncated wallet address matches Privy's embedded wallet address

---

## Phase 7 — MegaETH Live Data

### Task 7.1 — MegaETH RPC Hook
**Prompt for Claude Code:**
Create `hooks/useMegaEth.ts`. This hook connects to MegaETH RPC (`MEGAETH_RPC_URL`) using `ethers.js` and exposes: `{ blockNumber: number, tps: number }`. `blockNumber` updates every 1 second by polling `eth_blockNumber`. `tps` is calculated by tracking how many blocks were produced over the last 5 seconds (blockCount / 5). The hook should clean up the polling interval on unmount. Handle RPC errors gracefully — if the RPC is unreachable, log a warning and retry on the next interval (don't crash).

**Definition of Done:**
- `blockNumber` increments in real time (visible change every ~10ms on MegaETH)
- `tps` is a reasonable number close to 100 on mainnet
- Unmounting the component with this hook stops the polling (verify via console.log in cleanup)
- RPC failure doesn't crash the app — shows last known value until recovery
- Hook is used successfully in at least two components (Home screen ticker + Loading screen)

---

## Phase 8 — PWA & Polish

### Task 8.1 — PWA Manifest & Icons
**Prompt for Claude Code:**
Create the full PWA manifest at `public/manifest.json` with: name "Block Blaster", short_name "BlockBlaster", theme_color "#19191A", background_color "#19191A", display "fullscreen", start_url "/". Generate app icons at sizes 192×192 and 512×512 using a programmatic canvas script (`scripts/generateIcons.ts`) — a simple block design using Night Sky background with the letter "B" in a MegaETH accent colour. Save as `public/icons/icon-192.png` and `public/icons/icon-512.png`. Reference them in `manifest.json`. Add iOS-specific meta tags in the root layout for apple-touch-icon and apple-mobile-web-app-capable.

**Definition of Done:**
- Chrome DevTools > Application > Manifest shows no errors
- App is installable on Chrome (install prompt appears or "Add to Home Screen" works)
- iOS "Add to Home Screen" uses the correct icon (not a screenshot)
- Fullscreen mode hides browser chrome on both iOS and Android after install
- Lighthouse PWA audit score ≥ 90

---

### Task 8.2 — Offline Fallback
**Prompt for Claude Code:**
Configure the Next.js PWA service worker to show a custom offline page (`app/offline/page.tsx`) when the user is not connected to the internet. The offline page should display: "You need to be online to play Block Blaster." in the game's visual style (dark background, MegaETH colours). The service worker should cache static assets (fonts, icons, manifest) so the offline page itself renders correctly without a network connection.

**Definition of Done:**
- Disabling network in Chrome DevTools and navigating to the app shows the offline page (not a browser error)
- Offline page uses correct fonts and colours (cached assets working)
- Re-enabling network and refreshing returns to the normal app
- No service worker console errors in production build

---

## Phase 9 — Testing & Launch Readiness

### Task 9.1 — End-to-End Flow Test
**Prompt for Claude Code:**
Write a Playwright E2E test (`e2e/game-flow.spec.ts`) covering the full happy path: (1) load home screen, (2) click "Play as Guest", (3) select Easy difficulty, (4) wait for loading screen to complete, (5) verify Phaser canvas is mounted, (6) simulate 5 clicks on the canvas (approximating shooting), (7) wait for game win (patch the timer to 3 seconds for testing), (8) verify the game-over survived overlay appears. Also write a test for the died state: mock a full stack by directly triggering the `GAME_OVER` event, verify "Chain buried you." overlay appears.

**Definition of Done:**
- Both E2E tests pass on `npx playwright test`
- Tests run headlessly in CI (no display server required)
- No flaky failures on 5 consecutive runs
- Test file is documented with comments explaining each step

---

### Task 9.2 — Contract Deployment & Verification
**Prompt for Claude Code:**
Write a deployment checklist script (`scripts/prelaunch-check.ts`) that: (1) checks both contracts are deployed (call `symbol()` on $BLOK and `getTopScores(0)` on Leaderboard), (2) verifies the backend wallet is the owner of both contracts, (3) performs a test mint of 1 $BLOK to a test address and confirms the balance changed, (4) submits a test score to the leaderboard and confirms it's retrievable, (5) marks all checks as PASS/FAIL with clear output. Run this script against MegaETH mainnet before announcing launch.

**Definition of Done:**
- Script runs with `npx ts-node scripts/prelaunch-check.ts` 
- All 5 checks complete and report PASS on a correctly deployed system
- If any check fails, the script exits with code 1 and a clear error message
- Script cleans up after itself (no test scores left on mainnet leaderboard — add a remove function or use a test address that won't appear in top 100)

---

## Dependency Order (Build Sequence)

```
Phase 1 (Scaffold) 
  → Phase 2 (Contracts) + Phase 4 (Auth) [parallel]
    → Phase 3 (Backend API) [needs contracts + auth]
      → Phase 5 (Game Engine) + Phase 6 (UI Screens) [parallel, needs API]
        → Phase 7 (Live Data) [can start with Phase 5]
          → Phase 8 (PWA Polish)
            → Phase 9 (Testing & Launch)
```

---

*AppMog | Block Blaster v1.0 Task Breakdown*
