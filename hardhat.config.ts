import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-chai-matchers';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-storage-layout';
import 'hardhat-contract-sizer';
// import '@nomicfoundation/hardhat-verify';
import dotenv from 'dotenv';

dotenv.config();

const {
  NODE_ENV,
  REPORT_GAS,
  ETHERSCAN_KEY,
  ARBSCAN_KEY,
  BASESCAN_KEY,
  BSCSCAN_KEY,

  COIN_MARKETCAP_API_KEY,
  ALCHEMY_KEY,
  PRIVATE_KEY,
  OZ_PLATFORM_KEY,
  OZ_PLATFORM_SECRET,
} = process.env;

const isTestEnv = NODE_ENV === 'test';
const gasReport = REPORT_GAS === 'true';

const testConfig: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {},
  },
};

const gasReporterConfig = {
  enabled: REPORT_GAS === 'true',
  coinmarketcap: COIN_MARKETCAP_API_KEY,
  gasPrice: 20,
};

const config: HardhatUserConfig = {
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v5',
  },
  solidity: {
    version: '0.8.18',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  platform: {
    apiKey: OZ_PLATFORM_KEY as string,
    apiSecret: OZ_PLATFORM_SECRET as string,
  },
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_KEY as string,
      mainnet: ETHERSCAN_KEY as string,

      base_sepolia: BASESCAN_KEY as string,
      base_mainnet: BASESCAN_KEY as string,

      arbi_sepolia: ARBSCAN_KEY as string,
      arbitrumOne: ARBSCAN_KEY as string,

      bsc_testnet: BSCSCAN_KEY as string,
      bsc_mainnet: BSCSCAN_KEY as string,
    },
    customChains: [
      {
        network: 'arbi_sepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api-sepolia.arbiscan.io/api',
          browserURL: 'https://sepolia.arbiscan.io',
        },
      },
      {
        network: 'base_sepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
      {
        network: 'bsc_testnet',
        chainId: 97,
        urls: {
          apiURL: 'https://api-testnet.bscscan.com/api',
          browserURL: 'https://testnet.bscscan.com/',
        },
      },
      {
        network: 'base_mainnet',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org',
        },
      },
      {
        network: 'bsc_mainnet',
        chainId: 56,
        urls: {
          apiURL: 'https://api.bscscan.com/api',
          browserURL: 'https://bscscan.com/',
        },
      },
    ],
  },
  defaultNetwork: 'hardhat',
  networks: {
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      chainId: 11155111,
      // Only add account if the PK is provided
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    base_sepolia: {
      url: `https://base-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      gasPrice: 1000000000,
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    arbi_sepolia: {
      url: `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      chainId: 421614,
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    bsc_testnet: {
      url: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
      chainId: 97,
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    mainnet: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      chainId: 1,
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    base_mainnet: {
      url: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      gasPrice: 1000000000,
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    arb_mainnet: {
      url: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      chainId: 42161,
      // Only add account if the PK is provided
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    bsc_mainnet: {
      url: `https://bnb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      chainId: 56,
      // Only add account if the PK is provided
      ...(PRIVATE_KEY ? { accounts: [PRIVATE_KEY] } : {}),
    },
    hardhat: {
      chainId: 1337, // We set 1337 to make interacting with MetaMask simpler
    },
  },
  gasReporter: gasReport ? gasReporterConfig : {},
  mocha: {
    timeout: 120000,
  },
};

export default isTestEnv
  ? {
    ...config,
    ...testConfig,
  }
  : config;
