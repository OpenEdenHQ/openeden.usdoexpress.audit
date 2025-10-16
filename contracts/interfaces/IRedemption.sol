// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

interface IRedemption {
    function checkLiquidity() external view returns (uint256, uint256, uint256, uint256, uint256, uint256);

    function checkPaused() external view returns (bool);

    function redeem(uint256 amount) external returns (uint256 payout, uint256 fee, int256 price);

    function redeemFor(address user, uint256 amount) external returns (uint256 payout, uint256 fee, int256 price);

    function previewRedeem(uint256 amount) external view returns (uint256 payout, uint256 fee, int256 price);
}
