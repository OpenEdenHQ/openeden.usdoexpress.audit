// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IRedemption.sol";

/**
 * @title MockSimpleRedemption
 * @dev Simple mock redemption contract that works with USDC directly
 * @dev This replaces the BUIDL-based redemption for testing USDOExpressV2
 */
contract MockSimpleRedemption is IRedemption {
    using SafeERC20 for IERC20;

    address public asset; // USDC address

    constructor(address _asset) {
        asset = _asset;
    }

    function redeemFor(
        address /* user */,
        uint256 amount
    ) external override returns (uint256 payout, uint256 fee, int256 price) {
        payout = amount;
        fee = 0;
        price = 1e8; // 1:1 ratio with 8 decimals (like Chainlink price feeds)
        // Transfer to the calling contract (USDOExpressV2), not to the end user
        // The calling contract will handle distribution to the user
        IERC20(asset).transfer(msg.sender, amount);
    }

    /**
     * @notice Redeem USDC - simply returns the requested amount
     * @dev In a real implementation, this would handle the redemption logic
     * @param amount The amount of USDC to redeem
     * @return payout The amount of USDC payout (same as input in this mock)
     * @return fee The fee charged (0 in this mock)
     * @return price The price used (1:1 ratio, represented as 1e8 for 8 decimals)
     */
    function redeem(uint256 amount) external pure override returns (uint256 payout, uint256 fee, int256 price) {
        // In this simple mock, we just return the same amount with no fees
        // The calling contract should have already provided the USDC
        payout = amount;
        fee = 0;
        price = 1e8; // 1:1 ratio with 8 decimals (like Chainlink price feeds)
    }

    /**
     * @notice Check liquidity - returns the balance of the asset contract
     */
    function checkLiquidity() external view override returns (uint256, uint256, uint256, uint256, uint256, uint256) {
        uint256 balance = IERC20(asset).balanceOf(address(this));
        return (balance, 0, 0, 0, 0, 0);
    }

    /**
     * @notice Check if paused - always returns false for this mock
     */
    function checkPaused() external pure override returns (bool) {
        return false;
    }

    /**
     * @notice Preview a redemption without executing it
     * @param amount Amount to redeem
     * @return payout The amount that would be received
     * @return fee The fee that would be charged (0 in this mock)
     * @return price The price used (1:1 ratio)
     */
    function previewRedeem(uint256 amount) external pure override returns (uint256 payout, uint256 fee, int256 price) {
        payout = amount;
        fee = 0;
        price = 1e8; // 1:1 ratio with 8 decimals
    }

    /**
     * @notice Get available liquidity
     */
    function availableLiquidity() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }
}
