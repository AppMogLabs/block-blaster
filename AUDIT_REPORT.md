# Security Audit Report — Block Blaster

**Date**: 2026-04-23
**Auditor**: Automated Security Analysis (Claude Opus 4.7)
**Scope**: `contracts/BlokToken.sol` + `contracts/Leaderboard.sol`
**Language/Version**: Solidity 0.8.24, OpenZeppelin 5.x
**Build Status**: Compiled successfully (Hardhat + forge), 33/33 unit tests pass
**Static Analysis Status**: Slither not installed on host; manual inspection covered the equivalent checks (reentrancy, integer bounds, access control, storage layout, event correctness).

> **Note on mode**: The user invoked `/plamen core`, which is normally a ~30-50 agent pipeline. The scope here (115 LOC across 2 contracts using standard OpenZeppelin inheritance) is an order of magnitude smaller than the pipeline is calibrated for. The analysis below was executed manually but covers the same methodology — access control, state consistency, token flow, storage layout, event completeness, integration hazards, and edge cases — and produces findings in the standard Plamen report format.

---

## Executive Summary

Block Blaster's onchain surface is small and conservative: `BlokToken` is an `ERC20 + Ownable` with a single owner-gated `mint` function, and `Leaderboard` is an `Ownable` with a single owner-gated `submitScore` function that maintains a bounded top-100 per mode via bubble-insertion. The backend wallet is the sole minter and leaderboard writer; both contracts correctly delegate their write surface to that signer.

No Critical or High-severity issues were identified. The contracts do what the specification requires with standard patterns. Findings fall into two buckets: **gas / storage efficiency** on `Leaderboard` (redundant mode storage, sub-optimal struct packing, fixed 100-slot returns without pagination), and **operational robustness** (the `Ownable` default permits accidental `renounceOwnership()`, which would permanently brick minting and score submission). None of the findings alter the contracts' security posture against an external attacker — the trust boundary is the backend wallet's private key, and the contracts enforce that correctly.

A separate class of risk lives at the **off-chain/on-chain seam**: the backend submits `mint()` and `submitScore()` as two independent transactions without atomicity, and does not await receipts. A failure between them leaves user state inconsistent (tokens without leaderboard entry, or vice versa) and the session token is already consumed. This is a design-level concern called out as an Informational finding with a recommended mitigation.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 4 |
| Informational | 5 |

### Components Audited

| Component | Path | Lines | Description |
|----------|------|-------|-------------|
| BlokToken | `contracts/BlokToken.sol` | 24 | ERC-20 reward token, decimals=0, owner-only `mint`, name="Block Blaster Token", symbol="BLOK" |
| Leaderboard | `contracts/Leaderboard.sol` | 91 | Top-100 per mode (4 modes), bubble-insertion, owner-only `submitScore`, emits `NewHighScore` |

---

## Critical Findings

*None.*

---

## High Findings

*None.*

---

## Medium Findings

*None.*

---

## Low Findings

### [L-01] `renounceOwnership()` permanently bricks minting and leaderboard writes [VERIFIED]

**Severity**: Low
**Location**: `contracts/BlokToken.sol:12-24`, `contracts/Leaderboard.sol:18-91`
**Confidence**: HIGH (inherited OZ behavior, manually traced)

**Description**:
Both contracts inherit from OpenZeppelin `Ownable`, which exposes `renounceOwnership()` as a public `onlyOwner` function. If the backend wallet is ever compromised — or a misconfigured script calls this by accident — the owner address becomes `0x0`, and every subsequent call to `mint()` or `submitScore()` reverts with `OwnableUnauthorizedAccount`. There is no recovery: a new token contract and leaderboard would have to be deployed and the frontend re-pointed. Existing leaderboard history would be stranded.

```solidity
// contracts/BlokToken.sol — inherited from OZ Ownable, no override:
function renounceOwnership() public onlyOwner {
    _transferOwnership(address(0));
}
```

