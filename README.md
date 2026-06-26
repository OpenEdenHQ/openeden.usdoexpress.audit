# USDO / USDOExpress Contracts

Smart contracts for the USDO stablecoin protocol: the rebasing `USDO` token, the `cUSDO` wrapper, the `USDOExpress` mint/redeem gateway, asset registry, and Proof-of-Reserve tracking. Built with Hardhat (with Foundry support) and OpenZeppelin UUPS proxies.

## Deployed Addresses

Deployed contract addresses for all networks (mainnet + testnet) are in [`deployed-addresses.md`](./deployed-addresses.md).

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to run the linter and update tests as appropriate.

## Dev

This Project uses Hardhat. It includes a contract, its tests, and a script that deploys the contract.

> Prerequisites: Node v18 LTS

### Installation

1. Install dependencies

   ```shell
   npm i
   ```

2. Copy ENV file

   ```shell
   cp .env.example .env
   ```

3. Replace ENV variables with the values as needed

### Usage

Try running some of the following tasks:

Testing

```shell
npm run test
```

Coverage

```shell
npm run coverage
```

Linter

```shell
npm run lint
```

Running local node

```shell
npx hardhat node
```

Compile

```shell
npx hardhat compile
```

Deploying and contract verification

```shell
npx hardhat run scripts/deploy.ts --network sepolia
npx hardhat verify --network sepolia <contract-address>
```

Help

```shell
npx hardhat help
```

### Features

- Access Control
- Rebasing token mechanism
- Minting and burning functionality
- Block/Unblock accounts
- Pausing emergency stop mechanism
- Bonus multiplier system
- EIP-2612 permit support
- OpenZeppelin UUPS upgrade pattern

### USDO

#### Public and External Functions

