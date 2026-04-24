// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Minimal BLOK interface — needs ERC-20 + ERC20Burnable + the `mint` hook
 * we expose on BlokToken.
 */
interface IBlokToken is IERC20 {
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
    function mint(address to, uint256 amount) external;
}

/**
 * @title  GameRewards — Block Blaster onchain mechanics
 * @notice Player-facing spend + wager layer. Fronts BlokToken so all in-game
 *         BLOK spends happen via one pre-approved allowance and without
 *         player signatures mid-game.
 *
 *         Flow overview:
 *         1. Player signs ONE approve() tx on BlokToken granting this
 *            contract a high allowance. Done once per wallet, stored in the
 *            token's allowance map.
 *         2. Backend (owner) calls this contract's spend* / placeWager /
 *            recordBank / recordDeath functions in response to game events.
 *            This contract calls into the token using the player's allowance.
 *         3. Player never signs another tx — all in-game spends are
 *            interaction-free from the player's perspective.
 *
 *         All state-changing functions are onlyOwner so only the trusted
 *         backend wallet can invoke them. Contract logic is deterministic:
 *         the backend cannot, for example, force a wager win when the
 *         submitted score doesn't actually beat the stored PB.
 */
contract GameRewards is Ownable {
    IBlokToken public immutable blok;

    /// @notice 4 difficulty modes, 0..3 (Easy, Medium, Hard, Real-time).
    uint8 public constant MODES = 4;
    /// @notice Cost to fire a nuke, burned on activation.
    uint256 public constant NUKE_COST = 100;
    /// @notice Cost to instantly refill sweep fuel, burned on activation.
    uint256 public constant SWEEP_RELOAD_COST = 25;

    /// @notice Personal best per player, per mode. 0 = no PB recorded yet.
    mapping(address => mapping(uint8 => uint256)) public personalBest;

    /// @notice Active wager: 0 if none. Player can hold at most one.
    mapping(address => uint256) public activeWagerAmount;
    /// @notice Mode the active wager was placed on.
    mapping(address => uint8) public activeWagerMode;

    event NukeSpent(address indexed player, uint256 amount);
    event SweepReloadSpent(address indexed player, uint256 amount);
    event WagerPlaced(address indexed player, uint8 indexed mode, uint256 amount);
    event WagerWon(address indexed player, uint8 indexed mode, uint256 amount, uint256 score);
    event WagerLost(address indexed player, uint8 indexed mode, uint256 amount, uint256 score);
    event PersonalBestUpdated(address indexed player, uint8 indexed mode, uint256 score);

    error BadMode();
    error BadTier();
    error WagerActive();
    error NoWager();
    error WagerModeMismatch();
    error NoPersonalBest();
    error ZeroPlayer();

    constructor(address owner_, address blok_) Ownable(owner_) {
        require(blok_ != address(0), "blok required");
        blok = IBlokToken(blok_);
    }

    // ─── In-game spends (burn-on-use) ────────────────────────────────────

    /**
     * @notice Burn NUKE_COST from the player's balance. Player must have
     *         previously approved this contract. Called by the backend when
     *         the player activates a charged nuke.
     */
    function spendNuke(address player) external onlyOwner {
        if (player == address(0)) revert ZeroPlayer();
        blok.burnFrom(player, NUKE_COST);
        emit NukeSpent(player, NUKE_COST);
    }

    /**
     * @notice Burn SWEEP_RELOAD_COST from the player. Called by the backend
     *         when the player taps the sweep-reload button.
     */
    function spendSweepReload(address player) external onlyOwner {
        if (player == address(0)) revert ZeroPlayer();
        blok.burnFrom(player, SWEEP_RELOAD_COST);
        emit SweepReloadSpent(player, SWEEP_RELOAD_COST);
    }

    // ─── Wagers ─────────────────────────────────────────────────────────

    /**
     * @notice Lock a self-wager into this contract's escrow. Reverts if the
     *         tier is not one of (50, 100, 200, 500), if the player already
     *         has an active wager, or if the player has no PB on this mode
     *         (self-wager requires an existing PB to beat).
     */
    function placeWager(address player, uint8 mode, uint256 amount) external onlyOwner {
        if (player == address(0)) revert ZeroPlayer();
        if (mode >= MODES) revert BadMode();
        if (activeWagerAmount[player] != 0) revert WagerActive();
        if (amount != 50 && amount != 100 && amount != 200 && amount != 500) {
            revert BadTier();
        }
        if (personalBest[player][mode] == 0) revert NoPersonalBest();

        // Move the wager into this contract's own balance.
        require(
            blok.transferFrom(player, address(this), amount),
            "wager transfer failed"
        );
        activeWagerAmount[player] = amount;
        activeWagerMode[player] = mode;
        emit WagerPlaced(player, mode, amount);
    }

    // ─── Post-game settlement ───────────────────────────────────────────

    /**
     * @notice Called by the backend when a player banks. Settles any
     *         active wager and updates their PB atomically.
     *
     *         Wager outcome: if `score` strictly exceeds the stored PB at
     *         call time (i.e. the OLD PB), the player wins — wager returned,
     *         matching bonus minted. Otherwise the wager is burned.
     *
     *         PB update happens AFTER wager settlement, so a wager on the
     *         run that sets a new PB still beats the comparison.
     */
    function recordBank(address player, uint8 mode, uint256 score) external onlyOwner {
        if (player == address(0)) revert ZeroPlayer();
        if (mode >= MODES) revert BadMode();

        uint256 pb = personalBest[player][mode];
        uint256 wager = activeWagerAmount[player];

        // Wager settlement first, against the OLD PB.
        if (wager > 0) {
            uint8 wagerMode = activeWagerMode[player];
            if (wagerMode != mode) revert WagerModeMismatch();

            activeWagerAmount[player] = 0;
            activeWagerMode[player] = 0;

            if (score > pb) {
                // Return the wager + mint the matching bonus.
                require(blok.transfer(player, wager), "wager return failed");
                blok.mint(player, wager);
                emit WagerWon(player, mode, wager, score);
            } else {
                // Burn the wager held in escrow.
                blok.burn(wager);
                emit WagerLost(player, mode, wager, score);
            }
        }

        // PB update — only after wager settled.
        if (score > pb) {
            personalBest[player][mode] = score;
            emit PersonalBestUpdated(player, mode, score);
        }
    }

    /**
     * @notice Called by the backend when a player dies (stack tops out).
     *         Any active wager is burned. No PB update.
     */
    function recordDeath(address player) external onlyOwner {
        if (player == address(0)) revert ZeroPlayer();
        uint256 wager = activeWagerAmount[player];
        if (wager == 0) return;
        uint8 mode = activeWagerMode[player];

        activeWagerAmount[player] = 0;
        activeWagerMode[player] = 0;
        blok.burn(wager);
        emit WagerLost(player, mode, wager, 0);
    }

    // ─── Views ──────────────────────────────────────────────────────────

    /// @notice Convenience: returns (wagerAmount, wagerMode). Both zero if none.
    function activeWager(address player) external view returns (uint256, uint8) {
        return (activeWagerAmount[player], activeWagerMode[player]);
    }
}
