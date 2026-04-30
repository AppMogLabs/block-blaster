# Meta-Buffer: Block Blaster (gaming / reward-distribution / token / leaderboard)

## Protocol Classification
- **Type**: gaming, reward-distribution, token, leaderboard
- **Key Indicators**: BlokToken.sol (ERC-20 token), GameRewards.sol (reward distribution / claim logic), Leaderboard.sol (on-chain score/rank tracking)

## RAG: UNAVAILABLE
unified-vuln-db MCP tools not registered in this environment (probe not possible — tools not found via ToolSearch).
Phase 4b.5 RAG Validation Sweep will compensate using WebSearch fallback.

## Common Vulnerabilities for gaming / reward-distribution (manual baseline)

| Category | Frequency | Key Functions to Check |
|----------|-----------|----------------------|
| Signature replay / missing nonce | Very High | claimReward(), mint(), any permit-style function |
| Missing access control on reward minting | High | GameRewards reward distribution, Leaderboard score submission |
| Centralization / admin over-privilege | High | owner setters, admin-only score updates |
| Integer overflow/underflow (pre-0.8 or unchecked blocks) | Medium | reward calculations, score accumulation |
| Re-entrancy on token transfers | Medium | claimReward() if external call before state update |
| Front-running score submission | Medium | Leaderboard.submitScore() or equivalent |
| Sybil / fake score inflation | High | Who can call score submission? Any auth? |
| Token inflation via uncapped minting | High | BlokToken.mint() — who controls it? |
| Timestamp / block manipulation for timing windows | Medium | Reward epoch resets, cooldown periods |
| Missing event emission on state changes | Low | Admin setters, score updates, reward claims |

## Attack Vectors for External Dependencies

### Reward Distribution (signature-based-claim pattern)
- **Bug Class**: Signature replay
- **Attack Steps**: Attacker reuses a valid signature (or replayed across chains) to claim rewards multiple times. Key: check for nonce/chainId in signed message, and that nonce is consumed on-chain before transfer.

### Leaderboard Manipulation
- **Bug Class**: Unauthorized score update
- **Attack Steps**: If submitScore() lacks adequate caller validation (e.g., only owner/oracle can submit, or no validation at all), attacker submits arbitrary scores to top the leaderboard and claim rank-based rewards.

### Token Minting (BlokToken)
- **Bug Class**: Uncapped / unauthorized mint
- **Attack Steps**: If mint() is callable by GameRewards or any other semi-trusted contract without a supply cap or caller whitelist, an attacker who compromises GameRewards can inflate token supply arbitrarily.

## Root Cause Analysis (manual baseline)

### Signature Replay
- **Why This Happens**: EIP-712 signatures often omit nonce or chainId, or nonce is not incremented atomically.
- **What to Look For**: ecrecover / ECDSA.recover calls; check signed struct for nonce field; verify nonce[user]++ happens before token transfer.

### Access Control on Score Submission
- **Why This Happens**: Developers trust off-chain game server but forget to enforce on-chain that only the trusted server (or a designated oracle/signer) can submit scores.
- **What to Look For**: onlyOwner / onlyOracle modifiers on Leaderboard.submitScore(); whether the caller check can be bypassed.

### Re-entrancy in Claim
- **Why This Happens**: State update (mark claimed) occurs after external token.transfer() call.
- **What to Look For**: checks-effects-interactions order in GameRewards.claimReward() or equivalent; use of nonReentrant.

## Questions for Analysis Agents
1. Does GameRewards use signature-based claims? If so, does the signed message include nonce AND chainId? Is the nonce consumed atomically before the reward transfer?
2. Who is authorized to submit scores to Leaderboard? Is there an on-chain check (signer/oracle validation) or is it open to any caller?
3. Does BlokToken.mint() have a supply cap? Which addresses are authorized to call it — is GameRewards the only minter, and is that enforced?
4. Does GameRewards update claim state BEFORE or AFTER the token transfer? Is nonReentrant used?
5. Are there cooldown periods or epoch windows in GameRewards? Can they be manipulated via block.timestamp?
6. Does Leaderboard emit events for score updates? Are there admin setter functions that lack events?
7. Can a single address claim rewards multiple times (replay or double-claim)?
8. Are there any unchecked arithmetic blocks in reward or score calculations that could overflow?

## Code Patterns to Grep
- `ecrecover` / `ECDSA.recover` — signature verification entry points; check surrounding nonce/chainId logic
- `nonces[` / `_nonces[` — nonce tracking; verify increment before transfer
- `mint(` — token minting; verify caller whitelist and supply cap
- `submitScore(` / `setScore(` / `updateScore(` — leaderboard write path; check access control
- `claimReward(` / `claim(` — reward claim; check CEI order and reentrancy guard
- `onlyOwner` / `onlyMinter` / `onlyOracle` — role modifiers; enumerate who holds each role
- `block.timestamp` — timing dependencies; check for manipulation vectors
- `unchecked {` — arithmetic without overflow checks; verify bounds

## Fork Ancestry Analysis
- No known parent protocol detected for a generic gaming/leaderboard/reward system.
- No Curve/Compound/Uniswap fork signatures expected.
- Tavily/Solodit unavailable (RAG tools not registered).
- Manual review recommended: check if BlokToken inherits OpenZeppelin ERC20 (standard) or a custom base.
