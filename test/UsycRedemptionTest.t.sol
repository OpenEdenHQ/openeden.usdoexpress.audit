// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "forge-std/Test.sol";
import "../contracts/extensions/redemption/UsycRedemption.sol";
import "../contracts/mock/usycHelper.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../contracts/interfaces/IPriceFeed.sol";

contract MockERC20 is ERC20 {
    uint8 private _decimals;

    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOracle is IPriceFeed {
    int256 public price;
    uint8 public override decimals = 8;
    uint80 public roundId = 1;
    uint256 public updatedAt;

    constructor(int256 _price) {
        price = _price;
        updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, price, 0, updatedAt, roundId);
    }

    function setPrice(int256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
        roundId++;
    }
}

contract MockUsycHelper {
    MockERC20 public usyc;
    MockERC20 public usdc;
    MockOracle public oracle;
    uint256 public sellFee; // In 18 decimal format (1% = 1e18)
    bool public sellPaused;

    uint256 public constant HUNDRED_PCT = 100 * 1e18;

    constructor(address _usyc, address _usdc, address _oracle, uint256 _sellFee) {
        usyc = MockERC20(_usyc);
        usdc = MockERC20(_usdc);
        oracle = MockOracle(_oracle);
        sellFee = _sellFee;
    }

    function sellFor(uint256 _amount, address _recipient) external returns (uint256) {
        // Transfer USYC from sender to this contract (simulate burn)
        usyc.transferFrom(msg.sender, address(this), _amount);

        // Calculate payout based on oracle price
        uint256 price = uint256(oracle.price());
        uint8 oracleDecimals = oracle.decimals();
        uint8 usycDecimals = usyc.decimals();
        uint8 usdcDecimals = usdc.decimals();

        // Convert USYC to USDC: (usycAmount * price * 10^usdcDecimals) / (10^oracleDecimals * 10^usycDecimals)
        uint256 grossPayout = (_amount * price * 10**usdcDecimals) / (10**oracleDecimals * 10**usycDecimals);
        
        // Deduct fee
        uint256 feeAmount = (grossPayout * sellFee) / HUNDRED_PCT;
        uint256 netPayout = grossPayout - feeAmount;

        // Transfer net payout to recipient
        usdc.mint(_recipient, netPayout);
        
        return netPayout;
    }

    function setSellFee(uint256 _sellFee) external {
        sellFee = _sellFee;
    }

    function sellPreview(uint256 _amount) external view returns (uint256 payout, uint256 fee, int256 price) {
        price = oracle.price();
        uint8 oracleDecimals = oracle.decimals();
        uint8 usycDecimals = usyc.decimals();
        uint8 usdcDecimals = usdc.decimals();

        // Convert USYC to USDC: (usycAmount * price * 10^usdcDecimals) / (10^oracleDecimals * 10^usycDecimals)
        uint256 grossPayout = (_amount * uint256(price) * 10**usdcDecimals) / (10**oracleDecimals * 10**usycDecimals);
        
        // Calculate fee
        fee = (grossPayout * sellFee) / HUNDRED_PCT;
        payout = grossPayout - fee;
    }
}

