// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "./USDOExpressPausable.sol";
import "./USDOMintRedeemLimiterV2.sol";
import "./DoubleQueueModified.sol";

import {IUSDO} from "../interfaces/IUSDO.sol";
import {ICUSDO} from "../interfaces/ICUSDO.sol";
import "../interfaces/IRedemption.sol";
import "../interfaces/IAssetRegistry.sol";

enum TxType {
    MINT,
    REDEEM,
    INSTANT_REDEEM
}

contract USDOExpressV2 is UUPSUpgradeable, AccessControlUpgradeable, USDOExpressPausable, USDOMintRedeemLimiter {
    using MathUpgradeable for uint256;
    using DoubleQueueModified for DoubleQueueModified.BytesDeque;

    // Roles
    bytes32 public constant MULTIPLIER_ROLE = keccak256("MULTIPLIER_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant WHITELIST_ROLE = keccak256("WHITELIST_ROLE");
    bytes32 public constant UPGRADE_ROLE = keccak256("UPGRADE_ROLE");
    bytes32 public constant MAINTAINER_ROLE = keccak256("MAINTAINER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // APY in base points, scaled by 1e4 (e.g., 100 = 1%)
    uint256 public _apy; // 500 => 5%

    // fee rate for mint, scaled by 1e4, e.g., 100 stands for 1%
    uint256 public _mintFeeRate;
    uint256 public _redeemFeeRate;

    // constants for base points and scaling
    uint256 private constant _BPS_BASE = 1e4;
    uint256 private constant _BASE = 1e18;

    // daily bonus multiplier increment, scaled by 1e18
    uint256 public _increment;

    // The last time the bonus multiplier was updated
    uint256 public _lastUpdateTS;

    // Time buffer for the operator to update the bonus multiplier
    uint256 public _timeBuffer;

    // core token addresses
    IUSDO public _usdo;
    address public _usdc;

    // #previous: _tbill
    address public RESERVE1;

    // the address to receive the tokens
    address public _treasury;
    // the address to receive the fees
    address public _feeTo;

    // Asset registry for pluggable asset management  #previous: _buidl;
    IAssetRegistry public _assetRegistry;

    // for instant redeem - pluggable redemption contract, #previous: _buidlRedemption
    IRedemption public _redemptionContract;

    // cUSDO contract , #previous: _buidlTreasury
    ICUSDO public _cusdo;

    // check if the user has deposited before
    mapping(address => bool) public _firstDeposit;

    // kyc list
    mapping(address => bool) public _kycList;

    // Queue for redemption requests
    DoubleQueueModified.BytesDeque private _redemptionQueue;

    // Track redemption amounts for users in the queue
    mapping(address => uint256) private _redemptionInfo;

    // fee rate for instant redeem, scaled by 1e4, e.g., 100 stands for 1%
    uint256 public _instantRedeemFeeRate;

    // Events
    event UpdateAPY(uint256 apy, uint256 increment);
    event UpdateCusdo(address cusdo);
    event UpdateMintFeeRate(uint256 fee);
    event UpdateRedeemFeeRate(uint256 fee);
    event UpdateInstantRedeemFee(uint256 fee);
    event UpdateTreasury(address treasury);
    event UpdateFeeTo(address feeTo);
    event UpdateTimeBuffer(uint256 timeBuffer);
    event InstantMint(
        address indexed underlying,
        address indexed from,
        address indexed to,
        uint256 reqAmt,
        uint256 receiveAmt,
        uint256 fee
    );
    event InstantMintAndWrap(
        address indexed underlying,
        address indexed from,
        address indexed to,
        uint256 reqAmt,
        uint256 usdoAmt,
        uint256 cusdoAmt,
        uint256 fee
    );
    event USDOKycGranted(address[] addresses);
    event USDOKycRevoked(address[] addresses);

    event InstantRedeem(
        address indexed from,
        address indexed to,
        uint256 reqAmt,
        uint256 receiveAmt,
        uint256 fee,
        uint256 payout,
        uint256 usycFee,
        uint256 minUsdcOut
    );
    event ManualRedeem(address indexed from, uint256 reqAmt, uint256 receiveAmt, uint256 fee);
    event UpdateFirstDeposit(address indexed account, bool flag);

    // Queue-related events
    event AddToRedemptionQueue(address indexed from, address indexed to, uint256 usdoAmt, bytes32 id);
    event ProcessRedeem(
        address indexed from,
        address indexed to,
        uint256 usdoAmt,
        uint256 usdcAmt,
        uint256 fee,
        bytes32 id
    );
    event ProcessRedemptionQueue(uint256 totalRedeemAssets, uint256 totalBurnUsdo, uint256 totalFees);
    event ProcessRedemptionCancel(address indexed from, address indexed to, uint256 usdoAmt, bytes32 id);
    event Cancel(uint256 len, uint256 totalUsdo);
    event SetRedemption(address redemptionContract);
    event AssetRegistryUpdated(address indexed newRegistry);
    event OffRamp(address indexed to, uint256 amount);

    error USDOExpressTooEarly(uint256 amount);
    error USDOExpressZeroAddress();
    error USDOExpressTokenNotSupported(address token);
    error USDOExpressReceiveUSDCFailed(uint256 amount, uint256 received);

    error MintLessThanMinimum(uint256 amount, uint256 minimum);
    error TotalSupplyCapExceeded();
    error FirstDepositLessThanRequired(uint256 amount, uint256 minimum);
    error USDOExpressNotInKycList(address from, address to);
    error USDOExpressInvalidInput(uint256 input);
    error USDOExpressInsufficientLiquidity(uint256 required, uint256 available);
    error InsufficientOutput(uint256 received, uint256 minimum);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     * @param usdo Address of the USDO contract.
     * @param usdc Address of the USDC contract.
     */
    function initialize(
        address usdo,
        address cusdo,
        address usdc,
        address treasury,
        address feeTo,
        address maintainer,
        address operator,
        address admin,
        address assetRegistry,
        USDOMintRedeemLimiterCfg memory cfg
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _usdo = IUSDO(usdo);
        _cusdo = ICUSDO(cusdo);
        _usdc = usdc;
        _treasury = treasury;
        _feeTo = feeTo;
        _assetRegistry = IAssetRegistry(assetRegistry);

        __USDOMintRedeemLimiter_init(
            cfg.mintMinimum,
            cfg.mintLimit,
            cfg.mintDuration,
            cfg.redeemMinimum,
            cfg.redeemLimit,
            cfg.redeemDuration,
            cfg.firstDepositAmount
        );

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADE_ROLE, admin);

        _grantRole(WHITELIST_ROLE, maintainer);
        _grantRole(MAINTAINER_ROLE, maintainer);

        _grantRole(MULTIPLIER_ROLE, operator);
        _grantRole(PAUSE_ROLE, operator);
        _grantRole(OPERATOR_ROLE, operator);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADE_ROLE) {}

    /**
     * @notice Updates the APY.
     * @dev This function can only be called by the owner.
     * @param newAPY The new APY value in base points, apy example: 514 = 5.14%
     */
    function updateAPY(uint256 newAPY) external onlyRole(MAINTAINER_ROLE) {
        _apy = newAPY;

        // 140821917808219
        // 140821917808219.1780821918
        _increment = newAPY.mulDiv(_BASE, 365) / (_BPS_BASE);
        emit UpdateAPY(newAPY, _increment);
    }

    /**
     * @notice Update the cUSDO contract.
     * @param cusdo The address of the cUSDO contract.
     */
    function updateCusdo(address cusdo) external onlyRole(MAINTAINER_ROLE) {
        if (cusdo == address(0)) revert USDOExpressZeroAddress();
        _cusdo = ICUSDO(cusdo);
        emit UpdateCusdo(cusdo);
    }

    /**
     * @notice Update the asset registry address
     * @param newRegistry The new asset registry address
     */
    function setAssetRegistry(address newRegistry) external onlyRole(MAINTAINER_ROLE) {
        if (newRegistry == address(0)) revert USDOExpressZeroAddress();
        _assetRegistry = IAssetRegistry(newRegistry);
        emit AssetRegistryUpdated(newRegistry);
    }

    /**
     *@notice Will be used to update the bonus multiplier in the USDO contract.
     */
    function addBonusMultiplier() external onlyRole(MULTIPLIER_ROLE) {
        if (_lastUpdateTS != 0) {
            if (block.timestamp < _lastUpdateTS + _timeBuffer) revert USDOExpressTooEarly(block.timestamp);
        }

        _usdo.addBonusMultiplier(_increment);
        _lastUpdateTS = block.timestamp;
    }

    /**
     * @notice Set the time buffer for the operator to update the bonus multiplier
     * @dev Can only be called by the contract operator
     * @param timeBuffer Time buffer in seconds
     */
    function updateTimeBuffer(uint256 timeBuffer) external onlyRole(MAINTAINER_ROLE) {
        _timeBuffer = timeBuffer;
        emit UpdateTimeBuffer(timeBuffer);
    }

    /**
     * @notice Updates the fee percentage.
     * @dev This function can only be called by the operator.
     * @param fee The new fee percentage in base points.
     */
    function updateMintFee(uint256 fee) external onlyRole(MAINTAINER_ROLE) {
        _mintFeeRate = fee;
        emit UpdateMintFeeRate(fee);
    }

    /**
     * @notice Updates the fee percentage for redeem.
     * @dev This function can only be called by the operator.
     * @param fee The new fee percentage in base points.
     */
    function updateRedeemFee(uint256 fee) external onlyRole(MAINTAINER_ROLE) {
        _redeemFeeRate = fee;
        emit UpdateRedeemFeeRate(fee);
    }

    /**
     * @notice Updates the fee percentage for instant redeem.
     * @dev This function can only be called by the operator.
     * @param fee The new fee percentage in base points.
     */
    function updateInstantRedeemFee(uint256 fee) external onlyRole(MAINTAINER_ROLE) {
        _instantRedeemFeeRate = fee;
        emit UpdateInstantRedeemFee(fee);
    }

    /**
     * @notice Allows a whitelisted user to perform an instant mint.
     * @param underlying The address of the token to mint USDO from.
     * @param to The address to mint the USDO to.
     * @param amt The supplied amount of the underlying token.
     */
    function instantMint(address underlying, address to, uint256 amt) external whenNotPausedMint {
        address from = _msgSender();
        if (!_kycList[from] || !_kycList[to]) revert USDOExpressNotInKycList(from, to);

        (uint256 usdoAmtCurr, uint256 fee) = _instantMintInternal(underlying, from, to, to, amt);
        emit InstantMint(underlying, from, to, amt, usdoAmtCurr, fee);
    }

    /**
     * @notice Allows a whitelisted user to perform an instant mint.
     * @param underlying The address of the token to mint USDO from.
     * @param to The address to mint the USDO to.
     * @param amt The supplied amount of the underlying token.
     */
    function instantMintAndWrap(address underlying, address to, uint256 amt) external whenNotPausedMint {
        address from = _msgSender();
        if (!_kycList[from] || !_kycList[to]) revert USDOExpressNotInKycList(from, to);

        (uint256 usdoAmtCurr, uint256 fee) = _instantMintInternal(underlying, from, address(this), to, amt);

        _usdo.approve(address(_cusdo), usdoAmtCurr);
        uint256 cusdoAmt = _cusdo.deposit(usdoAmtCurr, to);

        emit InstantMint(underlying, from, to, amt, usdoAmtCurr, fee);
        emit InstantMintAndWrap(underlying, from, to, amt, usdoAmtCurr, cusdoAmt, fee);
    }

    /**
     * @notice Allows a whitelisted user to perform an instant redeem with slippage protection.
     * @dev Will convert USDO to USDC using the configured redemption contract.
     * @param to The address to redeem the USDC to.
     * @param amt The requested amount of USDO to redeem.
     * @param minUsdcOut Minimum USDC amount to receive (slippage protection).
     */
    function instantRedeemSelf(address to, uint256 amt, uint256 minUsdcOut) external whenNotPausedRedeem {
        address from = _msgSender();
        if (!_kycList[from] || !_kycList[to]) revert USDOExpressNotInKycList(from, to);
        _checkRedeemLimit(amt);

        // 1. burn the USDO
        _usdo.burn(from, amt);

        // 2. calculate the USDO amount into USDC and request redemption
        uint256 usdcNeeded = convertToUnderlying(_usdc, amt);

        // 3. redeem through the redemption contract and process
        (uint256 payout, uint256 redemptionFee, ) = _redemptionContract.redeemFor(from, usdcNeeded);

        // 4. calculate fees
        uint256 feeInUsdc = txsFee(usdcNeeded, TxType.INSTANT_REDEEM);
        uint256 usdcToUser = payout - feeInUsdc;

        // 5. slippage protection
        if (minUsdcOut > 0 && usdcToUser < minUsdcOut) {
            revert InsufficientOutput(usdcToUser, minUsdcOut);
        }

        // 6. transfer USDC fee to feeTo and the rest to user
        _distributeUsdc(to, usdcToUser, feeInUsdc);
        emit InstantRedeem(from, to, amt, usdcToUser, feeInUsdc, payout, redemptionFee, minUsdcOut);
    }

    /**
     * @notice Queue a redemption request for manual processing.
     * @dev The redemption request will be put into a queue and processed later when sufficient USDC is available.
     * @param to The address to redeem the USDC to.
     * @param amt The requested amount of USDO to redeem.
     */
    function redeemRequest(address to, uint256 amt) external whenNotPausedRedeem {
        address from = _msgSender();
        if (!_kycList[from] || !_kycList[to]) revert USDOExpressNotInKycList(from, to);
        _checkRedeemLimit(amt);

        // Burn USDO from the user
        _usdo.burn(from, amt);
        _redemptionInfo[to] += amt;

        bytes32 id = keccak256(abi.encode(from, to, amt, block.timestamp, _redemptionQueue.length()));
        bytes memory data = abi.encode(from, to, amt, id);
        _redemptionQueue.pushBack(data);

        emit AddToRedemptionQueue(from, to, amt, id);
    }

    /**
     * @notice The redemption request will be processed manually.
     * @param amt The requested amount of USDO to redeem.
     */
    function redeem(uint256 amt) external whenNotPausedRedeem {
        address from = _msgSender();
        if (!_kycList[from]) revert USDOExpressNotInKycList(from, from);

        _checkRedeemLimit(amt);
        _usdo.burn(from, amt);

        (uint256 feeAmt, uint256 usdcAmt, ) = previewRedeem(amt, false);
        emit ManualRedeem(from, amt, usdcAmt, feeAmt);
    }

    /**
     * @notice Cancel the first _len redemption requests in the queue.
     * @dev Only operators can call this function.
     * @param _len The length of the cancel requests.
     */
    function cancel(uint256 _len) external onlyRole(MAINTAINER_ROLE) {
        if (_redemptionQueue.empty()) revert USDOExpressInvalidInput(0);
        if (_len > _redemptionQueue.length()) revert USDOExpressInvalidInput(_len);

        uint256 totalUsdo;
        uint256 originalLen = _len;

        while (_len > 0) {
            bytes memory data = _redemptionQueue.popFront();

            (address sender, address receiver, uint256 usdoAmt, bytes32 prevId) = _decodeData(data);

            unchecked {
                totalUsdo += usdoAmt;
                _redemptionInfo[receiver] -= usdoAmt;
                _len--;
            }

            // Mint USDO back to the user
            _usdo.mint(sender, usdoAmt);
            emit ProcessRedemptionCancel(sender, receiver, usdoAmt, prevId);
        }
        emit Cancel(originalLen, totalUsdo);
    }

    /**
     * @notice Process the redemption queue.
     * @dev Only operators can call this function.
     * @param _len The length of the queue to process, 0 means process all.
     */
    function processRedemptionQueue(uint256 _len) external onlyRole(OPERATOR_ROLE) {
        uint256 length = _redemptionQueue.length();
        if (length == 0) revert USDOExpressInvalidInput(0);
        if (_len > length) revert USDOExpressInvalidInput(_len);
        if (_len == 0) _len = length;

        uint256 totalRedeemAssets;
        uint256 totalBurnUsdo;
        uint256 totalFees;

        for (uint count = 0; count < _len; ) {
            bytes memory data = _redemptionQueue.front();
            (address sender, address receiver, uint256 usdoAmt, bytes32 prevId) = _decodeData(data);

            if (!_kycList[sender] || !_kycList[receiver]) revert USDOExpressNotInKycList(sender, receiver);

            // Convert USDO to USDC amount
            uint256 usdcAmt = convertToUnderlying(_usdc, usdoAmt);

            // Check if we have enough USDC liquidity
            uint256 availableLiquidity = getTokenBalance(_usdc);
            if (usdcAmt > availableLiquidity) {
                break; // Stop processing if not enough liquidity
            }

            // Calculate fees
            uint256 feeInUsdc = txsFee(usdcAmt, TxType.REDEEM);
            uint256 usdcToUser = usdcAmt - feeInUsdc;

            // Remove from queue
            _redemptionQueue.popFront();

            unchecked {
                ++count;
                totalRedeemAssets += usdcToUser;
                totalBurnUsdo += usdoAmt;
                totalFees += feeInUsdc;
                _redemptionInfo[receiver] -= usdoAmt;
            }

            _distributeUsdc(receiver, usdcToUser, feeInUsdc);
            emit ProcessRedeem(sender, receiver, usdoAmt, usdcToUser, feeInUsdc, prevId);
        }

        emit ProcessRedemptionQueue(totalRedeemAssets, totalBurnUsdo, totalFees);
    }

    function _distributeUsdc(address to, uint256 usdcToUser, uint256 fee) private {
        if (fee > 0) SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_usdc), _feeTo, fee);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_usdc), to, usdcToUser);
    }

    /**
     * @notice Previews the instant redeem amounts.
     * @dev // USDC (6 decimals) to USDO (18 decimals), to scale to USDCO: amount * (10 ** (usdoDecimals - usdcDecimals));
     * @param token The token to provide the value in.
     * @param amt The amount of the token to convert.
     * @return usdoAmt The value of the token in USDO.
     */
    function convertFromUnderlying(address token, uint256 amt) public view returns (uint256 usdoAmt) {
        return _assetRegistry.convertFromUnderlying(token, amt);
    }

    function convertToUnderlying(address token, uint256 usdoAmt) public view returns (uint256 amt) {
        return _assetRegistry.convertToUnderlying(token, usdoAmt);
    }

    function updateTreasury(address treasury) external onlyRole(MAINTAINER_ROLE) {
        if (treasury == address(0)) revert USDOExpressZeroAddress();
        _treasury = treasury;
        emit UpdateTreasury(treasury);
    }

    function updateFeeTo(address feeTo) external onlyRole(MAINTAINER_ROLE) {
        if (feeTo == address(0)) revert USDOExpressZeroAddress();
        _feeTo = feeTo;
        emit UpdateFeeTo(feeTo);
    }

    function txsFee(uint256 amt, TxType txType) public view returns (uint256 fee) {
        uint256 feeRate;
        if (txType == TxType.MINT) {
            feeRate = _mintFeeRate;
        } else if (txType == TxType.REDEEM) {
            feeRate = _redeemFeeRate;
        } else if (txType == TxType.INSTANT_REDEEM) {
            feeRate = _instantRedeemFeeRate;
        }
        fee = (amt * feeRate) / _BPS_BASE;
    }

    /**
     * @notice Previews the instant mint amounts.
     * @param usdoAmt The amount of USDO requested for minting.
     * @return usdoAmtCurr The amount of USDO minted with the current bonus multiplier.
     * @return usdoAmtNext The amount of USDO minted with the next bonus multiplier.
     */
    function previewIssuance(uint256 usdoAmt) public view returns (uint256 usdoAmtCurr, uint256 usdoAmtNext) {
        (uint256 curr, uint256 next) = getBonusMultiplier();
        usdoAmtCurr = usdoAmt.mulDiv(curr, next);
        usdoAmtNext = usdoAmtCurr.mulDiv(next, curr);
    }

    function getBonusMultiplier() public view returns (uint256 curr, uint256 next) {
        curr = _usdo.bonusMultiplier();
        next = curr + _increment;
    }

    function previewMint(
        address underlying,
        uint256 amt
    ) public view returns (uint256 netAmt, uint256 fee, uint256 usdoAmtCurr, uint256 usdoAmtNext) {
        fee = txsFee(amt, TxType.MINT);
        netAmt = amt - fee;
        uint256 usdoAmt = convertFromUnderlying(underlying, netAmt);
        (usdoAmtCurr, usdoAmtNext) = previewIssuance(usdoAmt);
    }

    function previewRedeem(
        uint256 amt,
        bool isInstant
    ) public view returns (uint256 feeAmt, uint256 usdcAmt, uint256 extraFee) {
        TxType txType = isInstant ? TxType.INSTANT_REDEEM : TxType.REDEEM;
        uint256 feeInUsdo = txsFee(amt, txType);

        if (isInstant && address(_redemptionContract) != address(0)) {
            // For instant redemption, include fees from the redemption contract
            uint256 usdcNeeded = convertToUnderlying(_usdc, amt);

            // Get redemption preview (payout and redemption fee)
            (uint256 redemptionPayout, uint256 redemptionFee, ) = _redemptionContract.previewRedeem(usdcNeeded);

            // Calculate USDOExpress fee in USDC
            feeAmt = convertToUnderlying(_usdc, feeInUsdo);

            // Redemption contract fee (extraFee)
            extraFee = redemptionFee;

            // User receives: redemption payout - USDOExpress fee
            usdcAmt = redemptionPayout - feeAmt;
        } else {
            // For manual redemption, only USDOExpress fees apply
            feeAmt = convertToUnderlying(_usdc, feeInUsdo);
            usdcAmt = convertToUnderlying(_usdc, amt - feeInUsdo);
            extraFee = 0; // No redemption contract fees for manual redemption
        }
    }

    /**
     * @notice Set the redemption contract and token addresses.
     * @param redemptionContract Address of the redemption contract.
     */
    function setRedemption(address redemptionContract) external onlyRole(MAINTAINER_ROLE) {
        _redemptionContract = IRedemption(redemptionContract);
        emit SetRedemption(redemptionContract);
    }

    /**
     * @notice Retrieve the on-chain assets amount.
     * @param token The address of the token.
     * @return assetAmt Amount of onchain usdc.
     */
    function getTokenBalance(address token) public view returns (uint256 assetAmt) {
        return IERC20Upgradeable(token).balanceOf(address(this));
    }

    /**
     * @notice Update the mint status of the account.
     */
    function updateFirstDeposit(address account, bool flag) external onlyRole(MAINTAINER_ROLE) {
        _firstDeposit[account] = flag;
        emit UpdateFirstDeposit(account, flag);
    }

    /**
     * @notice Retrieve redemption queue information for a given index.
     * @param _index Index to retrieve data from.
     * @return sender The sender's address.
     * @return receiver The receiver's address.
     * @return usdoAmt The number of USDO.
     * @return id The ID associated with the redemption.
     */
    function getRedemptionQueueInfo(
        uint256 _index
    ) external view returns (address sender, address receiver, uint256 usdoAmt, bytes32 id) {
        if (_redemptionQueue.empty() || _index > _redemptionQueue.length() - 1) {
            return (address(0), address(0), 0, 0x0);
        }

        bytes memory data = bytes(_redemptionQueue.at(_index));
        (sender, receiver, usdoAmt, id) = _decodeData(data);
    }

    /**
     * @notice Retrieve redemption information for a specific user that is in the queue.
     * @param _user Address of the user.
     * @return usdoAmt Number of USDO associated with the user.
     */
    function getRedemptionUserInfo(address _user) external view returns (uint256 usdoAmt) {
        return _redemptionInfo[_user];
    }

    /**
     * @notice Retrieve the length of the redemption queue.
     * @return Length of the redemption queue.
     */
    function getRedemptionQueueLength() external view returns (uint256) {
        return _redemptionQueue.length();
    }

    /*//////////////////////////////////////////////////////////////
                    USDOExpressPausable functions
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Pauses minting
     */
    function pauseMint() external onlyRole(PAUSE_ROLE) {
        _pauseMint();
    }

    /**
     * @notice Unpauses minting
     */
    function unpauseMint() external onlyRole(PAUSE_ROLE) {
        _unpauseMint();
    }

    /**
     * @notice Pauses redeeming
     */
    function pauseRedeem() external onlyRole(PAUSE_ROLE) {
        _pauseRedeem();
    }

    /**
     * @notice Unpauses redeeming
     */
    function unpauseRedeem() external onlyRole(PAUSE_ROLE) {
        _unpauseRedeem();
    }

    /*//////////////////////////////////////////////////////////////
                    USDOMintRedeemLimiter functions
    //////////////////////////////////////////////////////////////*/
    /**
     * @notice Set the mint minimum in USDO equivalent.
     * @dev Amount should be in 18 decimals (USDO decimals) for accurate comparison across different underlying assets
     */
    function setMintMinimum(uint256 mintMinimum) external onlyRole(MAINTAINER_ROLE) {
        _setMintMinimum(mintMinimum);
    }

    /**
     * @notice Set the mint limit for a certain duration in seconds, etc 8400s.
     */
    function setMintDuration(uint256 mintDuration) external onlyRole(MAINTAINER_ROLE) {
        _setMintDuration(mintDuration);
    }

    /**
     * @notice Set the mint limit for a certain duration in seconds.
     */
    function setMintLimit(uint256 mintLimit) external onlyRole(MAINTAINER_ROLE) {
        _setMintLimit(mintLimit);
    }

    /**
     * @notice Set the redeem minimum in USDO.
     * @dev with 18 decimals
     */
    function setRedeemMinimum(uint256 redeemMinimum) external onlyRole(MAINTAINER_ROLE) {
        _setRedeemMinimum(redeemMinimum);
    }

    /**
     * @notice Set the redeem duration for a certain duration in seconds, etc 8400s.
     */
    function setRedeemDuration(uint256 redeemDuration) external onlyRole(MAINTAINER_ROLE) {
        _setRedeemDuration(redeemDuration);
    }

    /**
     * @notice Set the redeem limit for a certain duration in seconds.
     */
    function setRedeemLimit(uint256 redeemLimit) external onlyRole(MAINTAINER_ROLE) {
        _setRedeemLimit(redeemLimit);
    }

    /**
     * @notice Set the first deposit amount for the account.
     * @dev Amount should be in 18 decimals (USDO decimals) for accurate comparison across different underlying assets
     * @param amount The amount of the first deposit in USDO equivalent.
     */
    function setFirstDepositAmount(uint256 amount) external onlyRole(MAINTAINER_ROLE) {
        _setFirstDepositAmount(amount);
    }

    /**
     * @notice Grant KYC to the address.
     * @param _addresses The address to grant KYC.
     */
    function grantKycInBulk(address[] calldata _addresses) external onlyRole(WHITELIST_ROLE) {
        for (uint256 i = 0; i < _addresses.length; i++) {
            _kycList[_addresses[i]] = true;
        }
        emit USDOKycGranted(_addresses);
    }

    /**
     * @notice Revoke KYC to the address.
     * @param _addresses The address to revoke KYC.
     */
    function revokeKycInBulk(address[] calldata _addresses) external onlyRole(WHITELIST_ROLE) {
        for (uint256 i = 0; i < _addresses.length; i++) {
            _kycList[_addresses[i]] = false;
        }
        emit USDOKycRevoked(_addresses);
    }

    /**
     * @dev transfer underlying from vault to treasury, only operator can call this function
     * @param amt the amount of the token to transfer
     */
    function offRamp(uint256 amt) external onlyRole(OPERATOR_ROLE) {
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_usdc), _treasury, amt);
        emit OffRamp(_treasury, amt);
    }

    /*//////////////////////////////////////////////////////////////
                          INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Decodes a given data bytes into its components.
     * @param _data Encoded data bytes.
     * @return sender Sender's address.
     * @return receiver Receiver's address.
     * @return usdoAmt Number of USDO.
     * @return prevId Previous ID.
     */
    function _decodeData(
        bytes memory _data
    ) internal pure returns (address sender, address receiver, uint256 usdoAmt, bytes32 prevId) {
        (sender, receiver, usdoAmt, prevId) = abi.decode(_data, (address, address, uint256, bytes32));
    }

    /**
     * @notice Allows a whitelisted user to perform an instant mint.
     * @param underlying The address of the token to mint USDO from.
     * @param to The address to mint the USDO to.
     * @param amt The supplied amount of the underlying token.
     * @param user The end user to mint the USDO to.
     */
    function _instantMintInternal(
        address underlying,
        address from,
        address to,
        address user,
        uint256 amt
    ) internal returns (uint256, uint256) {
        // Convert underlying amount to USDO decimals for comparison
        uint256 usdoEquivalent = convertFromUnderlying(underlying, amt);

        // if the user has not deposited before, the first deposit amount should be set
        // if the user has deposited before, the mint amount should be greater than the mint minimum
        // do noted: the first deposit amount will be greater than the mint minimum
        if (!_firstDeposit[user]) {
            if (usdoEquivalent < _firstDepositAmount)
                revert FirstDepositLessThanRequired(usdoEquivalent, _firstDepositAmount);
            _firstDeposit[user] = true;
        } else {
            if (usdoEquivalent < _mintMinimum) revert MintLessThanMinimum(usdoEquivalent, _mintMinimum);
        }

        (uint256 netAmt, uint256 fee, uint256 usdoAmtCurr, ) = previewMint(underlying, amt);
        _checkMintLimit(usdoAmtCurr);

        // 2. transfer netAmt to treasury, and fee to feeTo
        if (fee > 0) SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(underlying), from, _feeTo, fee);
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(underlying), from, address(_treasury), netAmt);

        _usdo.mint(to, usdoAmtCurr);
        return (usdoAmtCurr, fee);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[50] private __gap;
}
