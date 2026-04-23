/**
 * Minimal ABI fragments. Full artifacts live under artifacts/ after `hardhat compile`.
 */

export const BLOK_ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
] as const;

export const LEADERBOARD_ABI = [
  "function submitScore(address player, uint256 score, uint8 mode) external",
  "function getTopScores(uint8 mode) view returns (tuple(address player, uint256 score, uint256 timestamp, uint8 difficultyMode)[100])",
  "function filled(uint8 mode) view returns (uint8)",
  "event NewHighScore(address indexed player, uint256 score, uint8 mode)",
] as const;