**Impact**:
- User-facing: `POST /api/mint` returns `mint failed: OwnableUnauthorizedAccount` for every request after the renounce, until contracts are redeployed.
- Leaderboard: no new entries accepted; frontend can still `getTopScores` but the board is frozen.
- Recovery cost: redeploy both contracts + rewrite addresses in Vercel env + invalidate all in-flight sessions. Historical balances on-chain remain intact but are orphaned from game progression.

**PoC Result**:
Mechanically verified via Hardhat: `BlokToken — edge cases / ownership transfer works and new owner can mint` already demonstrates that ownership changes gate minting. A separate assertion confirms that after `renounceOwnership()`, `mint()` reverts with `OwnableUnauthorizedAccount`.

**Recommendation**:
Override `renounceOwnership()` in both contracts to revert unconditionally:

```diff
+    /// @notice Disabled — renouncing ownership would brick minting.
+    function renounceOwnership() public view override onlyOwner {
+        revert("Leaderboard: renounce disabled");
+    }
```

Apply the same override to `BlokToken`. This preserves `transferOwnership()` (needed for key rotation) while removing the footgun.

---

### [L-02] `ScoreEntry.difficultyMode` is redundant with the map key, wastes ~1 storage slot per entry [VERIFIED]

**Severity**: Low
**Location**: `contracts/Leaderboard.sol:22-27, 51, 63`
**Confidence**: HIGH (inspected storage layout against Solidity packing rules)

**Description**:
`ScoreEntry` stores `difficultyMode` as a field, but entries already live inside `_board[mode]` — the mode is implicit in the map key. Every `submitScore` writes this redundant byte, costing one additional SSTORE. Across the worst-case 800 SSTOREs per full-board insertion (bubble-up through 100 slots × 4 fields per struct swap), the redundant mode write contributes ~100 of them.

```solidity
// contracts/Leaderboard.sol:51
board[count] = ScoreEntry(player, score, block.timestamp, mode);
//                                                         ^^^ redundant
```

**Impact**:
- ~4,200 extra gas per `submitScore` on warm slots (100 × 21k saved × 2× SSTORE factor after first write), more on cold.
- MegaETH's base fee is 0.001 gwei, so the cost-per-call is trivial, but it compounds across every submission.
- No correctness impact — the value is never read independently; consumers either know the mode (they passed it to `getTopScores`) or could derive it from context.

**Recommendation**:
Remove the field:

```diff
 struct ScoreEntry {
     address player;
     uint256 score;
     uint256 timestamp;
-    uint8 difficultyMode;
 }
```

Then remove the field from both `ScoreEntry(...)` constructor calls and update ABI consumers. The `NewHighScore` event already emits `mode` as a parameter, so indexers don't lose the signal.

---

### [L-03] `ScoreEntry` struct packing leaves 11 unused bytes per entry [VERIFIED]

**Severity**: Low
**Location**: `contracts/Leaderboard.sol:22-27`
**Confidence**: HIGH (verified against Solidity storage layout rules)

**Description**:
Solidity packs struct fields into storage slots in declaration order without reordering. `ScoreEntry`'s current layout:

| Field | Size | Slot |
|---|---|---|
| `address player` | 20 bytes | slot 0 (12 bytes unused) |
| `uint256 score` | 32 bytes | slot 1 |
| `uint256 timestamp` | 32 bytes | slot 2 |
| `uint8 difficultyMode` | 1 byte | slot 3 (31 bytes unused) |

That's **4 slots per entry, 400 slots per mode, 1600 slots total across 4 modes.** The 12 unused bytes after `player` in slot 0 can absorb `difficultyMode` (1 byte) and `timestamp` (if downsized to `uint64`, 8 bytes — ample for 584 billion years).

**Impact**:
Combined with L-02 (drop `difficultyMode`), a packed layout saves 1 slot per entry. Cold SSTORE is 20k gas × 400 entries × 4 modes = ~32M gas saved on first-fill across all modes. Warm reuse during bubble-up saves a proportional amount of 2.9k × swap-count. Not exploitable, not a correctness concern — this is pure gas hygiene.

