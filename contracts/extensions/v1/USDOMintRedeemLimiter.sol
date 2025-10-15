// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

struct USDOMintRedeemLimiterCfg {
    uint256 totalSupplyCap;
    // mint
    uint256 mintMinimum;
    uint256 mintLimit;
    uint256 mintDuration;
    // redeem
    uint256 redeemMinimum;
    uint256 redeemLimit;
    uint256 redeemDuration;
    uint256 firstDepositAmount;
}

/**
 * @title USDOMintRedeemLimiter
 * @notice contract implementing time-based rate limiting for minting and redeeming.
 */
abstract contract USDOMintRedeemLimiter {
    // Total supply cap
    uint256 public _totalSupplyCap;

    // Mint rate limit
    uint256 public _mintMinimum;
    uint256 public _mintLimit;
    uint256 public _mintDuration;
    uint256 public _mintResetTime;
    uint256 public _mintedAmount;

    // Redeem rate limit
    uint256 public _redeemMinimum;
    uint256 public _redeemLimit;
    uint256 public _redeemDuration;
    uint256 public _redeemResetTime;
    uint256 public _redeemedAmount;

    // First deposit amount
    uint256 public _firstDepositAmount;

    // Events
    event TotalSupplyCapUpdated(uint256 newCap);
    event MintMinimumUpdated(uint256 newMinimum);
    event MintLimitUpdated(uint256 newLimit);
    event MintDurationUpdated(uint256 newDuration);

    event RdeemMinimumUpdated(uint256 newMinimum);
    event RedeemLimitUpdated(uint256 newLimit);
    event RedeemDurationUpdated(uint256 newDuration);
    event FirstDepositAmount(uint256 amount);

    // Errors
    error RedeemLessThanMinimum(uint256 amount, uint256 minimum);
    error MintLimitExceeded();
    error RedeemLimitExceeded();

    /**
     * @notice Initializes mint and redeem rate limits.
     * @param totalSupplyCap The total supply cap
     * @param mintMinimum    Min amount allowed to mint in one transaction
     * @param mintLimit      Max amount allowed to mint in one duration
     * @param mintDuration   Reset duration for minting (seconds)
     * @param redeemMinimum  Min amount allowed to redeem in one transaction
     * @param redeemLimit    Max amount allowed to redeem in one duration
     * @param redeemDuration Reset duration for redeeming (seconds)
     * @param firstDepositAmount The first deposit amount
     */

    function __USDOMintRedeemLimiter_init(
        uint256 totalSupplyCap,
        uint256 mintMinimum,
        uint256 mintLimit,
        uint256 mintDuration,
        uint256 redeemMinimum,
        uint256 redeemLimit,
        uint256 redeemDuration,
        uint256 firstDepositAmount
    ) internal {
        _totalSupplyCap = totalSupplyCap;

        //mint
        _mintMinimum = mintMinimum;
        _mintLimit = mintLimit;
        _mintDuration = mintDuration;

        //redeem
        _redeemMinimum = redeemMinimum;
        _redeemLimit = redeemLimit;
        _redeemDuration = redeemDuration;
        _firstDepositAmount = firstDepositAmount;

        _mintResetTime = block.timestamp;
        _redeemResetTime = block.timestamp;
    }

    /** @notice Set the total usdo supply cap
     * @param totalSupplyCap The target total supply cap
     */
    function _setTotalSupplyCap(uint256 totalSupplyCap) internal {
        _totalSupplyCap = totalSupplyCap;
        emit TotalSupplyCapUpdated(totalSupplyCap);
    }

    /*//////////////////////////////////////////////////////////////
                          Mint Limit Functions
    //////////////////////////////////////////////////////////////*/
    /**
     * @dev Ensures mint amount doesn't exceed the rate limit.
     * @param amount Amount to mint.
     */
    function _checkMintLimit(uint256 amount) internal {
        if (block.timestamp >= _mintResetTime + _mintDuration) {
            _mintedAmount = 0;
            _mintResetTime = block.timestamp;
        }

        if (_mintedAmount + amount > _mintLimit) revert MintLimitExceeded();
        _mintedAmount += amount;
    }

    /**
     * @dev Updates the mint minimum.
     * @param mintMinimum New mint minimum.
     */
    function _setMintMinimum(uint256 mintMinimum) internal {
        _mintMinimum = mintMinimum;
        emit MintMinimumUpdated(mintMinimum);
    }

    /**
     * @dev Updates the mint limit.
     * @param mintLimit New mint limit.
     */
    function _setMintLimit(uint256 mintLimit) internal {
        _mintLimit = mintLimit;
        emit MintLimitUpdated(mintLimit);
    }

    /**
     * @dev Updates the mint duration.
     * @param mintDuration New mint duration (seconds).
     */
    function _setMintDuration(uint256 mintDuration) internal {
        _mintDuration = mintDuration;
        emit MintDurationUpdated(mintDuration);
    }

    /*//////////////////////////////////////////////////////////////
                          Redeem Limit Functions
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Ensures redeem amount doesn't exceed the rate limit.
     * @param amount Amount to redeem.
     */
    function _checkRedeemLimit(uint256 amount) internal {
        if (amount < _redeemMinimum) revert RedeemLessThanMinimum(amount, _redeemMinimum);

        if (block.timestamp >= _redeemResetTime + _redeemDuration) {
            _redeemedAmount = 0;
            _redeemResetTime = block.timestamp;
        }

        if (_redeemedAmount + amount > _redeemLimit) revert RedeemLimitExceeded();
        _redeemedAmount += amount;
    }

    /**
     * @dev Updates the redeem minimum.
     * @param redeemMinimum New redeem minimum.
     */
    function _setRedeemMinimum(uint256 redeemMinimum) internal {
        _redeemMinimum = redeemMinimum;
        emit RdeemMinimumUpdated(redeemMinimum);
    }

    /**
     * @dev Updates the redeem limit.
     * @param redeemLimit New redeem limit.
     */
    function _setRedeemLimit(uint256 redeemLimit) internal {
        _redeemLimit = redeemLimit;
        emit RedeemLimitUpdated(redeemLimit);
    }

    /**
     * @dev Updates the redeem duration.
     * @param redeemDuration New redeem duration (seconds).
     */
    function _setRedeemDuration(uint256 redeemDuration) internal {
        _redeemDuration = redeemDuration;
        emit RedeemDurationUpdated(redeemDuration);
    }

    /// @notice Set the first deposit amount
    /// @param amount The first deposit amount
    function _setFirstDepositAmount(uint256 amount) internal {
        _firstDepositAmount = amount;
        emit FirstDepositAmount(amount);
    }

    uint256[10] private __gap;
}