- `initialize(string memory name_, string memory symbol_, address owner)`: Initializes the contract.
- `name()`: Returns the name of the token.
- `symbol()`: Returns the symbol of the token.
- `decimals()`: Returns the number of decimals the token uses.
- `convertToShares(uint256 amount)`: Converts an amount of tokens to shares.
- `convertToTokens(uint256 shares)`: Converts an amount of shares to tokens.
- `totalShares()`: Returns the total amount of shares.
- `totalSupply()`: Returns the total supply.
- `balanceOf(address account)`: Returns the account blanace.
- `sharesOf(address account)`: Returns the account shares.
- `mint(address to, uint256 amount)`: Creates new tokens to the specified address.
- `burn(address from, uint256 amount)`: Destroys tokens from the specified address.
- `transfer(address to, uint256 amount)`: Transfers tokens between addresses.
- `banAddresses(address[] addresses)`: Blocks multiple accounts at once.
- `unbanAddresses(address[] addresses)`: Unblocks multiple accounts at once.
- `isBanned(address account)`: Checks if an account is blocked.
- `pause()`: Pauses the contract, halting token transfers.
- `unpause()`: Unpauses the contract, allowing token transfers.
- `updateBonusMultiplier(uint256 _bonusMultiplier)`: Sets the bonus multiplier.
- `addBonusMultiplier(uint256 _bonusMultiplierIncrement)`: Adds the given amount to the current bonus multiplier.
- `approve(address spender, uint256 amount)`: Approves an allowance for a spender.
- `allowance(address owner, address spender)`: Returns the allowance for a spender.
- `transferFrom(address from, address to, uint256 amount)`: Moves tokens from an address to another one using the allowance mechanism.
- `increaseAllowance(address spender, uint256 addedValue)`: Increases the allowance granted to spender by the caller.
- `decreaseAllowance(address spender, uint256 subtractedValue)`: Decreases the allowance granted to spender by the caller.
- `DOMAIN_SEPARATOR()`: Returns the EIP-712 domain separator.
- `nonces(address owner)`: Returns the nonce for the specified address.
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`: Implements EIP-2612 permit functionality.

#### Private and Internal Functions

- `_authorizeUpgrade(address newImplementation)`: Internal function to authorize an upgrade.
- `_mint(address to, uint256 amount)`: Internal function to mint tokens to the specified address.
- `_burn(address account, uint256 amount)`: Internal function to burn tokens from the specified address.
- `_beforeTokenTransfer(address from, address to, uint256 amount)`: Hook that is called before any transfer of tokens.
- `_afterTokenTransfer(address from, address to, uint256 amount)`: Hook that is called after any transfer of tokens.
- `_transfer(address from, address to, uint256 amount)`: Internal function to transfer tokens between addresses.
- `_bannedAccount(address account)`: Internal function to block account.
- `_unbannedAccount(address account)`: Internal function to unblock an account.
- `_updateBonusMultiplier(uint256 _bonusMultiplier)`: Internal function to set the bonus multiplier.
- `_spendAllowance(address owner, address spender, uint256 amount)`: Internal function to spend an allowance.
- `_useNonce(address owner)`: Increments and returns the current nonce for a given address.
- `_approve(address owner, address spender, uint256 amount)`: Internal function to approve an allowance for a spender.

#### Events

- `Transfer(from indexed addr, to uint256, amount uint256)`: Emitted when transferring tokens.
- `BonusMultiplier(uint256 indexed value)`: Emitted when the bonus multiplier has changed.
- `Approval(address indexed owner, address indexed spender, uint256 value)`: Emitted when the allowance of a spender for an owner is set.
- `AccountBanned(address indexed addr)`: Emitted when an address is blocked.
- `AccountUnbanned(address indexed addr)`: Emitted when an address is removed from the banlist.
- `Paused(address account)`: Emitted when the pause is triggered by account.
- `Unpaused(address account)`: Emitted when the unpause is triggered by account.
- `Upgraded(address indexed implementation)`: Emitted when the implementation is upgraded.

#### Roles

- `DEFAULT_ADMIN_ROLE`: Grants the ability to grant roles.
- `MINTER_ROLE`: Grants the ability to mint tokens.
- `BURNER_ROLE`: Grants the ability to burn tokens.
- `BANLIST_ROLE`: Grants the ability to manage the banlist.
- `MULTIPLIER_ROLE`: Grants the ability to update the bonus multiplier.
- `UPGRADE_ROLE`: Grants the ability to upgrade the contract.
- `PAUSE_ROLE`: Grants the ability to pause/unpause the contract.

### cUSDO

#### Public and External Functions

- `initialize(IUSDO _USDO, address owner)`: Initializes the contract.
- `pause()`: Pauses the contract, halting token transfers.
- `unpause()`: Unpauses the contract, allowing token transfers.
- `paused()`: Returns true if USDO or cUSDO is paused, and false otherwise.
- `DOMAIN_SEPARATOR()`: Returns the EIP-712 domain separator.
- `nonces(address owner)`: Returns the nonce for the specified address.
- `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`: Implements EIP-2612 permit functionality.

#### Private and Internal Functions

- `_beforeTokenTransfer(address from, address to, uint256 amount)`: Hook that is called before any transfer of tokens.
- `_authorizeUpgrade(address newImplementation)`: Internal function to authorize an upgrade.
- `_useNonce(address owner)`: Increments and returns the current nonce for a given address.

#### Events

- `Transfer(from indexed addr, to uint256, amount uint256)`: Emitted when transferring tokens.
- `Approval(address indexed owner, address indexed spender, uint256 value)`: Emitted when the allowance of a spender for an owner is set.
- `Paused(address account)`: Emitted when the pause is triggered by account.
- `Unpaused(address account)`: Emitted when the unpause is triggered by account.
- `Upgraded(address indexed implementation)`: Emitted when the implementation is upgraded.

#### Roles

- `DEFAULT_ADMIN_ROLE`: Grants the ability to grant roles.
- `UPGRADE_ROLE`: Grants the ability to upgrade the contract.
- `PAUSE_ROLE`: Grants the ability to pause/unpause the contract.

## Audits

Independent security audit reports are in [`audits/`](./audits/).

## Attribution

This project is released under the [MIT License](./LICENSE). While the MIT
License does not require it, if you use this software in your own product or
service, we kindly ask that you include visible attribution to **OpenEden**
(e.g. in your documentation, UI, or credits) and link to
[openeden.com](https://openeden.com/).
