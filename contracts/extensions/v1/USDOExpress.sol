// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "../USDOExpressPausable.sol";
import "./USDOMintRedeemLimiter.sol";

import {IUSDO} from "../../interfaces/IUSDO.sol";
import {ITBILL} from "../../interfaces/ITBILL.sol";
import {IBuidlRedemption, IBuidlSettlement} from "../../interfaces/IBuidlRedemption.sol";

enum TxType {
    MINT,
    REDEEM
}

contract USDOExpress is UUPSUpgradeable, AccessControlUpgradeable, USDOExpressPausable, USDOMintRedeemLimiter {
    using MathUpgradeable for uint256;

    // Roles
    bytes32 public constant MULTIPLIER_ROLE = keccak256("MULTIPLIER_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant WHITELIST_ROLE = keccak256("WHITELIST_ROLE");
    bytes32 public constant UPGRADE_ROLE = keccak256("UPGRADE_ROLE");

    // APY in base points, scaled by 1e4 (e.g., 100 = 1%)
    uint256 public _apy; // 500 => 5%

    // Fee rates, scaled by 1e4, e.g., 1 = 0.01%
    uint256 public _mintFeeRate;
    uint256 public _redeemFeeRate;

    // constants for base points and scaling
    uint256 private constant _BPS_BASE = 1e4;
    uint256 private constant _BASE = 1e18;
    uint256 private constant _DECIMALS = 1e6;
    uint256 private constant _SCALE_FACTOR = 1e12;

    // daily bonus multiplier increment, scaled by 1e18
    uint256 public _increment;

    // The last time the bonus multiplier was updated
    uint256 public _lastUpdateTS;

    // Time buffer for the operator to update the bonus multiplier
    uint256 public _timeBuffer;

    // core token addresses
    IUSDO public _usdo;
    address public _usdc;
    address public _tbill;

    // the address to receive the tokens
    address public _treasury;
    // the address to receive the fees
    address public _feeTo;

    // instant redemption info
    IERC20Upgradeable public _buidl;
    IBuidlRedemption public _buidlRedemption;

    // the address to provide the BUIDL tokens
    address public _buidlTreasury;

    // check if the user has deposited before
    mapping(address => bool) public _firstDeposit;

    // kyc list
    mapping(address => bool) public _kycList;

    // Events
    event UpdateAPY(uint256 apy, uint256 increment);
    event UpdateMintFeeRate(uint256 fee);
    event UpdateRedeemFeeRate(uint256 fee);
    event UpdateTreasury(address treasury);
    event UpdateBuidlTreasury(address bTreasury);
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
    event USDOKycGranted(address[] addresses);
    event USDOKycRevoked(address[] addresses);

    event InstantRedeem(address indexed from, address indexed to, uint256 reqAmt, uint256 receiveAmt, uint256 fee);
    event ManualRedeem(address indexed from, uint256 reqAmt, uint256 receiveAmt, uint256 fee);
    event UpdateFirstDeposit(address indexed account, bool flag);

    error USDOExpressTooEarly(uint256 amount);
    error USDOExpressZeroAddress();
    error USDOExpressTokenNotSupported(address token);
    error USDOExpressReceiveUSDCFailed(uint256 amount, uint256 received);

    error MintLessThanMinimum(uint256 amount, uint256 minimum);
    error TotalSupplyCapExceeded();
    error FirstDepositLessThanRequired(uint256 amount, uint256 minimum);
    error USDOExpressNotInKycList(address from, address to);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initializes the contract.
     * @param usdo Address of the USDO contract.
     * @param usdc Address of the USDC contract.
     * @param tbill Address of the TBILL contract.
     */
    function initialize(
        address usdo,
        address usdc,
        address tbill,
        address buidl,
        address buidlRdemption,
        address treasury,
        address buidlTreasury,
        address feeTo,
        address admin,
        USDOMintRedeemLimiterCfg memory cfg
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _usdo = IUSDO(usdo);
        _usdc = usdc;
        _tbill = tbill;
        _buidl = IERC20Upgradeable(buidl);
        _buidlRedemption = IBuidlRedemption(buidlRdemption);
        _treasury = treasury;
        _buidlTreasury = buidlTreasury;
        _feeTo = feeTo;

        __USDOMintRedeemLimiter_init(
            cfg.totalSupplyCap,
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
        _grantRole(MULTIPLIER_ROLE, admin);
        _grantRole(PAUSE_ROLE, admin);
        _grantRole(WHITELIST_ROLE, admin);
        _grantRole(UPGRADE_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADE_ROLE) {}

    /**
     * @notice Updates the APY.
     * @dev This function can only be called by the owner.
     * @param newAPY The new APY value in base points, apy example: 514 = 5.14%
     */
    function updateAPY(uint256 newAPY) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _apy = newAPY;

        // 140821917808219
        // 140821917808219.1780821918
        _increment = newAPY.mulDiv(_BASE, 365) / (_BPS_BASE);
        emit UpdateAPY(newAPY, _increment);
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
    function updateTimeBuffer(uint256 timeBuffer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _timeBuffer = timeBuffer;
        emit UpdateTimeBuffer(timeBuffer);
    }

    /**
     * @notice Updates the fee percentage.
     * @dev This function can only be called by the operator.
     * @param fee The new fee percentage in base points.
     */
    function updateMintFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _mintFeeRate = fee;
        emit UpdateMintFeeRate(fee);
    }

    /**
     * @notice Updates the fee percentage.
     * @dev This function can only be called by the operator.
     * @param fee The new fee percentage in base points.
     */
    function updateRedeemFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _redeemFeeRate = fee;
        emit UpdateRedeemFeeRate(fee);
    }

    /**
     * @notice Allows a whitelisted user to perform an instant mint.
     * @param underlying The address of the token to mint USDO from.
     * @param to The address to mint the USDO to.
     * @param amt The supplied amount of the underlying token.
     */
    function instantMint(address underlying, address to, uint256 amt) external whenNotPausedMint {
        // 1. calculate the USDO amount to mint
        address from = _msgSender();
        if (!_kycList[from] || !_kycList[to]) revert USDOExpressNotInKycList(from, to);

        // if the user has not deposited before, the first deposit amount should be set
        // if the user has deposited before, the mint amount should be greater than the mint minimum
        // do noted: the first deposit amount will be greater than the mint minimum
        if (!_firstDeposit[to]) {
            if (amt < _firstDepositAmount) revert FirstDepositLessThanRequired(amt, _firstDepositAmount);
            _firstDeposit[to] = true;
        } else {
            if (amt < _mintMinimum) revert MintLessThanMinimum(amt, _mintMinimum);
        }

        (uint256 netAmt, uint256 fee, uint256 usdoAmtCurr, ) = previewMint(underlying, amt);

        _checkMintLimit(usdoAmtCurr);
        if (_usdo.totalSupply() + usdoAmtCurr > _totalSupplyCap) revert TotalSupplyCapExceeded();

        // 2. transfer netAmt to treasury, and fee to feeTo
        if (fee > 0) SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(underlying), from, _feeTo, fee);

        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(underlying), from, address(_treasury), netAmt);

        // 3. mint USDO to user
        _usdo.mint(to, usdoAmtCurr);
        emit InstantMint(underlying, from, to, amt, usdoAmtCurr, fee);
    }

    /**
     * @notice Allows a whitelisted user to perform an instant redeem.
     * @dev Will convert the amount of USDO to TBILL and redeem it for USDC.
     * @param to The address to redeem the USDC to.
     * @param amt The requested amount of USDO to redeem.
     */
    function instantRedeem(address to, uint256 amt) external whenNotPausedRedeem {
        address from = _msgSender();
        if (!_kycList[from] || !_kycList[to]) revert USDOExpressNotInKycList(from, to);
        _checkRedeemLimit(amt);

        // 1. burn the USDO
        _usdo.burn(from, amt);

        // 2. calculate the USDO amount into tbill and pull tbill from treasury
        (uint256 tbillAmt, uint256 feeInUsdc, ) = previewRedeem(amt);
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(_tbill), _treasury, address(this), tbillAmt);

        // 3. redeem of tbill by calling tbill contract and get USDC back
        uint256 requestAmt = ITBILL(_tbill).redeemIns(tbillAmt, address(this));
        uint256 usdcToUser = requestAmt - feeInUsdc;

        // 4. transfer USDC fee to feeTo
        _distributeUsdc(to, usdcToUser, feeInUsdc);
        emit InstantRedeem(from, to, amt, usdcToUser, feeInUsdc);
    }

    function instantRedeemSelf(address to, uint256 amt) external whenNotPausedRedeem {
        address from = _msgSender();
        if (!_kycList[from] || !_kycList[to]) revert USDOExpressNotInKycList(from, to);
        _checkRedeemLimit(amt);

        // 1. burn the USDO
        _usdo.burn(from, amt);

        // 2. calculate the USDO amount into USDC and transfer BUIDL to address(this)
        uint256 requestAmt = convertToUnderlying(_usdc, amt);

        // 3. transfer BUIDL from buidl treasury to vault, 1 BUIDL = 1 USDC, and both with 6 decimals
        SafeERC20Upgradeable.safeTransferFrom(_buidl, _buidlTreasury, address(this), requestAmt);

        // 4. redeem BUIDL to USDC
        SafeERC20Upgradeable.safeApprove(_buidl, address(_buidlRedemption), requestAmt);

        uint256 beforeAmt = getTokenBalance(_usdc);
        _buidlRedemption.redeem(requestAmt);

        uint256 afterAmt = getTokenBalance(_usdc);
        if (beforeAmt + requestAmt != afterAmt) revert USDOExpressReceiveUSDCFailed(requestAmt, afterAmt - beforeAmt);

        // 5. calculate fees
        uint256 feeInUsdc = txsFee(requestAmt, TxType.REDEEM);
        uint256 usdcToUser = requestAmt - feeInUsdc;

        // 6. transfer USDC fee to feeTo and the rest to user
        _distributeUsdc(to, usdcToUser, feeInUsdc);
        emit InstantRedeem(from, to, amt, usdcToUser, feeInUsdc);
    }

    function _distributeUsdc(address to, uint256 usdcToUser, uint256 fee) private {
        if (fee > 0) SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_usdc), _feeTo, fee);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_usdc), to, usdcToUser);
    }

    /**
     * @notice The redemption request will be processed manually.
     * @param amt The requested amount of USDO to redeem.
     */
    function redeem(uint256 amt) external whenNotPausedRedeem {
        address from = _msgSender();
        if (!_kycList[from]) revert USDOExpressNotInKycList(from, from);
        _usdo.burn(from, amt);

        (, uint256 feeAmt, uint256 usdcAmt) = previewRedeem(amt);
        emit ManualRedeem(from, amt, usdcAmt, feeAmt);
    }

    /**
     * @notice Previews the instant redeem amounts.
     * @dev // USDC (6 decimals) to USDO (18 decimals), to scale to USDCO: amount * (10 ** (usdoDecimals - usdcDecimals));
     * @param token The token to provide the value in.
     * @param amt The amount of the token to convert.
     * @return usdoAmt The value of the token in USDO.
     */
    function convertFromUnderlying(address token, uint256 amt) public view returns (uint256 usdoAmt) {
        if (token == address(0)) revert USDOExpressZeroAddress();
        if (token == _usdc) {
            // Directly scale USDC to USDO
            usdoAmt = amt * _SCALE_FACTOR;
        } else if (token == _tbill) {
            // Convert TBILL to USDC, then scale to USDO
            uint256 usdcAmt = convertTbillToUsdc(amt);
            usdoAmt = usdcAmt * _SCALE_FACTOR;
        } else {
            revert USDOExpressTokenNotSupported(token);
        }
    }

    function convertToUnderlying(address token, uint256 usdoAmt) public view returns (uint256 amt) {
        if (token == address(0)) revert USDOExpressZeroAddress();
        if (token == _usdc) {
            // Directly scale USDO to USDC
            amt = usdoAmt / _SCALE_FACTOR;
        } else if (token == _tbill) {
            // Scale USDO to USDC, then convert to TBILL
            uint256 usdcAmt = usdoAmt / _SCALE_FACTOR;
            amt = convertUsdcToTbill(usdcAmt);
        } else {
            revert USDOExpressTokenNotSupported(token);
        }
    }

    function updateTreasury(address treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasury == address(0)) revert USDOExpressZeroAddress();
        _treasury = treasury;
        emit UpdateTreasury(treasury);
    }

    function updateBuidlTreasury(address bTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bTreasury == address(0)) revert USDOExpressZeroAddress();
        _buidlTreasury = bTreasury;
        emit UpdateBuidlTreasury(bTreasury);
    }

    function updateFeeTo(address feeTo) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeTo == address(0)) revert USDOExpressZeroAddress();
        _feeTo = feeTo;
        emit UpdateFeeTo(feeTo);
    }

    function txsFee(uint256 amt, TxType txType) public view returns (uint256 fee) {
        uint256 feeRate = txType == TxType.MINT ? _mintFeeRate : _redeemFeeRate;
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

    function previewRedeem(uint256 amt) public view returns (uint256 tbillAmt, uint256 feeAmt, uint256 usdcAmt) {
        if (_tbill != address(0)) {
            tbillAmt = convertToUnderlying(_tbill, amt);
        }

        uint256 feeInUsdo = txsFee(amt, TxType.REDEEM);
        feeAmt = convertToUnderlying(_usdc, feeInUsdo);
        usdcAmt = convertToUnderlying(_usdc, amt - feeInUsdo);
    }

    function convertTbillToUsdc(uint256 amt) public view returns (uint256) {
        return amt.mulDiv(ITBILL(_tbill).tbillUsdcRate(), _DECIMALS);
    }

    function convertUsdcToTbill(uint256 amt) public view returns (uint256) {
        return amt.mulDiv(_DECIMALS, ITBILL(_tbill).tbillUsdcRate());
    }

    function setBuidl(address buidl, address buidlRedemption) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _buidl = IERC20Upgradeable(buidl);
        _buidlRedemption = IBuidlRedemption(buidlRedemption);
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
     * @notice Check the available liquidity for instant redeem.
     * @return liquidity The available liquidity in USDC.
     * @return tAllowance The BUIDL allowance for the vault.
     * @return tBalance The BUIDL balance in the Treasury.
     */
    function checkLiquiditySelf()
        public
        view
        returns (uint256 liquidity, uint256 tAllowance, uint256 tBalance, uint256 minimum)
    {
        address settlement = IBuidlRedemption(_buidlRedemption).settlement();
        liquidity = IBuidlSettlement(settlement).availableLiquidity();

        tAllowance = _buidl.allowance(_buidlTreasury, address(this));
        tBalance = _buidl.balanceOf(_buidlTreasury);

        minimum = liquidity.min(tAllowance.min(tBalance));
    }

    /**
     * @notice Update the mint status of the account.
     */
    function updateFirstDeposit(address account, bool flag) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _firstDeposit[account] = flag;
        emit UpdateFirstDeposit(account, flag);
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
     * @notice Set the total supply cap.
     */
    function setTotalSupplyCap(uint256 totalSupplyCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setTotalSupplyCap(totalSupplyCap);
    }

    /**
     * @notice Set the mint minimum in USDC/TBILL.
     * @dev with 6 decimals
     */
    function setMintMinimum(uint256 mintMinimum) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMintMinimum(mintMinimum);
    }

    /**
     * @notice Set the mint limit for a certain duration in seconds, etc 8400s.
     */
    function setMintDuration(uint256 mintDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMintDuration(mintDuration);
    }

    /**
     * @notice Set the mint limit for a certain duration in seconds.
     */
    function setMintLimit(uint256 mintLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMintLimit(mintLimit);
    }

    /**
     * @notice Set the redeem minimum in USDO.
     * @dev with 18 decimals
     */
    function setRedeemMinimum(uint256 redeemMinimum) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRedeemMinimum(redeemMinimum);
    }

    /**
     * @notice Set the redeem duration for a certain duration in seconds, etc 8400s.
     */
    function setRedeemDuration(uint256 redeemDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRedeemDuration(redeemDuration);
    }

    /**
     * @notice Set the redeem limit for a certain duration in seconds.
     */
    function setRedeemLimit(uint256 redeemLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setRedeemLimit(redeemLimit);
    }

    /**
     * @notice Set the first deposit amount for the account.
     * @param amount The amount of the first deposit.
     */
    function setFirstDepositAmount(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
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
}