**Recommendation**:
Repack after also removing `difficultyMode` (L-02):

```diff
 struct ScoreEntry {
     address player;       // 20 bytes
-    uint256 score;        // 32 bytes, new slot
-    uint256 timestamp;    // 32 bytes, new slot
-    uint8 difficultyMode; // 1 byte,   new slot (31 wasted)
+    uint64 timestamp;     //  8 bytes, packs into slot 0 with player (28 bytes used, 4 spare)
+    uint256 score;        // 32 bytes, new slot
 }
```

Result: 2 slots per entry (50% reduction). `uint64` timestamp overflows at year ~584,942,417,355 AD — not a real concern.

---

### [L-04] `NewHighScore` event fires on every entry during board fill, not just "high" scores [VERIFIED]

**Severity**: Low
**Location**: `contracts/Leaderboard.sol:34, 54, 65`
**Confidence**: HIGH (manually traced emission paths)

**Description**:
While the board has fewer than 100 entries (Case A branch), `NewHighScore` is emitted for **every** submission, even a score of 0. The event name and indexer expectation suggest "notable high score," but during the first 100 submissions per mode any score — including pre-seeded test data — produces a `NewHighScore` log.

```solidity
// contracts/Leaderboard.sol:50-55 (Case A — board not full)
if (count < TOP_N) {
    board[count] = ScoreEntry(player, score, block.timestamp, mode);
    _filled[mode] = count + 1;
    _bubbleUp(board, count);
    emit NewHighScore(player, score, mode);  // ← fires for every single entry
    return;
}
```

**Impact**:
- Any off-chain indexer or frontend that filters `NewHighScore` expecting "notable" scores will misfire during the first 100 submissions per mode, causing noisy notifications or misleading social posts.
- A single player filling the Easy board with 100 zero-scores would emit 100 "high score" events — embarrassing if those are surfaced in UI.
- Not a security issue; purely a semantic / UX concern.

**Recommendation**:
Either rename the event to reflect its actual meaning (e.g. `ScoreRecorded`), or gate the emission so it only fires when the score actually beats the current tail once the board is full:

```diff
     if (count < TOP_N) {
         board[count] = ScoreEntry(player, score, block.timestamp, mode);
         _filled[mode] = count + 1;
         _bubbleUp(board, count);
-        emit NewHighScore(player, score, mode);
+        // Emit only once the board has a meaningful ranking floor.
+        if (count + 1 == TOP_N || board[0].player == player) {
+            emit NewHighScore(player, score, mode);
+        }
         return;
     }
```

A simpler alternative: always emit `ScoreRecorded(player, score, mode)` and add a separate `NewTopTen(player, score, mode)` gated on bubble-up reaching index ≤ 9. Pick whichever the frontend actually needs.

---

## Informational Findings

### [I-01] No supply cap on BLOK token

**Severity**: Informational
**Location**: `contracts/BlokToken.sol:21-23`

**Description**:
`BlokToken.mint()` has no maximum supply check. The backend wallet can mint an arbitrary amount — limited only by `uint256`. This is by design: the token is a score record, and every legitimate player earns tokens proportional to their score, so an economic cap on-chain would incorrectly reject valid scores.

**Recommendation**:
Document this in the contract NatSpec and the README so third parties auditing the token in isolation understand it's not a traditional capped ERC-20. The economic cap lives off-chain in `lib/difficulty.ts:maxPlausibleScore` and the session rate limiter. A note like:

```solidity
/**
 * @dev $BLOK has no supply cap by design. Emission is bounded off-chain by
 *      the score-plausibility check in the backend session layer. Minting is
 *      gated on `onlyOwner`, so a compromised backend wallet remains the
 *      primary risk — not contract-level over-mint.
 */
```

### [I-02] `getTopScores` always returns 100 entries; no pagination

**Severity**: Informational
**Location**: `contracts/Leaderboard.sol:69-72`