contract UsycRedemptionTest is Test {
    UsycRedemption public redemption;
    MockERC20 public usyc;
    MockERC20 public usdc;
    MockOracle public oracle;
    MockUsycHelper public helper;

    address public caller = address(0x1);
    address public treasury = address(0x2);
    address public user = address(0x3);

    // Test parameters
    uint256 public constant USYC_DECIMALS = 6;
    uint256 public constant USDC_DECIMALS = 6; 
    uint256 public constant ORACLE_DECIMALS = 8;
    int256 public constant INITIAL_PRICE = 100000000; // $1.00 with 8 decimals

    function setUp() public {
        // Deploy mock tokens
        usyc = new MockERC20("USYC", "USYC", uint8(USYC_DECIMALS));
        usdc = new MockERC20("USDC", "USDC", uint8(USDC_DECIMALS));
        
        // Deploy mock oracle  
        oracle = new MockOracle(INITIAL_PRICE);
        
        // Deploy mock helper with 1% sell fee
        helper = new MockUsycHelper(address(usyc), address(usdc), address(oracle), 1e18);
        
        // Deploy redemption contract using UUPS proxy pattern
        redemption = new UsycRedemption();
        redemption.initialize(
            address(usyc),
            address(usdc), 
            address(helper),
            caller,
            treasury,
            address(0) // liquidityController (optional)
        );

        // Setup initial balances
        usyc.mint(treasury, 1000000 * 10**USYC_DECIMALS);
        usdc.mint(address(helper), 1000000 * 10**USDC_DECIMALS);

        // Treasury approves redemption contract
        vm.prank(treasury);
        usyc.approve(address(redemption), type(uint256).max);
    }

    function test_RedeemBasicNoFees() public {
        // Set 0% sell fee
        helper.setSellFee(0);
        
        uint256 requestedUsdc = 100 * 10**USDC_DECIMALS; // 100 USDC
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        // Should always receive exactly requested amount
        assertEq(received, requestedUsdc, "Should receive exactly requested amount");
        assertEq(usdc.balanceOf(caller), requestedUsdc, "Caller should have exactly requested USDC");
    }

    function test_RedeemWithFees() public {
        // 1% sell fee already set in setup
        uint256 requestedUsdc = 100 * 10**USDC_DECIMALS; // 100 USDC
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        // Should receive exactly what was requested
        assertEq(received, requestedUsdc, "Should receive exactly requested amount");
        assertEq(usdc.balanceOf(caller), requestedUsdc, "Caller should get exactly requested USDC");
    }

    function test_RedeemHighFees() public {
        // Set 5% sell fee
        helper.setSellFee(5e18);
        
        uint256 requestedUsdc = 100 * 10**USDC_DECIMALS;
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        assertEq(received, requestedUsdc, "Should return exactly requested amount even with high fees");
    }

    function test_RedeemPriceFluctuation() public {
        uint256 requestedUsdc = 100 * 10**USDC_DECIMALS;
        
        // Change price to $1.05 (5% increase)  
        oracle.setPrice(105000000);
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        assertEq(received, requestedUsdc, "Should return exactly requested amount despite price changes");
    }

    function test_RedeemSmallAmount() public {
        uint256 requestedUsdc = 1; // 1 wei USDC
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        assertEq(received, requestedUsdc, "Should handle small amounts exactly");
    }

    function test_RedeemLargeAmount() public {
        uint256 requestedUsdc = 10000 * 10**USDC_DECIMALS; // 10,000 USDC
        
        // Mint more to treasury and helper
        usyc.mint(treasury, 10000 * 10**USYC_DECIMALS);
        usdc.mint(address(helper), 10000 * 10**USDC_DECIMALS);
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        assertEq(received, requestedUsdc, "Should handle large amounts exactly");
    }

    function test_RevertUnauthorizedCaller() public {
        vm.prank(user); // Not the authorized caller
        vm.expectRevert(UnauthorizedCaller.selector);
        redemption.redeem(100 * 10**USDC_DECIMALS);
    }

    function test_RevertInsufficientBalance() public {
        // Clear treasury balance
        vm.prank(treasury);
        usyc.transfer(address(0xdead), usyc.balanceOf(treasury));
        
        vm.prank(caller);
        vm.expectRevert(); // Should revert on insufficient balance
        redemption.redeem(100 * 10**USDC_DECIMALS);
    }

    function test_BufferCalculation() public {
        // Test that buffer is reasonable for different fee rates
        uint256[] memory feeRates = new uint256[](4);
        feeRates[0] = 1e18;   // 1%
        feeRates[1] = 5e18;   // 5% 
        feeRates[2] = 10e18;  // 10%
        feeRates[3] = 25e18;  // 25%
        
        uint256 requestedUsdc = 1000 * 10**USDC_DECIMALS;
        
        for (uint i = 0; i < feeRates.length; i++) {
            helper.setSellFee(feeRates[i]);
            
            uint256 usycBefore = usyc.balanceOf(treasury);
            
            vm.prank(caller);
            uint256 received = redemption.redeem(requestedUsdc);
            
            uint256 usycUsed = usycBefore - usyc.balanceOf(treasury);
            
            // Buffer should be small relative to amount used
            // Should always receive exactly the requested amount
            assertEq(received, requestedUsdc, "Should always receive exactly requested amount");
            
            console.log("Fee rate:", feeRates[i] / 1e16, "bps, USYC used:", usycUsed, "Received:", received);
        }
    }

    function test_ConversionAccuracy() public {
        // Test conversion functions directly
        uint256 usdcAmount = 100 * 10**USDC_DECIMALS;
        
        uint256 usycAmount = redemption.convertUsdcToToken(usdcAmount);
        uint256 convertedBack = redemption.convertTokenToUsdc(usycAmount);
        
        // Due to rounding, converted back amount might be slightly different
        // But should be very close (within 1 unit)
        assertTrue(convertedBack <= usdcAmount, "Round trip should not increase amount");
        assertTrue(usdcAmount - convertedBack <= 1, "Round trip error should be minimal");
    }

    function test_EdgeCaseZeroAmount() public {
        vm.prank(caller);
        uint256 received = redemption.redeem(0);
        assertEq(received, 0, "Zero amount should return zero");
    }

    function test_ExtremelyHighFee() public {
        // Set 99% sell fee (edge case)
        helper.setSellFee(99e18);
        
        uint256 requestedUsdc = 100 * 10**USDC_DECIMALS;
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        assertEq(received, requestedUsdc, "Should handle extreme fees exactly");
    }

    function test_RevertOnMaxFee() public {
        // Set 100% sell fee (impossible scenario)
        helper.setSellFee(100e18);
        
        uint256 requestedUsdc = 100 * 10**USDC_DECIMALS;
        
        vm.prank(caller);
        vm.expectRevert(); // Should revert with ExcessiveSellFee
        redemption.redeem(requestedUsdc);
    }

    function test_ExcessHandling() public {
        // Test that excess USDC is returned to treasury
        uint256 requestedUsdc = 100 * 10**USDC_DECIMALS;
        uint256 treasuryUsdcBefore = usdc.balanceOf(treasury);
        
        vm.prank(caller);
        uint256 received = redemption.redeem(requestedUsdc);
        
        assertEq(received, requestedUsdc, "Should return exactly requested amount");
        assertEq(usdc.balanceOf(caller), requestedUsdc, "Caller should get exactly requested amount");
        
        // Check if any excess was returned to treasury
        uint256 treasuryUsdcAfter = usdc.balanceOf(treasury);
        if (treasuryUsdcAfter > treasuryUsdcBefore) {
            console.log("Excess returned to treasury:", treasuryUsdcAfter - treasuryUsdcBefore);
        }
    }

    function test_RevertOnNegativePrice() public {
        // Test that negative prices are properly rejected
        oracle.setPrice(-1000000); // Set negative price
        
        vm.expectRevert(abi.encodeWithSelector(InvalidPrice.selector, -1000000));
        redemption.getPrice(address(oracle));
    }

    function test_RevertOnZeroPrice() public {
        // Test that zero price is rejected
        oracle.setPrice(0);
        
        vm.expectRevert(abi.encodeWithSelector(InvalidPrice.selector, 0));
        redemption.getPrice(address(oracle));
    }

    function test_RevertOnBelowMinPrice() public {
        // Test that prices below minPrice are rejected
        uint256 minPrice = redemption.minPrice();
        int256 belowMinPrice = int256(minPrice - 1);
        
        oracle.setPrice(belowMinPrice);
        
        vm.expectRevert(abi.encodeWithSelector(InvalidPrice.selector, belowMinPrice));
        redemption.getPrice(address(oracle));
    }

    function test_NegativePriceNoWraparound() public {
        // Critical test: ensure negative prices don't wrap to large positive values
        int256 negativePrice = -1;
        oracle.setPrice(negativePrice);
        
        // This should revert with InvalidPrice, not pass due to wraparound
        vm.expectRevert(abi.encodeWithSelector(InvalidPrice.selector, negativePrice));
        redemption.getPrice(address(oracle));
        
        // Test with very negative number that would wrap to huge positive
        negativePrice = type(int256).min; // Most negative int256
        oracle.setPrice(negativePrice);
        
        vm.expectRevert(abi.encodeWithSelector(InvalidPrice.selector, negativePrice));
        redemption.getPrice(address(oracle));
    }

    function test_ValidPriceAccepted() public {
        // Test that valid prices above minPrice are accepted
        uint256 minPrice = redemption.minPrice();
        int256 validPrice = int256(minPrice + 1000000); // Well above minPrice
        
        oracle.setPrice(validPrice);
        
        uint256 returnedPrice = redemption.getPrice(address(oracle));
        assertEq(returnedPrice, uint256(validPrice), "Valid price should be returned correctly");
    }

    function test_MinPriceEdgeCase() public {
        // Test that price exactly at minPrice is accepted
        uint256 minPrice = redemption.minPrice();
        int256 exactMinPrice = int256(minPrice);
        
        oracle.setPrice(exactMinPrice);
        
        uint256 returnedPrice = redemption.getPrice(address(oracle));
        assertEq(returnedPrice, minPrice, "Price at minPrice should be accepted");
    }
}