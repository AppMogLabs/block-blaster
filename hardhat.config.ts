import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { config as dotenvConfig } from "dotenv";

// Load .env.local first (Next.js convention), then fall back to .env.
dotenvConfig({ path: ".env.local" });
dotenvConfig();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    megaeth: {
      url: process.env.MEGAETH_RPC_URL ?? "https://carrot.megaeth.com/rpc",
      chainId: Number(process.env.MEGAETH_CHAIN_ID ?? 6343),
      accounts: process.env.BACKEND_WALLET_PRIVATE_KEY
        ? [process.env.BACKEND_WALLET_PRIVATE_KEY]
        : [],
    },
    megaethMainnet: {
      url: "https://mainnet.megaeth.com/rpc",
      chainId: 4326,
      accounts: process.env.BACKEND_WALLET_PRIVATE_KEY
        ? [process.env.BACKEND_WALLET_PRIVATE_KEY]
        : [],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  etherscan: {
    // Etherscan v2 unified API — single key, chain selected via chainid param.
    apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    customChains: [
      {
        network: "megaethMainnet",
        chainId: 4326,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=4326",
          browserURL: "https://mega.etherscan.io",
        },
      },
    ],
  },
};

export default config;