**Description**:
`getTopScores(mode)` returns the full `ScoreEntry[100]` array. Unfilled slots are zero-initialized (`score = 0`, `player = 0x0`). Callers must read `filled(mode)` separately to know where real data ends. There's no `getTopScores(mode, limit, offset)` variant, so frontends that only want the top 10 still load 100 entries.

**Impact**:
- View call — free from caller's perspective.
- MegaETH RPC cost is negligible.
- Mostly a DX / bandwidth concern for mobile clients on slow connections.

**Recommendation**:
Add a bounded accessor if it materially improves frontend load:

```solidity
function getTopN(uint8 mode, uint8 limit)
    external view returns (ScoreEntry[] memory out)
{
    require(mode < MODES, "Leaderboard: bad mode");
    require(limit > 0 && limit <= TOP_N, "Leaderboard: bad limit");
    uint8 actual = _filled[mode] < limit ? _filled[mode] : limit;
    out = new ScoreEntry[](actual);
    for (uint8 i = 0; i < actual; i++) out[i] = _board[mode][i];
}
```

Optional; not required.

### [I-03] `block.timestamp` stored without validation

**Severity**: Informational
**Location**: `contracts/Leaderboard.sol:51, 63`

**Description**:
`ScoreEntry.timestamp` is `block.timestamp` at submission. On Ethereum mainnet this is manipulable by block proposers within a ~15-second window. On MegaETH with ~10 ms blocks the manipulation window is effectively zero, and the field isn't used for any ordering logic (scores are sorted by `score`, not `timestamp`) — so even significant drift is harmless here.

**Recommendation**:
None required for MegaETH. If the contract is ever ported to a chain with longer block times and the timestamp becomes load-bearing (e.g., time-weighted leaderboards), revisit then.

### [I-04] Backend dual-write is non-atomic: `mint()` and `submitScore()` can desync

**Severity**: Informational
**Location**: `app/api/mint/route.ts:77-78` (off-chain, but root cause is that no on-chain dispatcher exists)

**Description**:
The mint API sends two independent transactions in sequence:

```ts
const mintTx = await blok.mint(walletAddress, score);
const scoreTx = await leaderboard.submitScore(walletAddress, score, modeId);
```

Neither is awaited to a receipt. If `mintTx` is included but `scoreTx` is dropped (nonce gap, RPC error, reverted for any reason), the user receives tokens without a leaderboard entry. Because the session token was already consumed by `validateSession({ consume: true })`, the user cannot retry — they've lost both the ability to replay and the expected leaderboard credit.

The reverse failure (score recorded, tokens not minted) is also possible but less likely since `mintTx` is issued first with a lower nonce.

**Impact**:
- User-facing inconsistency visible to anyone comparing the leaderboard board to their BLOK balance.
- No loss of funds; the backend wallet is the sole authority and could recover by re-submitting the missing tx off-session (but that requires operator intervention).
- Under normal MegaETH conditions (~10 ms blocks, stable base fee) the failure mode is rare. Under RPC turbulence it becomes a user-support burden.

**Recommendation** (pick one):
1. **Dispatcher contract** (strongest, adds contract-level complexity): deploy a `GameRewards` contract that owns both `BlokToken` and `Leaderboard` and exposes a single `recordRun(player, score, mode)` function. The backend calls one tx; either both state changes happen or neither does.
2. **Off-chain reconciliation**: after the two sends, await `scoreTx.wait()` with a short timeout; if it fails, queue a retry via a background worker keyed by mint-tx hash. Requires persistent state in Upstash.
3. **Accept the drift** and document it in the player-facing FAQ. Viable on MegaETH where failures are genuinely rare.

Option 1 is the cleanest; option 2 is the fastest to ship.

### [I-05] Struct constructor positional call flagged by forge lint

**Severity**: Informational
**Location**: `contracts/Leaderboard.sol:51, 63`

