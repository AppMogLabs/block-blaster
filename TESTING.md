# Testing Block Blaster — Beta Guide

Thanks for helping us test. This doc explains what to expect and where to report things.

## TL;DR

1. Go to **[block-blaster.app](https://block-blaster.app)**
2. Click **Sign in with X** (or Email / Google) in the top-right
3. A banner at the top will prompt **"Allow Block Blaster to spend $BLOK"** — click **Approve**. Privy pops a confirmation; it uses a tiny amount of testnet ETH we gift to every new account.
4. Click **Play**, pick a difficulty, blast blocks.
5. Press **Bank** during a run to mint your current score as `$BLOK` to your wallet.

You're playing a real onchain game on **MegaETH testnet**. The `$BLOK` you earn has no monetary value — it's test tokens — but every action (bank / nuke / wager / reload) is a real onchain transaction.

## Core gameplay

Blocks fall from the top. Click/tap to shoot them. If a column fills to the top, you die.

- **Streak**: consecutive hits. Multipliers kick in at 5 (×2), 10 (×3).
- **Bank**: commit your current "pending" points to `$BLOK` in your wallet. Game continues, streak resets. You can bank multiple times per run.
- **Die**: pending points are lost. Already-banked `$BLOK` stays in your wallet.
- **Timer**: runs for 30–90 seconds depending on difficulty.

## Mechanics

| Thing | Cost | How to trigger |
|---|---|---|
| Bank | free | Click the green **BANK** button during a run |
| Nuke (wipe all blocks) | **100 $BLOK** | Gold button top-right. Unlocks at **25 kills + 100 $BLOK balance** |
| Sweep beam | free | Hold and drag on Medium/Hard/Real-time (not Easy). 3s fuel bar |
| Sweep reload | **25 $BLOK** | Top-left button during a run |
| Self-wager | **50 / 100 / 200 / 500 $BLOK** | Shown on difficulty screen **after** your first run on a mode. Beat your PB = 2× payout. Miss or die = wager burns. |

## What to check

- **Sign-in flow**: can you sign in with X, Email, and Google? Any stuck states?
- **Approve**: does the banner appear on your first visit? Does clicking Approve open the Privy popup and land the transaction?
- **Gameplay**: does the game run smoothly on your device? Any freezes, black screens, or missing visuals?
- **Banking**: when you click Bank, does the `$BLOK` chip in the top-right go up? Does the toast say "+N $BLOK minted" with a clickable `tx 0x…` link that opens the explorer?
- **Mobile**: PWA install (Add to Home Screen), touch controls, sweep gesture, portrait vs landscape.
- **Wager**: play a mode once to set a PB, then return to difficulty and wager on it. Did the overlay appear? Did the tokens lock?
- **Recovery flows**: if you see a "wager locked" banner when you didn't expect one, click **Forfeit** or **Resume** — do they clear the state?

## Known weirdness

- **First sign-in can take 5–10s** as Privy creates your embedded wallet and we drip you testnet ETH for gas. Wait it out.
- **Service worker caching**: If the site feels broken after a deploy, hard-refresh (Cmd+Shift+R or Ctrl+Shift+R) or clear site data in DevTools → Application → Storage. We ship updates often.
- **Balance lag (<1s)**: immediately after a bank or nuke, the on-chain balance can be slightly behind the UI for ~1 second while the tx confirms. UI is optimistic; it auto-reconciles with chain.
- **One active wager per wallet**: if you wager on Medium and abandon the run, the wager is "locked". Click **Forfeit** on the difficulty page banner to clear it (or play through and die to burn it).
- **Nuke visual pulses grey when you have the streak but not the balance**: that's "earned but can't afford" — bank more before your next attempt.

## Your wallet

- Your wallet address is visible in every page header as `0x1234…abcd`. Click it to view your balance, transaction history, and allowances on the MegaETH explorer.
- Scroll to the bottom of the home page (signed in) to find the **Export wallet key** link. Your wallet is self-custodial — the key is yours.
- We gift ~0.001 testnet ETH to every new wallet for gas. This is enough for hundreds of transactions.

## Reporting bugs

- **Error message?** Copy the full text. Screenshots help.
- **Unexpected behavior?** Describe: what you did, what happened, what you expected. Bonus points for browser + mobile/desktop.
- **Stuck state?** Note the last thing you clicked before the stuck happened.

Best way to report: **[replace with your preferred channel — Discord link / X DM / Google form URL]**

## Don't

- Treat `$BLOK` as real money — it's testnet.
- Export your key and post it anywhere. It's yours, but sharing it means anyone can spend your testnet balance.
- Worry about gas — we cover it. If you see "insufficient funds" when approving, tell us.

Thanks for testing. 🎮
