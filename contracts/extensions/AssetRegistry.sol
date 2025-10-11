// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IPriceFeed.sol";

/**
 * @title AssetRegistry
 * @notice Simple registry for managing supported underlying assets with price oracles
 */
contract AssetRegistry is IAssetRegistry, UUPSUpgradeable, AccessControlUpgradeable {
    using MathUpgradeable for uint256;

    // Custom errors
    error AssetRegistryZeroAddress();
    error AssetRegistryInvalidStalePeriod(uint256 stalePeriod);
    error AssetRegistryAssetNotSupported(address asset);
    error AssetRegistryInvalidPrice(int256 price);
    error AssetRegistryStalePriceData(uint256 updatedAt, uint256 currentTime, uint256 maxStale);
    error AssetRegistryUnsupportedAssetConfiguration();

    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant UPGRADE_ROLE = keccak256("UPGRADE_ROLE");

    // Constants
    uint256 private constant _USDO_DECIMALS = 18;

    // Maximum staleness period for price feeds (default: 2 days)
    uint256 public maxStalePeriod;

    // Asset configurations
    mapping(address => AssetConfig) private _assetConfigs;
    address[] private _supportedAssets;
    mapping(address => uint256) private _assetIndex;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        if (admin == address(0)) revert AssetRegistryZeroAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        // Set default staleness period to 2 days
        maxStalePeriod = 2 days;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MAINTAINER_ROLE, admin);
        _grantRole(MAINTAINER_ROLE, msg.sender);
        _grantRole(UPGRADE_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADE_ROLE) {}

    /**
     * @notice Set the maximum staleness period for price feeds
     * @param newStalePeriod The new staleness period in seconds
     */
    function setMaxStalePeriod(uint256 newStalePeriod) external onlyRole(MAINTAINER_ROLE) {
        if (newStalePeriod == 0) revert AssetRegistryInvalidStalePeriod(newStalePeriod);
        maxStalePeriod = newStalePeriod;
        emit MaxStalePeriodUpdated(newStalePeriod);
    }

    /**
     * @notice Get fresh price from price feed with staleness check
     * @param priceFeed The price feed address
     * @return price The fresh price
     * @return decimals The price feed decimals
     */
    function _getFreshPrice(address priceFeed) internal view returns (uint256 price, uint8 decimals) {
        (uint80 roundId, int256 answer, , uint256 updatedAt, uint80 answeredInRound) = IPriceFeed(priceFeed)
            .latestRoundData();

        if (answer <= 0) revert AssetRegistryInvalidPrice(answer);
        if (block.timestamp - updatedAt > maxStalePeriod) {
            revert AssetRegistryStalePriceData(updatedAt, block.timestamp, maxStalePeriod);
        }

        // Check for incomplete round data
        if (answeredInRound < roundId) {
            revert AssetRegistryStalePriceData(updatedAt, block.timestamp, maxStalePeriod);
        }

        price = uint256(answer);
        decimals = IPriceFeed(priceFeed).decimals();
    }

    function setAssetConfig(AssetConfig calldata config) external onlyRole(MAINTAINER_ROLE) {
        address asset = config.asset;
        if (asset == address(0)) revert AssetRegistryZeroAddress();

        bool wasSupported = _assetConfigs[asset].isSupported;
        _assetConfigs[asset] = config;

        if (config.isSupported && !wasSupported) {
            _supportedAssets.push(asset);
            _assetIndex[asset] = _supportedAssets.length - 1;
            emit AssetAdded(asset, config);
        } else if (config.isSupported && wasSupported) {
            emit AssetUpdated(asset, config);
        } else {
            revert AssetRegistryUnsupportedAssetConfiguration();
        }
    }

    function removeAsset(address asset) external onlyRole(MAINTAINER_ROLE) {
        if (!_assetConfigs[asset].isSupported) revert AssetRegistryAssetNotSupported(asset);

        _assetConfigs[asset].isSupported = false;
        _removeAssetFromArray(asset);
        emit AssetRemoved(asset);
    }

    function getAssetConfig(address asset) external view returns (AssetConfig memory config) {
        return _assetConfigs[asset];
    }

    function isAssetSupported(address asset) external view returns (bool supported) {
        return _assetConfigs[asset].isSupported;
    }

    function convertFromUnderlying(address asset, uint256 assetAmount) external view returns (uint256 usdoAmount) {
        AssetConfig memory config = _assetConfigs[asset];
        if (!config.isSupported) revert AssetRegistryAssetNotSupported(asset);

        uint256 amount = assetAmount;
        uint8 assetDecimals = IERC20Metadata(asset).decimals();

        // If asset has price feed, convert to USD value first
        if (config.priceFeed != address(0)) {
            (uint256 rate, uint8 feedDecimals) = _getFreshPrice(config.priceFeed);
            amount = assetAmount.mulDiv(rate, 10 ** feedDecimals);
        }

        // Scale to USDO decimals
        usdoAmount = amount * (10 ** (_USDO_DECIMALS - assetDecimals));
    }

    function convertToUnderlying(address asset, uint256 usdoAmount) external view returns (uint256 assetAmount) {
        AssetConfig memory config = _assetConfigs[asset];
        if (!config.isSupported) revert AssetRegistryAssetNotSupported(asset);

        uint8 assetDecimals = IERC20Metadata(asset).decimals();

        // Scale down from USDO decimals to asset decimals with proper rounding
        uint256 divisor = 10 ** (_USDO_DECIMALS - assetDecimals);
        uint256 amount = usdoAmount.mulDiv(1, divisor, MathUpgradeable.Rounding.Up);

        // If asset has price feed, convert from USD value
        if (config.priceFeed != address(0)) {
            (uint256 rate, uint8 feedDecimals) = _getFreshPrice(config.priceFeed);
            assetAmount = amount.mulDiv(10 ** feedDecimals, rate);
        } else {
            assetAmount = amount;
        }
    }

    function getSupportedAssets() external view returns (address[] memory assets) {
        return _supportedAssets;
    }

    function _removeAssetFromArray(address asset) internal {
        uint256 index = _assetIndex[asset];
        uint256 lastIndex = _supportedAssets.length - 1;

        if (index != lastIndex) {
            address lastAsset = _supportedAssets[lastIndex];
            _supportedAssets[index] = lastAsset;
            _assetIndex[lastAsset] = index;
        }

        _supportedAssets.pop();
        delete _assetIndex[asset];
    }
}
