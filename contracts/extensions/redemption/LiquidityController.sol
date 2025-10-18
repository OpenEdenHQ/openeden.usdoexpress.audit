// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";

error QuotaExceedsTotal(uint256 userQuota, uint256 totalLiquidity);
error QuotaExceedsUsed(uint256 newQuota, uint256 usedAmount);
error InsufficientTotalLiquidity(uint256 available, uint256 requested);
error UnauthorizedCaller();
error ZeroAddress();
error ZeroAmount();
error UserNotFound(address user);
error InsufficientUserQuota(address user, uint256 available, uint256 requested);

/**
 * @title LiquidityController
 * @dev Manages user-specific liquidity quotas for redemption operations
 * @dev Tracks allocations and enforces limits per user and globally
 * @dev Integrates with redemption contracts to validate liquidity access
 */
contract LiquidityController is OwnableUpgradeable, UUPSUpgradeable {
    using MathUpgradeable for uint256;

    // Events
    event QuotaSet(address indexed user, uint256 quota);
    event TotalLiquidityUpdated(uint256 newTotal);
    event QuotaUsed(address indexed user, uint256 amount, uint256 remainingQuota);
    event QuotaRestored(address indexed user, uint256 amount, uint256 remainingQuota);
    event CallerUpdated(address indexed newCaller);

    // State variables
    mapping(address => uint256) public userQuotas;
    mapping(address => uint256) public usedQuotas;
    mapping(address => bool) public authorizedUsers;
    mapping(address => bool) private userExists;

    address[] public users;
    address public caller;
    uint256 public totalLiquidity;

    // Track total allocated across all users
    uint256 public totalAllocated;

    // Track total used across all users
    uint256 public totalUsed;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _caller Authorized caller address (typically the redemption contract)
     * @param _totalLiquidity Total available liquidity pool
     */
    function initialize(address _caller, uint256 _totalLiquidity) public initializer {
        if (_caller == address(0)) revert ZeroAddress();

        __Ownable_init();
        __UUPSUpgradeable_init();

        caller = _caller;
        totalLiquidity = _totalLiquidity;
        totalAllocated = 0;
        totalUsed = 0;

        emit TotalLiquidityUpdated(_totalLiquidity);
        emit CallerUpdated(_caller);
    }

    /**
     * @notice Set quota for a specific user
     * @param user User address
     * @param quota Quota amount in underlying token (USYC)
     */
    function setUserQuota(address user, uint256 quota) external onlyOwner {
        uint256 oldQuota = userQuotas[user];
        uint256 usedQuota = usedQuotas[user];

        // Update total allocated accounting
        if (oldQuota > 0) {
            totalAllocated = totalAllocated - oldQuota;
        }

        if (quota > 0) {
            // Check that new quota isn't less than already used amount
            if (quota < usedQuota) {
                revert QuotaExceedsUsed(quota, usedQuota);
            }

            // Check if new allocation fits within total liquidity
            if (totalAllocated + quota > totalLiquidity) {
                revert QuotaExceedsTotal(quota, totalLiquidity - totalAllocated);
            }

            totalAllocated = totalAllocated + quota;

            // Add to users array if new user
            if (!userExists[user]) {
                users.push(user);
                userExists[user] = true;
            }
            authorizedUsers[user] = true;
        } else {
            // Removing quota - require no active usage
            if (usedQuota > 0) {
                revert QuotaExceedsUsed(0, usedQuota);
            }
            authorizedUsers[user] = false;
        }

        userQuotas[user] = quota;

        emit QuotaSet(user, quota);
    }

    /**
     * @notice Reserve liquidity for a user (consumes quota)
     * @param user User address
     * @param amount Amount to reserve
     */
    function reserveLiquidity(address user, uint256 amount) external {
        if (msg.sender != caller) revert UnauthorizedCaller();
        if (amount == 0) revert ZeroAmount();

        uint256 quota = userQuotas[user];
        if (quota == 0) revert UserNotFound(user);

        uint256 used = usedQuotas[user];
        uint256 availableQuota = quota > used ? quota - used : 0;

        if (amount > availableQuota) {
            revert InsufficientUserQuota(user, availableQuota, amount);
        }

        // Check total liquidity constraint
        uint256 totalAvailable = totalLiquidity > totalUsed ? totalLiquidity - totalUsed : 0;
        if (amount > totalAvailable) {
            revert InsufficientTotalLiquidity(totalAvailable, amount);
        }

        usedQuotas[user] = used + amount;
        totalUsed = totalUsed + amount;

        emit QuotaUsed(user, amount, quota > usedQuotas[user] ? quota - usedQuotas[user] : 0);
    }

    /**
     * @notice Restore liquidity for a user (releases quota back)
     * @param user User address
     * @param amount Amount to restore
     */
    function restoreLiquidity(address user, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();

        uint256 used = usedQuotas[user];
        uint256 toRestore = amount > used ? used : amount;

        if (toRestore > 0) {
            usedQuotas[user] = used - toRestore;
            totalUsed = totalUsed - toRestore;

            uint256 quota = userQuotas[user];
            emit QuotaRestored(user, toRestore, quota > usedQuotas[user] ? quota - usedQuotas[user] : 0);
        }
    }

    /**
     * @notice Check if user has sufficient quota for amount
     * @param user User address
     * @param amount Amount to validate
     * @return allowed Whether the amount is within user's available quota
     * @return quota User's total quota
     */
    function validateUserQuota(address user, uint256 amount) external view returns (bool allowed, uint256 quota) {
        quota = userQuotas[user];
        uint256 used = usedQuotas[user];

        if (quota == 0) {
            allowed = false; // User has no quota
        } else {
            uint256 availableQuota = quota > used ? quota - used : 0;
            allowed = amount <= availableQuota; // Check: amount <= remaining quota
        }
    }

    /**
     * @notice Check total liquidity status
     * @return totalAvailable Total unallocated liquidity
     * @return totalReserved Total allocated across all users
     * @return totalConsumed Total used across all users
     * @return poolBalance Total liquidity pool
     */
    function checkTotalLiquidity()
        external
        view
        returns (uint256 totalAvailable, uint256 totalReserved, uint256 totalConsumed, uint256 poolBalance)
    {
        totalReserved = totalAllocated;
        totalConsumed = totalUsed;
        totalAvailable = totalLiquidity > totalAllocated ? totalLiquidity - totalAllocated : 0;
        poolBalance = totalLiquidity;
    }

    /**
     * @notice Check liquidity status for a specific user
     * @param user User address
     * @return available Available quota for this user
     * @return total Total quota for this user
     * @return used Used quota for this user
     */
    function checkUserLiquidity(address user) external view returns (uint256 available, uint256 total, uint256 used) {
        total = userQuotas[user];
        used = usedQuotas[user];
        available = total > used ? total - used : 0;
    }

    /**
     * @notice Check if a user is authorized and their quota status
     * @param user User address
     * @return hasQuota Whether user has a quota
     * @return quota User's total quota
     * @return available User's available quota
     */
    function isUserAuthorized(address user) external view returns (bool hasQuota, uint256 quota, uint256 available) {
        quota = userQuotas[user];
        hasQuota = quota > 0 && authorizedUsers[user];
        uint256 used = usedQuotas[user];
        available = quota > used ? quota - used : 0;
    }

    /**
     * @notice Update total liquidity pool (owner only)
     * @param newTotal New total liquidity amount
     */
    function updateTotalLiquidity(uint256 newTotal) external onlyOwner {
        if (newTotal < totalAllocated) {
            revert InsufficientTotalLiquidity(totalAllocated, newTotal);
        }

        totalLiquidity = newTotal;
        emit TotalLiquidityUpdated(newTotal);
    }

    /**
     * @notice Update authorized caller address (owner only)
     * @param newCaller New caller address
     */
    function updateCaller(address newCaller) external onlyOwner {
        if (newCaller == address(0)) revert ZeroAddress();

        caller = newCaller;
        emit CallerUpdated(newCaller);
    }

    /**
     * @notice Get list of all users with active quotas
     * @return activeUsers Array of user addresses with active quotas
     */
    function getAllUsers() external view returns (address[] memory activeUsers) {
        uint256 activeCount = 0;

        // Count active users
        for (uint256 i = 0; i < users.length; i++) {
            if (authorizedUsers[users[i]] && userQuotas[users[i]] > 0) {
                activeCount++;
            }
        }

        // Build active user list
        activeUsers = new address[](activeCount);
        uint256 index = 0;

        for (uint256 i = 0; i < users.length; i++) {
            if (authorizedUsers[users[i]] && userQuotas[users[i]] > 0) {
                activeUsers[index] = users[i];
                index++;
            }
        }
    }

    /**
     * @notice Required by the OZ UUPS module
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
