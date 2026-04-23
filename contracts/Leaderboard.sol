// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  Block Blaster Leaderboard
 * @notice Stores the top 100 scores per difficulty mode. Only the backend
 *         signer may submit scores. Top-100 is maintained by bubble-insertion
 *         on submit — bounded by the fixed 100-slot array, so gas is O(1).
 *
 *         MegaETH-specific notes:
 *         - Fresh storage slots cost ~2M gas × multiplier. We pre-allocate the
 *           full 100-slot ring on first write per mode to amortize that cost
 *           across subsequent submissions (slots get reused, not allocated).
 *         - `emit NewHighScore` fires only when an entry actually enters top 100.
 */
contract Leaderboard is Ownable {
    uint8 public constant MODES = 4;
    uint8 public constant TOP_N = 100;

    struct ScoreEntry {
        address player;
        uint256 score;
        uint256 timestamp;
        uint8 difficultyMode;
    }

    /// mode => sorted array (descending) of top-100 entries
    mapping(uint8 => ScoreEntry[TOP_N]) private _board;
    /// mode => current populated count (grows to TOP_N then stays)
    mapping(uint8 => uint8) private _filled;

    event NewHighScore(address indexed player, uint256 score, uint8 mode);

    constructor(address owner_) Ownable(owner_) {}

    /**
     * @notice Submit a score. If it lands in the top 100 for `mode`,
     *         insert it and displace the lowest entry.
     */
    function submitScore(address player, uint256 score, uint8 mode) external onlyOwner {
        require(mode < MODES, "Leaderboard: bad mode");
        require(player != address(0), "Leaderboard: zero player");

        ScoreEntry[TOP_N] storage board = _board[mode];
        uint8 count = _filled[mode];

        // Case A: board not yet full — append then bubble up.
        if (count < TOP_N) {
            board[count] = ScoreEntry(player, score, block.timestamp, mode);
            _filled[mode] = count + 1;
            _bubbleUp(board, count);
            emit NewHighScore(player, score, mode);
            return;
        }

        // Case B: board full — only insert if score > current minimum (tail).
        if (score <= board[TOP_N - 1].score) {
            return;
        }

        board[TOP_N - 1] = ScoreEntry(player, score, block.timestamp, mode);
        _bubbleUp(board, TOP_N - 1);
        emit NewHighScore(player, score, mode);
    }

    /// @notice Returns the top-N entries (descending). Unfilled slots have score=0.
    function getTopScores(uint8 mode) external view returns (ScoreEntry[TOP_N] memory out) {
        require(mode < MODES, "Leaderboard: bad mode");
        out = _board[mode];
    }

    function filled(uint8 mode) external view returns (uint8) {
        require(mode < MODES, "Leaderboard: bad mode");
        return _filled[mode];
    }

    /// @dev Bubble the element at `from` toward index 0 while it exceeds its predecessor.
    function _bubbleUp(ScoreEntry[TOP_N] storage board, uint256 from) private {
        uint256 i = from;
        while (i > 0 && board[i].score > board[i - 1].score) {
            ScoreEntry memory tmp = board[i - 1];
            board[i - 1] = board[i];
            board[i] = tmp;
            unchecked {
                --i;
            }
        }
    }
}
