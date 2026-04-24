/**
 * Minimal ABI fragments. Full artifacts live under artifacts/ after `hardhat compile`.
 */

export const BLOK_ABI = [
  "function mint(address to, uint256 amount) external",
  "function burn(uint256 amount) external",
  "function burnFrom(address account, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function setMinter(address minter) external",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
] as const;

export const LEADERBOARD_ABI = [
  "function submitScore(address player, uint256 score, uint8 mode) external",
  "function getTopScores(uint8 mode) view returns (tuple(address player, uint256 score, uint256 timestamp, uint8 difficultyMode)[100])",
  "function filled(uint8 mode) view returns (uint8)",
  "event NewHighScore(address indexed player, uint256 score, uint8 mode)",
] as const;

export const GAMEREWARDS_ABI = [
  "function NUKE_COST() view returns (uint256)",
  "function SWEEP_RELOAD_COST() view returns (uint256)",
  "function MODES() view returns (uint8)",
  "function spendNuke(address player) external",
  "function spendSweepReload(address player) external",
  "function placeWager(address player, uint8 mode, uint256 amount) external",
  "function recordBank(address player, uint8 mode, uint256 score) external",
  "function recordDeath(address player) external",
  "function personalBest(address player, uint8 mode) view returns (uint256)",
  "function activeWager(address player) view returns (uint256, uint8)",
  "function activeWagerAmount(address player) view returns (uint256)",
  "function activeWagerMode(address player) view returns (uint8)",
  "event NukeSpent(address indexed player, uint256 amount)",
  "event SweepReloadSpent(address indexed player, uint256 amount)",
  "event WagerPlaced(address indexed player, uint8 indexed mode, uint256 amount)",
  "event WagerWon(address indexed player, uint8 indexed mode, uint256 amount, uint256 score)",
  "event WagerLost(address indexed player, uint8 indexed mode, uint256 amount, uint256 score)",
  "event PersonalBestUpdated(address indexed player, uint8 indexed mode, uint256 score)",
  // Custom error definitions — without these, ethers can't decode reverts
  // and surfaces them as "missing revert data" on estimateGas failures.
  "error BadMode()",
  "error BadTier()",
  "error WagerActive()",
  "error NoWager()",
  "error WagerModeMismatch()",
  "error NoPersonalBest()",
  "error ZeroPlayer()",
] as const;