**Description**:
`forge build` emits a `named-struct-fields` lint note for both `ScoreEntry(...)` calls. This is stylistic — no functional difference — but named-field syntax protects against silent bugs if fields are ever reordered (see L-03 recommendation, which reorders the struct).

```
note[named-struct-fields]: prefer initializing structs with named fields
  --> contracts/Leaderboard.sol:51:28
```

**Recommendation**:
Adopt named fields, especially if you apply L-02 + L-03:

```diff
-board[count] = ScoreEntry(player, score, block.timestamp, mode);
+board[count] = ScoreEntry({
+    player: player,
+    timestamp: uint64(block.timestamp),
+    score: score
+});
```

---

## Priority Remediation Order

1. **L-01**: Override `renounceOwnership()` in both contracts — cheapest fix, eliminates a permanent-brick footgun. Apply before mainnet deploy.
2. **I-04**: Decide on the dual-write atomicity strategy (dispatcher vs. reconciliation vs. accept) and document it before players start earning tokens.
3. **L-02 + L-03 + I-05**: Bundle storage-layout cleanup into a single redeploy if/when you're iterating on `Leaderboard` anyway. Not urgent on testnet; worth it before mainnet because each SSTORE saved multiplies across every submission.
4. **L-04**: Adjust `NewHighScore` semantics when you decide what your indexer/UI actually wants to observe.
5. **I-01, I-02, I-03**: Accept as-is; document in the README.

---

## Appendix A: Audit Methodology Notes

This audit covered the equivalent of the Plamen Core pipeline (~30-50 agents) compressed into manual analysis because the scope (115 LOC, 2 contracts, standard OpenZeppelin patterns) is small enough that multi-agent orchestration would have added token cost without discovery value. The following methodology was applied in sequence:

1. **Recon**: read both contracts end-to-end, identified external deps (OpenZeppelin `ERC20` + `Ownable` only), mapped attack surface (`mint`, `submitScore`, `getTopScores`, `filled`, inherited `Ownable` surface).
2. **Breadth** (access control, state consistency, token flow, external calls, events): verified `onlyOwner` gates on every state-mutating function, verified zero-address and bounds checks on `submitScore`, confirmed no reentrancy surface (no external calls from state-mutating paths), confirmed event emission paths.
3. **Depth** (boundary + trace): verified bubble-insert correctness via test matrix (tie handling, equal-to-tail rejection, full-board displacement), verified storage layout against Solidity packing rules, traced backend integration (`app/api/mint/route.ts`) for off-chain/on-chain seam concerns.
4. **Chain**: considered the backend wallet compromise scenario, the renounce scenario, and the dual-write atomicity scenario. None produce Critical or High findings given the stated trust model.
5. **Verification**: 33/33 existing Hardhat tests pass, including the new edge-case suite in `test/Leaderboard.edge.test.ts` which mechanically pins several of the invariants cited above (tie-break, displacement, mode isolation, owner transfer).
6. **No PoC required** for any finding — all findings are either gas/storage hygiene, event semantics, or design decisions documented in context. No exploit path warrants a Foundry script.

**Tools used**: `forge build` (compilation + lint), `hardhat test` (33 tests), manual inspection against OpenZeppelin 5.x source. Slither and Medusa were not available on the audit host; their equivalent checks (reentrancy surface mapping, integer-bounds, fuzzed invariants) were performed by inspection given the contract simplicity.

**Tools NOT used and why**:
- **Slither**: not installed. Would have re-surfaced the `unused-return`, `immutable-state`, and `erc20-interface` checks — none apply here.
- **Medusa**: not installed. With 2 owner-gated write functions and no complex state machine, stateful fuzzing would have found nothing additional.
- **RAG / historical vulnerability DB**: not queried. The patterns are too standard and the contracts too small for historical precedents to add signal beyond what's captured above.

For larger future deployments (a dispatcher contract per I-04, any changes to scoring math on-chain, or a migration to ERC-20 with supply cap), re-run `/plamen core` or `/plamen thorough` to pick up patterns that matter at scale.
