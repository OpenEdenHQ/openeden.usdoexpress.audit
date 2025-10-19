// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

/**
 * @title IAssetRegistry
 * @notice Simple interface for managing supported underlying assets
 */
interface IAssetRegistry {
    struct AssetConfig {
        address asset;
        bool isSupported;
        address priceFeed; // Optional: IPriceFeed contract for price conversion (like TBILL)
        uint256 maxStalePeriod; // Maximum staleness period for this asset's price feed (in seconds)
    }

    /**
     * @notice Add or update an asset configuration
     * @param config The asset configuration
     */
    function setAssetConfig(AssetConfig calldata config) external;

    /**
     * @notice Remove an asset from supported assets
     * @param asset The asset address
     */
    function removeAsset(address asset) external;

    /**
     * @notice Get asset configuration
     * @param asset The asset address
     * @return config The asset configuration
     */
    function getAssetConfig(address asset) external view returns (AssetConfig memory config);

    /**
     * @notice Check if asset is supported
     * @param asset The asset address
     * @return supported True if asset is supported
     */
    function isAssetSupported(address asset) external view returns (bool supported);

    /**
     * @notice Convert asset amount to USDO amount
     * @param asset The asset address
     * @param assetAmount The asset amount
     * @return usdoAmount The equivalent USDO amount
     */
    function convertFromUnderlying(address asset, uint256 assetAmount) external view returns (uint256 usdoAmount);

    /**
     * @notice Convert USDO amount to asset amount
     * @param asset The asset address
     * @param usdoAmount The USDO amount
     * @return assetAmount The equivalent asset amount
     */
    function convertToUnderlying(address asset, uint256 usdoAmount) external view returns (uint256 assetAmount);

    /**
     * @notice Get list of all supported assets
     * @return assets Array of supported asset addresses
     */
    function getSupportedAssets() external view returns (address[] memory assets);

    // Events
    event AssetAdded(address indexed asset, AssetConfig config);
    event AssetUpdated(address indexed asset, AssetConfig config);
    event AssetRemoved(address indexed asset);
    event MaxStalePeriodUpdated(uint256 newStalePeriod);
}
