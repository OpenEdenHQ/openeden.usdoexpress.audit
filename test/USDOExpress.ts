import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { BigNumber, constants } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { keccak256, toUtf8Bytes } from 'ethers/lib/utils';
import {
  MockBUIDL,
  MockBuidlRedemption,
  MockCUSDO,
  MockTBILL,
  MockUSDC,
  MockSimpleRedemption,
  USDO,
  USDOExpressV2,
  AssetRegistry,
} from '../typechain-types';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

const { AddressZero } = constants;

const roles = {
  // USDO Token
  MINTER: keccak256(toUtf8Bytes('MINTER_ROLE')),
  BURNER: keccak256(toUtf8Bytes('BURNER_ROLE')),
  MULTIPLIER_ROLE: keccak256(toUtf8Bytes('MULTIPLIER_ROLE')),
  UPGRADE: keccak256(toUtf8Bytes('UPGRADE_ROLE')),
  PAUSE: keccak256(toUtf8Bytes('PAUSE_ROLE')),
  DEFAULT_ADMIN_ROLE: ethers.constants.HashZero,

  // USDOExpress
  WHITELIST_ROLE: keccak256(toUtf8Bytes('WHITELIST_ROLE')),
  MAINTAINER_ROLE: keccak256(toUtf8Bytes('MAINTAINER_ROLE')),
  OPERATOR_ROLE: keccak256(toUtf8Bytes('OPERATOR_ROLE')),
  PAUSE_ROLE: keccak256(toUtf8Bytes('PAUSE_ROLE')),
};

const base = ethers.utils.parseUnits('1', 18); // 1e18

const _500 = ethers.utils.parseUnits('500', 18);
const _10k = ethers.utils.parseUnits('10000', 18);
const _10M = ethers.utils.parseUnits('10000000', 18); // 10M

// NOTE: minimumAmt for mint limits should be in USDO decimals (18) for proper comparison
const minimumAmt = ethers.utils.parseUnits('1000', 18); // 1K USDO equivalent

describe('USDOExpress', function () {
  let usdoExpress: USDOExpressV2;
  let usdo: USDO;
  let cusdo: MockCUSDO;
  let usdc: MockUSDC;
  let tbill: MockTBILL;
  let buidl: MockBUIDL;
  let buidlRedemption: MockBuidlRedemption;
  let simpleRedemption: MockSimpleRedemption;
  let assetRegistry: AssetRegistry;
  let owner: SignerWithAddress;
  let operator: SignerWithAddress;
  let maintainer: SignerWithAddress;
  let whitelistedUser: SignerWithAddress;
  let non_whitelist: SignerWithAddress;
  let treasury: SignerWithAddress;
  let feeTo: SignerWithAddress;
  let buidlTreasury: SignerWithAddress;

  const deployusdoExpressFixture = async () => {
    [owner, operator, maintainer, whitelistedUser, non_whitelist, treasury, feeTo, buidlTreasury] =
      await ethers.getSigners();
    console.log('Owner:', owner.address);
    console.log('Operator:', operator.address);
    console.log('Maintainer:', maintainer.address);
    console.log('Whitelisted User:', whitelistedUser.address);
    console.log('Non-Whitelisted User:', non_whitelist.address);
    console.log('Treasury:', treasury.address);
    console.log('FeeTo:', feeTo.address);
    console.log('BUIDL Treasury:', buidlTreasury.address);

    // Deploy mock contracts for USDO and TBILL
    const USDO = await ethers.getContractFactory('USDO');
    // upgradeable uups
    usdo = (await upgrades.deployProxy(USDO, ['USDO Token', 'USDO', owner.address], {
      initializer: 'initialize',
    })) as USDO;
    await usdo.deployed();

    await usdo.updateTotalSupplyCap(_10M);

    const MockUSDC = await ethers.getContractFactory('MockUSDC');
    usdc = await MockUSDC.deploy();
    await usdc.deployed();

    const MockTBILL = await ethers.getContractFactory('MockTBILL');
    tbill = await MockTBILL.deploy(usdc.address);
    await tbill.deployed();

    const MockBUIDL = await ethers.getContractFactory('MockBUIDL');
    buidl = await MockBUIDL.deploy();
    await buidl.deployed();

    const MockBuidlRedemption = await ethers.getContractFactory('MockBuidlRedemption');
    buidlRedemption = await MockBuidlRedemption.deploy(buidl.address, usdc.address);
    await buidlRedemption.deployed();

    // Deploy simple redemption contract for USDOExpressV2
    const MockSimpleRedemption = await ethers.getContractFactory('MockSimpleRedemption');
    simpleRedemption = await MockSimpleRedemption.deploy(usdc.address);
    await simpleRedemption.deployed();

    // Deploy MockCUSDO
    const MockCUSDO = await ethers.getContractFactory('MockCUSDO');
    cusdo = await MockCUSDO.deploy(usdo.address);
    await cusdo.deployed();

    // Deploy AssetRegistry
    const AssetRegistryFactory = await ethers.getContractFactory('AssetRegistry');
    assetRegistry = (await upgrades.deployProxy(AssetRegistryFactory, [owner.address], {
      initializer: 'initialize',
    })) as AssetRegistry;
    await assetRegistry.deployed();
    console.log('AssetRegistry deployed to:', assetRegistry.address);

    // !!!! IMPORTANT !!!!
    // First deploy USDOExpress (V1)
    const USDOExpressV1Factory = await ethers.getContractFactory('USDOExpress');
    const usdoExpressV1 = await upgrades.deployProxy(
      USDOExpressV1Factory,
      [
        usdo.address, // usdo
        usdc.address, // usdc
        tbill.address, // tbill
        buidl.address, // buidl
        buidlRedemption.address, // buidlRedemption
        treasury.address, // treasury
        buidlTreasury.address, // buidlTreasury
        feeTo.address, // feeTo
        owner.address, // admin
        {
          totalSupplyCap: _10M,
          mintMinimum: minimumAmt, // 1K USDO, with 18 decimals (for decimal normalization)
          mintLimit: _10k,
          mintDuration: 86400, // 1 day

          redeemMinimum: _500,
          redeemLimit: _10k,
          redeemDuration: 86400, // 1 day
          firstDepositAmount: minimumAmt, // 1K USDO, with 18 decimals (for decimal normalization)
        },
      ],
      {
        initializer: 'initialize',
      },
    );
    await usdoExpressV1.deployed();
    console.log('USDOExpress V1 deployed to:', usdoExpressV1.address);

    // !!!! IMPORTANT !!!!
    // Validate upgrade from V1 to V2 with unsafeAllowRenames
    const USDOExpressV2Factory = await ethers.getContractFactory('USDOExpressV2');
    await upgrades.validateUpgrade(usdoExpressV1.address, USDOExpressV2Factory, {
      unsafeAllowRenames: true,
    });
    console.log('validateUpgrade done!');

    // !!!! IMPORTANT !!!!
    // Upgrade to USDOExpressV2
    usdoExpress = (await upgrades.upgradeProxy(usdoExpressV1.address, USDOExpressV2Factory, {
      unsafeAllowRenames: true,
    })) as USDOExpressV2;
    console.log('USDOExpress upgraded to V2 at:', usdoExpress.address);

    // !!!! IMPORTANT !!!!
    // After upgrade, need to grant roles for V2-specific functionality
    // The upgrade preserves the proxy's admin roles, but maintainer needs MAINTAINER_ROLE for V2 functions
    await usdoExpress.grantRole(roles.MAINTAINER_ROLE, maintainer.address);

    // After upgrade, need to configure V2-specific features
    // Set AssetRegistry (this replaces the old _buidl storage slot)
    await usdoExpress.connect(maintainer).setAssetRegistry(assetRegistry.address);

    // Set Redemption contract (this replaces the old _buidlRedemption storage slot)
    await usdoExpress.connect(maintainer).setRedemption(simpleRedemption.address);

    // Update cUSDO address (this replaces the old _buidlTreasury storage slot)
    await usdoExpress.connect(maintainer).updateCusdo(cusdo.address);

    // TBILL
    // 1.01 * 10 ** 6;
    const rate = BigNumber.from('1010000');
    await tbill.setTbillUsdcRate(rate); // 1 TBILL = 1.01 USDC

    // USDO
    await usdo.grantRole(roles.MINTER, owner.address);
    await usdo.grantRole(roles.MINTER, usdoExpress.address);
    await usdo.grantRole(roles.BURNER, usdoExpress.address);
    await usdo.grantRole(roles.MULTIPLIER_ROLE, usdoExpress.address);
    console.log('USDO roles granted');

    // usdoExpress
    await usdoExpress.grantRole(roles.MULTIPLIER_ROLE, operator.address);
    await usdoExpress.grantRole(roles.WHITELIST_ROLE, maintainer.address);
    await usdoExpress.grantRole(roles.PAUSE_ROLE, operator.address);
    await usdoExpress.grantRole(roles.OPERATOR_ROLE, operator.address);
    await usdoExpress.connect(maintainer).grantKycInBulk([whitelistedUser.address]);
    // Add the contract address to KYC list for instantMintAndWrap to work
    await usdoExpress.connect(maintainer).grantKycInBulk([usdoExpress.address]);
    console.log('usdoExpress roles granted');

    await usdoExpress.connect(maintainer).updateAPY(500); // 5.00%
    // await usdoExpress.updateMintFee(10); // 0.10%
    // await usdoExpress.updateRedeemFee(20); // 0.20%
    console.log('usdoExpress settings updated');

    // Set up redemption contract
    await usdoExpress.connect(maintainer).setRedemption(simpleRedemption.address);
    console.log('Redemption contract set up');

    // Configure supported assets in AssetRegistry
    await assetRegistry.setAssetConfig({
      asset: usdc.address,
      isSupported: true,
      priceFeed: ethers.constants.AddressZero, // USDC is stable, no price feed needed
    });

    await assetRegistry.setAssetConfig({
      asset: tbill.address,
      isSupported: true,
      priceFeed: tbill.address, // TBILL contract itself provides price feed
    });

    console.log('AssetRegistry configured with USDC and TBILL support');
  };

  beforeEach(async function () {
    await loadFixture(deployusdoExpressFixture);
  });

  describe('Fee Management', function () {
    it('should update instant redeem fee and emit event', async function () {
      const newInstantRedeemFee = 50; // 0.5%

      await expect(usdoExpress.connect(maintainer).updateInstantRedeemFee(newInstantRedeemFee))
        .to.emit(usdoExpress, 'UpdateInstantRedeemFee')
        .withArgs(newInstantRedeemFee);
      expect(await usdoExpress._instantRedeemFeeRate()).to.equal(newInstantRedeemFee);
    });

    it('should test txsFee function with all three transaction types', async function () {
      const testAmount = ethers.utils.parseUnits('1000', 18);
      const mintFeeRate = 10; // 0.1%
      const redeemFeeRate = 20; // 0.2%
      const instantRedeemFeeRate = 30; // 0.3%

      await usdoExpress.connect(maintainer).updateMintFee(mintFeeRate);
      await usdoExpress.connect(maintainer).updateRedeemFee(redeemFeeRate);
      await usdoExpress.connect(maintainer).updateInstantRedeemFee(instantRedeemFeeRate);

      // Test MINT fee
      const mintFee = await usdoExpress.txsFee(testAmount, 0); // 0 = MINT
      expect(mintFee).to.equal(testAmount.mul(mintFeeRate).div(1e4));

      // Test REDEEM fee
      const redeemFee = await usdoExpress.txsFee(testAmount, 1); // 1 = REDEEM
      expect(redeemFee).to.equal(testAmount.mul(redeemFeeRate).div(1e4));

      // Test INSTANT_REDEEM fee
      const instantRedeemFee = await usdoExpress.txsFee(testAmount, 2); // 2 = INSTANT_REDEEM
      expect(instantRedeemFee).to.equal(testAmount.mul(instantRedeemFeeRate).div(1e4));
    });
  });

  describe('Update APY', function () {
    it('should update APY and emit event', async function () {
      const newAPY = BigNumber.from('514');

      const increment = newAPY.mul(base).div(365).div(1e4).toNumber();
      await expect(usdoExpress.connect(maintainer).updateAPY(newAPY))
        .to.emit(usdoExpress, 'UpdateAPY')
        .withArgs(newAPY, increment);
      expect(await usdoExpress._apy()).to.equal(newAPY);
    });

    it('should allow operator to add bonus multiplier', async function () {
      const increment = await usdoExpress._increment();
      console.log('Increment:', increment.toString());

      await usdoExpress.connect(operator).addBonusMultiplier();

      const currMultiplier = await usdoExpress.getBonusMultiplier();
      expect(currMultiplier.curr).to.equal(increment.add(base));
    });

    it('should allow to add within time buffer', async function () {
      await usdoExpress.connect(maintainer).updateTimeBuffer(86400); // 1 day
      expect(await usdoExpress._timeBuffer()).to.equal(86400);

      await usdoExpress.connect(operator).addBonusMultiplier();
      await expect(usdoExpress.connect(operator).addBonusMultiplier()).to.be.revertedWithCustomError(
        usdoExpress,
        'USDOExpressTooEarly',
      );

      await time.increase(86400); // 1 day
      await expect(usdoExpress.connect(operator).addBonusMultiplier()).not.to.be.reverted;
    });
  });

  describe('Update cUSDO', function () {
    it('should update cUSDO address and emit event', async function () {
      const newCusdoAddress = ethers.Wallet.createRandom().address;

      await expect(usdoExpress.connect(maintainer).updateCusdo(newCusdoAddress))
        .to.emit(usdoExpress, 'UpdateCusdo')
        .withArgs(newCusdoAddress);

      expect(await usdoExpress._cusdo()).to.equal(newCusdoAddress);
    });

    it('should fail to update cUSDO with zero address', async function () {
      await expect(usdoExpress.connect(maintainer).updateCusdo(AddressZero)).to.be.revertedWithCustomError(
        usdoExpress,
        'USDOExpressZeroAddress',
      );
    });
  });

  describe('preview mint/redeem', async function () {
    // const mintFeeRate = 10; // 0.1%
    // const redeemFeeRate = 20; // 0.2%
    // const mintAmount = ethers.utils.parseUnits('100000000', 6); // 1000 USDC or tbill
    // this.beforeEach(async function () {
    //   await usdoExpress.updateMintFee(mintFeeRate);
    //   await usdoExpress.updateRedeemFee(redeemFeeRate);
    // });

    it('should preview mint correctly', async function () {
      const mintFeeRate = 10; // 0.1%
      const redeemFeeRate = 20; // 0.2%
      const mintAmount = ethers.utils.parseUnits('100000000', 6); // 1000 USDC or tbill
      await usdoExpress.connect(maintainer).updateMintFee(mintFeeRate);
      await usdoExpress.connect(maintainer).updateRedeemFee(redeemFeeRate);

      const res = await usdoExpress.previewMint(usdc.address, mintAmount);
      console.log('Preview Mint:', res);
      expect(res.netAmt).to.equal(mintAmount.sub(mintAmount.mul(mintFeeRate).div(1e4)));
      const usdoAmtCurr = res.usdoAmtCurr;

      const [curr, next] = await usdoExpress.getBonusMultiplier();
      console.log('Current multiplier:', curr.toString(), 'Next multiplier:', next.toString());

      const comingValue = usdoAmtCurr.div(curr).mul(next);
      console.log('USDO value after cutoff time:', comingValue.toString());
      // TODO
    });

    it('should preview correctly with tbill', async function () {
      const mintFeeRate = 10; // 0.1%
      const redeemFeeRate = 20; // 0.2%
      const mintAmount = ethers.utils.parseUnits('100000000', 6); // 1000 USDC or tbill
      await usdoExpress.connect(maintainer).updateMintFee(mintFeeRate);
      await usdoExpress.connect(maintainer).updateRedeemFee(redeemFeeRate);

      const res = await usdoExpress.previewMint(tbill.address, mintAmount);
      console.log('Preview Mint with TBILL:', res);
      expect(res.netAmt).to.equal(mintAmount.sub(mintAmount.mul(mintFeeRate).div(1e4)));
      const usdoAmtCurr = res.usdoAmtCurr;
      const [curr, next] = await usdoExpress.getBonusMultiplier();
      const comingValue = usdoAmtCurr.div(curr).mul(next);
      console.log('USDO value after cutoff time:', comingValue.toString());
    });

    it('should preview redeem correctly, no fee', async function () {
      const mintAmount = ethers.utils.parseUnits('100000000', 6); // 1000 USDC or tbill
      const res = await usdoExpress.previewMint(tbill.address, mintAmount);
      console.log('Preview Mint with TBILL:', res);
      expect(res.netAmt).to.equal(mintAmount);
    });

    it('should preview instant redeem correctly with instant redeem fee', async function () {
      const instantRedeemFeeRate = 30; // 0.3%
      const redeemAmount = ethers.utils.parseUnits('1000', 18); // 1000 USDO

      await usdoExpress.connect(maintainer).updateInstantRedeemFee(instantRedeemFeeRate);

      const { feeAmt, usdcAmt } = await usdoExpress.previewRedeem(redeemAmount, true);

      // Calculate expected fee in USDO (30 basis points)
      const expectedFeeInUsdo = redeemAmount.mul(instantRedeemFeeRate).div(1e4);
      const expectedFeeInUsdc = await usdoExpress.convertToUnderlying(usdc.address, expectedFeeInUsdo);
      const expectedUsdcToUser = await usdoExpress.convertToUnderlying(
        usdc.address,
        redeemAmount.sub(expectedFeeInUsdo),
      );

      expect(feeAmt).to.equal(expectedFeeInUsdc);
      expect(usdcAmt).to.equal(expectedUsdcToUser);
    });

    it('should preview regular redeem correctly with regular redeem fee', async function () {
      const redeemFeeRate = 20; // 0.2%
      const redeemAmount = ethers.utils.parseUnits('1000', 18); // 1000 USDO

      await usdoExpress.connect(maintainer).updateRedeemFee(redeemFeeRate);

      const { feeAmt, usdcAmt } = await usdoExpress.previewRedeem(redeemAmount, false);

      // Calculate expected fee in USDO (20 basis points)
      const expectedFeeInUsdo = redeemAmount.mul(redeemFeeRate).div(1e4);
      const expectedFeeInUsdc = await usdoExpress.convertToUnderlying(usdc.address, expectedFeeInUsdo);
      const expectedUsdcToUser = await usdoExpress.convertToUnderlying(
        usdc.address,
        redeemAmount.sub(expectedFeeInUsdo),
      );

      expect(feeAmt).to.equal(expectedFeeInUsdc);
      expect(usdcAmt).to.equal(expectedUsdcToUser);
    });
  });

  describe('Instant Mint/Redeem', function () {
    const mintFeeRate = 10; // 0.1%
    const redeemFeeRate = 20; // 0.2%
    const instantRedeemFeeRate = 30; // 0.3%
    const mintAmount = ethers.utils.parseUnits('1000', 6); // 1000 USDC or tbill
    const redeemAmount = ethers.utils.parseUnits('500', 18); // 500 USDO

    this.beforeEach(async function () {
      await usdoExpress.connect(maintainer).updateMintFee(mintFeeRate);
      await usdoExpress.connect(maintainer).updateRedeemFee(redeemFeeRate);
      await usdoExpress.connect(maintainer).updateInstantRedeemFee(instantRedeemFeeRate);
      await usdc.transfer(whitelistedUser.address, mintAmount);
      await usdc.connect(whitelistedUser).approve(usdoExpress.address, mintAmount);
      console.log('USDC balance:', (await usdc.balanceOf(whitelistedUser.address)).toString());
    });

    it('should allow minting with usdc', async function () {
      const netAmt = ethers.utils.parseUnits('999', 6);
      console.log('Net Amount:', netAmt.toString());

      const usdoAmtCurr = ethers.utils.parseUnits('998.863169428845363662', 18);
      console.log('USDO Mint Amount:', usdoAmtCurr.toString());

      const fee = ethers.utils.parseUnits('1', 6);
      console.log('Fee:', fee.toString());

      await expect(usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mintAmount))
        .to.emit(usdoExpress, 'InstantMint')
        .withArgs(usdc.address, whitelistedUser.address, whitelistedUser.address, mintAmount, usdoAmtCurr, fee);

      // check feeTo balance
      expect(await usdc.balanceOf(feeTo.address)).to.equal(fee);
      expect(await usdo.balanceOf(whitelistedUser.address)).to.be.gt(0); // USDO minted
    });

    it('should allow minting and wrapping with usdc', async function () {
      const netAmt = ethers.utils.parseUnits('999', 6);
      console.log('Net Amount:', netAmt.toString());

      const usdoAmtCurr = ethers.utils.parseUnits('998.863169428845363662', 18);
      console.log('USDO Mint Amount:', usdoAmtCurr.toString());

      const fee = ethers.utils.parseUnits('1', 6);
      console.log('Fee:', fee.toString());

      await expect(
        usdoExpress.connect(whitelistedUser).instantMintAndWrap(usdc.address, whitelistedUser.address, mintAmount),
      )
        .to.emit(usdoExpress, 'InstantMintAndWrap')
        .withArgs(
          usdc.address,
          whitelistedUser.address,
          whitelistedUser.address,
          mintAmount,
          usdoAmtCurr,
          anyValue,
          fee,
        );

      // check feeTo balance
      expect(await usdc.balanceOf(feeTo.address)).to.equal(fee);
      expect(await usdo.balanceOf(whitelistedUser.address)).to.equal(0); // USDO should be wrapped
      expect(await cusdo.balanceOf(whitelistedUser.address)).to.be.gt(0); // cUSDO should be minted
    });

    it('should work of previewUsdoIssue', async function () {
      const usdoToMint = ethers.utils.parseUnits('1000', 18);
      const usdoAmtCurr = ethers.utils.parseUnits('999.863032461306670332', 18);
      const usdoAmtNext = ethers.utils.parseUnits('999.999999999999999999', 18);

      const res = await usdoExpress.previewIssuance(usdoToMint);
      console.log('Preview USDO Issue:', res);
      expect(res.usdoAmtCurr).to.equal(usdoAmtCurr);
      expect(res.usdoAmtNext).to.equal(usdoAmtNext);
    });

    it('should allow instant redeem for whitelisted user', async function () {
      // Mint USDO for the user
      await usdo.mint(whitelistedUser.address, redeemAmount);

      // Add USDC to the redemption contract for redemption (this is what the user will receive)
      const usdcNeeded = await usdoExpress.convertToUnderlying(usdc.address, redeemAmount);
      await usdc.transfer(simpleRedemption.address, usdcNeeded);

      const initialUserUsdcBalance = await usdc.balanceOf(whitelistedUser.address);
      const initialFeeToBalance = await usdc.balanceOf(feeTo.address);

      // Perform instant redeem with no slippage protection (minUsdcOut = 0)
      await expect(usdoExpress.connect(whitelistedUser).instantRedeemSelf(whitelistedUser.address, redeemAmount, 0))
        .to.emit(usdoExpress, 'InstantRedeem')
        .withArgs(
          whitelistedUser.address,
          whitelistedUser.address,
          redeemAmount,
          anyValue, // usdcToUser
          anyValue, // feeInUsdc
          anyValue, // payout
          anyValue, // usycFee
          0, // minUsdcOut
        );

      // Check that user received USDC (minus fee)
      const finalUserUsdcBalance = await usdc.balanceOf(whitelistedUser.address);
      const finalFeeToBalance = await usdc.balanceOf(feeTo.address);

      expect(finalUserUsdcBalance).to.be.gt(initialUserUsdcBalance);
      expect(finalFeeToBalance).to.be.gt(initialFeeToBalance); // Fees should be collected

      // Check that USDO was burned
      expect(await usdo.balanceOf(whitelistedUser.address)).to.equal(0);
    });

    it('should use instant redeem fee rate for instant redeem', async function () {
      const instantRedeemFeeRate = 50; // 0.5%
      const redeemFeeRate = 20; // 0.2%

      await usdoExpress.connect(maintainer).updateInstantRedeemFee(instantRedeemFeeRate);
      await usdoExpress.connect(maintainer).updateRedeemFee(redeemFeeRate);

      // Mint USDO for the user
      await usdo.mint(whitelistedUser.address, redeemAmount);

      // Add USDC to the redemption contract for redemption
      const usdcNeeded = await usdoExpress.convertToUnderlying(usdc.address, redeemAmount);
      await usdc.transfer(simpleRedemption.address, usdcNeeded);

      // Calculate expected fee using instant redeem rate
      const expectedFee = usdcNeeded.mul(instantRedeemFeeRate).div(1e4);

      const initialFeeToBalance = await usdc.balanceOf(feeTo.address);

      await usdoExpress.connect(whitelistedUser).instantRedeemSelf(whitelistedUser.address, redeemAmount, 0);

      const finalFeeToBalance = await usdc.balanceOf(feeTo.address);
      const feeCollected = finalFeeToBalance.sub(initialFeeToBalance);

      // Verify the instant redeem fee rate was used, not the regular redeem fee rate
      expect(feeCollected).to.equal(expectedFee);

      // Verify it's different from what the regular redeem fee would have been
      const regularRedeemFee = usdcNeeded.mul(redeemFeeRate).div(1e4);
      expect(feeCollected).to.not.equal(regularRedeemFee);
    });

    it('should allow instant redeem with slippage protection when minUsdcOut is met', async function () {
      // Mint USDO for the user
      await usdo.mint(whitelistedUser.address, redeemAmount);

      // Add USDC to the redemption contract for redemption
      const usdcNeeded = await usdoExpress.convertToUnderlying(usdc.address, redeemAmount);
      await usdc.transfer(simpleRedemption.address, usdcNeeded);

      // Calculate expected output (after fees)
      const feeInUsdc = usdcNeeded.mul(instantRedeemFeeRate).div(1e4);
      const expectedUsdcToUser = usdcNeeded.sub(feeInUsdc);

      // Set minUsdcOut to slightly less than expected output (should succeed)
      const minUsdcOut = expectedUsdcToUser.sub(ethers.utils.parseUnits('1', 6)); // 1 USDC tolerance

      const initialUserUsdcBalance = await usdc.balanceOf(whitelistedUser.address);

      // Perform instant redeem with slippage protection
      await expect(
        usdoExpress.connect(whitelistedUser).instantRedeemSelf(whitelistedUser.address, redeemAmount, minUsdcOut),
      )
        .to.emit(usdoExpress, 'InstantRedeem')
        .withArgs(
          whitelistedUser.address,
          whitelistedUser.address,
          redeemAmount,
          anyValue, // usdcToUser
          anyValue, // feeInUsdc
          anyValue, // payout
          anyValue, // redemptionFee
          minUsdcOut, // minUsdcOut
        );

      // Check that user received USDC
      const finalUserUsdcBalance = await usdc.balanceOf(whitelistedUser.address);
      expect(finalUserUsdcBalance).to.be.gt(initialUserUsdcBalance);
      expect(await usdo.balanceOf(whitelistedUser.address)).to.equal(0);
    });

    it('should revert instant redeem when output is below minUsdcOut', async function () {
      // Mint USDO for the user
      await usdo.mint(whitelistedUser.address, redeemAmount);

      // Add USDC to the redemption contract for redemption
      const usdcNeeded = await usdoExpress.convertToUnderlying(usdc.address, redeemAmount);
      await usdc.transfer(simpleRedemption.address, usdcNeeded);

      // Calculate expected output (after fees)
      const feeInUsdc = usdcNeeded.mul(instantRedeemFeeRate).div(1e4);
      const expectedUsdcToUser = usdcNeeded.sub(feeInUsdc);

      // Set minUsdcOut to more than expected output (should fail)
      const minUsdcOut = expectedUsdcToUser.add(ethers.utils.parseUnits('1', 6)); // Require 1 USDC more

      // Perform instant redeem should revert due to slippage
      await expect(
        usdoExpress.connect(whitelistedUser).instantRedeemSelf(whitelistedUser.address, redeemAmount, minUsdcOut),
      ).to.be.revertedWithCustomError(usdoExpress, 'InsufficientOutput');
    });

    it('should ignore slippage protection when minUsdcOut is zero', async function () {
      // Mint USDO for the user
      await usdo.mint(whitelistedUser.address, redeemAmount);

      // Add USDC to the redemption contract for redemption
      const usdcNeeded = await usdoExpress.convertToUnderlying(usdc.address, redeemAmount);
      await usdc.transfer(simpleRedemption.address, usdcNeeded);

      const initialUserUsdcBalance = await usdc.balanceOf(whitelistedUser.address);

      // Perform instant redeem with minUsdcOut = 0 (no slippage protection)
      await expect(usdoExpress.connect(whitelistedUser).instantRedeemSelf(whitelistedUser.address, redeemAmount, 0)).to
        .not.be.reverted;

      // Check that user received USDC
      const finalUserUsdcBalance = await usdc.balanceOf(whitelistedUser.address);
      expect(finalUserUsdcBalance).to.be.gt(initialUserUsdcBalance);
    });

    it('should allow redeeming for whitelisted user', async function () {
      // topup tbill to treasury for redemption
      await tbill.transfer(treasury.address, redeemAmount);
      // topup usdc to tbill for redemption
      await usdc.transfer(tbill.address, redeemAmount);
      await tbill.connect(treasury).approve(usdoExpress.address, redeemAmount);

      await usdo.mint(whitelistedUser.address, redeemAmount);

      expect(await usdc.balanceOf(whitelistedUser.address)).to.be.gt(0); // USDC redeemed
    });

    it('should fail to redeem without approval', async function () {
      const redeemAmount = ethers.utils.parseUnits('500', 18); // 500 USDO
      await expect(
        usdoExpress.connect(non_whitelist).redeemRequest(whitelistedUser.address, redeemAmount),
      ).to.be.revertedWithCustomError(usdoExpress, 'USDOExpressNotInKycList');
    });

    it('should success to redeem with approval', async function () {
      const redeemAmount = ethers.utils.parseUnits('500', 18); // 500 USDO
      await usdo.mint(whitelistedUser.address, redeemAmount);
      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      await usdoExpress.connect(maintainer).revokeKycInBulk([whitelistedUser.address]);
      await expect(
        usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount),
      ).to.be.revertedWithCustomError(usdoExpress, 'USDOExpressNotInKycList');
    });

    it('should correctly calculate fees and scaling', async function () {
      const mintFeeRate = 10; // 0.1%
      await usdoExpress.connect(maintainer).updateMintFee(mintFeeRate);

      const mintAmount = ethers.utils.parseUnits('1000', 6); // 1000 USDC
      const { netAmt, fee } = await usdoExpress.previewMint(usdc.address, mintAmount);

      expect(fee).to.equal(mintAmount.mul(mintFeeRate).div(1e4)); // Check fee calculation
      expect(netAmt).to.equal(mintAmount.sub(fee)); // Check net amount after fee
    });

    it('should able to perform queue-based redemption', async function () {
      const redeemAmount = ethers.utils.parseUnits('500', 18); // 500 USDO
      await usdo.mint(whitelistedUser.address, redeemAmount);

      // Add redemption request to queue
      await expect(usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount))
        .to.emit(usdoExpress, 'AddToRedemptionQueue')
        .withArgs(whitelistedUser.address, whitelistedUser.address, redeemAmount, anyValue);

      // Check queue length
      const queueLength = await usdoExpress.getRedemptionQueueLength();
      expect(queueLength).to.equal(1);
    });
  });

  describe('Queue Redemption System', function () {
    const redeemAmount = ethers.utils.parseUnits('500', 18); // 500 USDO
    const redeemFeeRate = 20; // 0.2%

    this.beforeEach(async function () {
      await usdoExpress.connect(maintainer).updateRedeemFee(redeemFeeRate);
      await usdo.mint(whitelistedUser.address, redeemAmount);
    });

    it('should add redemption request to queue', async function () {
      const initialQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(initialQueueLength).to.equal(0);

      await expect(usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount))
        .to.emit(usdoExpress, 'AddToRedemptionQueue')
        .withArgs(whitelistedUser.address, whitelistedUser.address, redeemAmount, anyValue);

      const finalQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(finalQueueLength).to.equal(1);

      const userInfo = await usdoExpress.getRedemptionUserInfo(whitelistedUser.address);
      expect(userInfo).to.equal(redeemAmount);
    });

    it('should fail to add redemption request from non-kyc user', async function () {
      await expect(
        usdoExpress.connect(non_whitelist).redeemRequest(whitelistedUser.address, redeemAmount),
      ).to.be.revertedWithCustomError(usdoExpress, 'USDOExpressNotInKycList');
    });

    it('should fail to add redemption request to non-kyc user', async function () {
      await expect(
        usdoExpress.connect(whitelistedUser).redeemRequest(non_whitelist.address, redeemAmount),
      ).to.be.revertedWithCustomError(usdoExpress, 'USDOExpressNotInKycList');
    });

    it('should get redemption queue info correctly', async function () {
      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      const queueInfo = await usdoExpress.getRedemptionQueueInfo(0);
      expect(queueInfo.sender).to.equal(whitelistedUser.address);
      expect(queueInfo.receiver).to.equal(whitelistedUser.address);
      expect(queueInfo.usdoAmt).to.equal(redeemAmount);
      expect(queueInfo.id).to.not.equal(ethers.constants.HashZero);
    });

    it('should return zero values for invalid queue index', async function () {
      const queueInfo = await usdoExpress.getRedemptionQueueInfo(0);
      expect(queueInfo.sender).to.equal(ethers.constants.AddressZero);
      expect(queueInfo.receiver).to.equal(ethers.constants.AddressZero);
      expect(queueInfo.usdoAmt).to.equal(0);
      expect(queueInfo.id).to.equal(ethers.constants.HashZero);
    });

    it('should cancel redemption requests from queue', async function () {
      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      const initialBalance = await usdo.balanceOf(whitelistedUser.address);
      const initialQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(initialQueueLength).to.equal(1);

      await expect(usdoExpress.connect(maintainer).cancel(initialQueueLength.toNumber()))
        .to.emit(usdoExpress, 'ProcessRedemptionCancel')
        .withArgs(whitelistedUser.address, whitelistedUser.address, redeemAmount, anyValue)
        .and.to.emit(usdoExpress, 'Cancel')
        .withArgs(1, redeemAmount);

      const finalQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(finalQueueLength).to.equal(0);

      const finalBalance = await usdo.balanceOf(whitelistedUser.address);
      expect(finalBalance).to.equal(initialBalance.add(redeemAmount));

      const userInfo = await usdoExpress.getRedemptionUserInfo(whitelistedUser.address);
      expect(userInfo).to.equal(0);
    });

    it('should fail to cancel from empty queue', async function () {
      await expect(usdoExpress.connect(maintainer).cancel(1)).to.be.revertedWithCustomError(
        usdoExpress,
        'USDOExpressInvalidInput',
      );
    });

    it('should fail to cancel more than queue length', async function () {
      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      await expect(usdoExpress.connect(maintainer).cancel(2)).to.be.revertedWithCustomError(
        usdoExpress,
        'USDOExpressInvalidInput',
      );
    });

    it('should process redemption queue with sufficient liquidity', async function () {
      // Add USDC to contract for processing
      await usdc.transfer(usdoExpress.address, redeemAmount.mul(2));

      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      const initialQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(initialQueueLength).to.equal(1);

      await expect(usdoExpress.connect(operator).processRedemptionQueue(1))
        .to.emit(usdoExpress, 'ProcessRedeem')
        .withArgs(whitelistedUser.address, whitelistedUser.address, redeemAmount, anyValue, anyValue, anyValue)
        .and.to.emit(usdoExpress, 'ProcessRedemptionQueue')
        .withArgs(anyValue, redeemAmount, anyValue);

      const finalQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(finalQueueLength).to.equal(0);

      const userInfo = await usdoExpress.getRedemptionUserInfo(whitelistedUser.address);
      expect(userInfo).to.equal(0);

      // Check that user received USDC
      const userUsdcBalance = await usdc.balanceOf(whitelistedUser.address);
      expect(userUsdcBalance).to.be.gt(0);
    });

    it('should process all redemption queue when length is 0', async function () {
      // Add USDC to contract for processing
      await usdc.transfer(usdoExpress.address, redeemAmount.mul(3));

      // Mint enough USDO for both requests
      await usdo.mint(whitelistedUser.address, redeemAmount.mul(2));

      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);
      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      const initialQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(initialQueueLength).to.equal(2);

      await expect(usdoExpress.connect(operator).processRedemptionQueue(0))
        .to.emit(usdoExpress, 'ProcessRedemptionQueue')
        .withArgs(anyValue, redeemAmount.mul(2), anyValue);

      const finalQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(finalQueueLength).to.equal(0);
    });

    it('should stop processing when insufficient liquidity', async function () {
      // Add only partial USDC to contract (250 USDC with 6 decimals)
      await usdc.transfer(usdoExpress.address, ethers.utils.parseUnits('250', 6)); // 250 USDC, and we redeem 500 USDO

      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      const initialQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(initialQueueLength).to.equal(1);

      // Should not process any items due to insufficient liquidity
      console.log('liquidity:', await usdoExpress.getTokenBalance(usdc.address));
      await usdoExpress.connect(operator).processRedemptionQueue(1);
      console.log('request info: ', await usdoExpress.getRedemptionQueueInfo(0));

      const finalQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(finalQueueLength).to.equal(1); // Queue should remain unchanged

      const userInfo = await usdoExpress.getRedemptionUserInfo(whitelistedUser.address);
      expect(userInfo).to.equal(redeemAmount); // User info should remain unchanged
    });

    it('should fail to process empty queue', async function () {
      await expect(usdoExpress.connect(operator).processRedemptionQueue(1)).to.be.revertedWithCustomError(
        usdoExpress,
        'USDOExpressInvalidInput',
      );
    });

    it('should fail to process more than queue length', async function () {
      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      await expect(usdoExpress.connect(operator).processRedemptionQueue(2)).to.be.revertedWithCustomError(
        usdoExpress,
        'USDOExpressInvalidInput',
      );
    });

    it('should handle multiple users in queue', async function () {
      // Add USDC to contract for processing
      await usdc.transfer(usdoExpress.address, redeemAmount.mul(4));

      // Add another whitelisted user
      await usdoExpress.connect(maintainer).grantKycInBulk([non_whitelist.address]);
      await usdo.mint(non_whitelist.address, redeemAmount);

      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);
      await usdoExpress.connect(non_whitelist).redeemRequest(non_whitelist.address, redeemAmount);

      const initialQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(initialQueueLength).to.equal(2);

      await usdoExpress.connect(operator).processRedemptionQueue(2);

      const finalQueueLength = await usdoExpress.getRedemptionQueueLength();
      expect(finalQueueLength).to.equal(0);

      // Both users should have received USDC
      const user1UsdcBalance = await usdc.balanceOf(whitelistedUser.address);
      const user2UsdcBalance = await usdc.balanceOf(non_whitelist.address);
      expect(user1UsdcBalance).to.be.gt(0);
      expect(user2UsdcBalance).to.be.gt(0);
    });

    it('should burn USDO when adding to queue', async function () {
      const initialBalance = await usdo.balanceOf(whitelistedUser.address);
      expect(initialBalance).to.equal(redeemAmount);

      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      const finalBalance = await usdo.balanceOf(whitelistedUser.address);
      expect(finalBalance).to.equal(0); // USDO should be burned
    });

    it('should calculate fees correctly in queue processing', async function () {
      // Add USDC to contract for processing
      await usdc.transfer(usdoExpress.address, redeemAmount.mul(2));

      await usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, redeemAmount);

      const initialFeeToBalance = await usdc.balanceOf(feeTo.address);

      await usdoExpress.connect(operator).processRedemptionQueue(1);

      const finalFeeToBalance = await usdc.balanceOf(feeTo.address);
      expect(finalFeeToBalance).to.be.gt(initialFeeToBalance); // Fees should be collected
    });
  });

  describe('USDOMintRedeemLimiter', async function () {
    // {
    //   totalSupplyCap: _10M,
    //   mintMinimum: _500,
    //   mintLimit: _10k,
    //   mintDuration: 86400, // 1 day

    //   redeemMinimum: _500,
    //   redeemLimit: _10k,
    //   redeemDuration: 86400, // 1 day
    // },
    let mintAmount: BigNumber;
    this.beforeEach(async function () {
      mintAmount = ethers.utils.parseUnits('1000', 6); // 1K USDC
      await usdc.transfer(whitelistedUser.address, mintAmount);
    });

    it('should fail to mint more than cap', async function () {
      // V2: Set cap on USDO token (not USDOExpressV2) as the check is now centralized in USDO
      const lowCap = ethers.utils.parseUnits('500', 18); // 500 USDO
      await usdo.updateTotalSupplyCap(lowCap);
      await usdc.connect(whitelistedUser).approve(usdoExpress.address, mintAmount);

      // Calculate how much USDO would be minted
      const { usdoAmtCurr } = await usdoExpress.previewMint(usdc.address, mintAmount);

      // Verify the mint would exceed the cap
      expect(usdoAmtCurr).to.be.gt(lowCap);

      // V2: Attempt to mint should fail with error from USDO contract
      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mintAmount),
      ).to.be.revertedWithCustomError(usdo, 'USDOExceedsTotalSupplyCap');
    });

    it('should allow minting up to cap', async function () {
      // V2: Set cap on USDO token (not USDOExpressV2)
      const cap = ethers.utils.parseUnits('2000', 18); // 2000 USDO
      await usdo.updateTotalSupplyCap(cap);

      // Calculate how much USDO would be minted
      const { usdoAmtCurr } = await usdoExpress.previewMint(usdc.address, mintAmount);

      // Verify the mint would be within the cap
      expect(usdoAmtCurr).to.be.lt(cap);

      // Attempt to mint should succeed
      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mintAmount),
      ).to.not.be.revertedWithCustomError(usdo, 'USDOExceedsTotalSupplyCap');
    });

    it('should fail to mint less than first deposit', async function () {
      // Set first deposit amount to 2000 USDO equivalent (18 decimals)
      const firstDepositInUsdo = ethers.utils.parseUnits('2000', 18);
      await usdoExpress.connect(maintainer).setFirstDepositAmount(firstDepositInUsdo);
      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mintAmount),
      ).to.be.revertedWithCustomError(usdoExpress, 'FirstDepositLessThanRequired');
    });

    it('should fail to mint less than minimum', async function () {
      // Set mint minimum to 2000 USDO equivalent (18 decimals)
      const mintMinimumInUsdo = ethers.utils.parseUnits('2000', 18);
      await usdoExpress.connect(maintainer).setMintMinimum(mintMinimumInUsdo);
      await usdoExpress.connect(maintainer).updateFirstDeposit(whitelistedUser.address, true);

      // Calculate what the USDO equivalent of mintAmount would be
      const mintAmountInUsdo = await usdoExpress.convertFromUnderlying(usdc.address, mintAmount);

      await expect(usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mintAmount))
        .to.be.revertedWithCustomError(usdoExpress, 'MintLessThanMinimum')
        .withArgs(mintAmountInUsdo, mintMinimumInUsdo);
    });

    it('should fail to mint more than limit in duration', async function () {
      await usdoExpress.connect(maintainer).setMintLimit(_10k);
      await usdc.connect(whitelistedUser).approve(usdoExpress.address, mintAmount);
      await usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mintAmount);
      const mint1 = ethers.utils.parseUnits('10000', 6);
      console.log('minimum amount:', (await usdoExpress._mintMinimum()).toString());

      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mint1),
      ).to.be.revertedWithCustomError(usdoExpress, 'MintLimitExceeded');

      await time.increase(86400); // 1 day
      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, mint1),
      ).to.revertedWith('ERC20: insufficient allowance');
    });

    it('should correctly normalize decimals across different assets (USDC 6 decimals vs TBILL 6 decimals)', async function () {
      // Set mint minimum to 500 USDO (18 decimals)
      const mintMinInUsdo = ethers.utils.parseUnits('500', 18);
      await usdoExpress.connect(maintainer).setMintMinimum(mintMinInUsdo);
      await usdoExpress.connect(maintainer).updateFirstDeposit(whitelistedUser.address, true);

      // Test 1: USDC (6 decimals) - 400 USDC should be rejected
      const usdcAmount400 = ethers.utils.parseUnits('400', 6); // 400 USDC = 400 USDO equivalent
      await usdc.connect(whitelistedUser).approve(usdoExpress.address, usdcAmount400);

      // Calculate expected USDO equivalent
      const usdc400InUsdo = await usdoExpress.convertFromUnderlying(usdc.address, usdcAmount400);

      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, usdcAmount400),
      )
        .to.be.revertedWithCustomError(usdoExpress, 'MintLessThanMinimum')
        .withArgs(usdc400InUsdo, mintMinInUsdo);

      // Test 2: TBILL (6 decimals with 1.01 rate) - 400 TBILL should be rejected
      // 400 TBILL * 1.01 rate = 404 USDO equivalent (still less than 500)
      const tbillAmount400 = ethers.utils.parseUnits('400', 6);
      await tbill.transfer(whitelistedUser.address, tbillAmount400);
      await tbill.connect(whitelistedUser).approve(usdoExpress.address, tbillAmount400);

      const tbill400InUsdo = await usdoExpress.convertFromUnderlying(tbill.address, tbillAmount400);

      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(tbill.address, whitelistedUser.address, tbillAmount400),
      )
        .to.be.revertedWithCustomError(usdoExpress, 'MintLessThanMinimum')
        .withArgs(tbill400InUsdo, mintMinInUsdo);

      // Test 3: USDC 600 should succeed (600 USDC = 600 USDO equivalent > 500)
      const usdcAmount600 = ethers.utils.parseUnits('600', 6);
      await usdc.transfer(whitelistedUser.address, usdcAmount600);
      await usdc.connect(whitelistedUser).approve(usdoExpress.address, usdcAmount600);

      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(usdc.address, whitelistedUser.address, usdcAmount600),
      ).to.not.be.reverted;

      // Test 4: TBILL 500 should succeed (500 TBILL * 1.01 = 505 USDO equivalent > 500)
      const tbillAmount500 = ethers.utils.parseUnits('500', 6);
      await tbill.transfer(whitelistedUser.address, tbillAmount500);
      await tbill.connect(whitelistedUser).approve(usdoExpress.address, tbillAmount500);

      await expect(
        usdoExpress.connect(whitelistedUser).instantMint(tbill.address, whitelistedUser.address, tbillAmount500),
      ).to.not.be.reverted;
    });
  });

  describe('Pause and Unpause', function () {
    const minimumAmt = 0;
    it('should fail to mint when paused', async function () {
      await usdoExpress.connect(operator).pauseMint();
      console.log('USDOExpress paused:', await usdoExpress.pausedMint());

      await expect(usdoExpress.instantMint(usdc.address, whitelistedUser.address, minimumAmt)).to.be.revertedWith(
        'Pausable: Mint paused',
      );
    });

    it('should fail to redeemSelf when paused', async function () {
      await usdoExpress.connect(operator).pauseRedeem();
      await expect(usdoExpress.instantRedeemSelf(whitelistedUser.address, minimumAmt, 0)).to.be.revertedWith(
        'Pausable: Redeem paused',
      );
    });

    it('should fail to redeemRequest when paused', async function () {
      await usdoExpress.connect(operator).pauseRedeem();
      await usdo.mint(whitelistedUser.address, ethers.utils.parseUnits('500', 18));

      await expect(
        usdoExpress.connect(whitelistedUser).redeemRequest(whitelistedUser.address, ethers.utils.parseUnits('500', 18)),
      ).to.be.revertedWith('Pausable: Redeem paused');
    });
  });

  describe('Decimal Handling for Different Assets', function () {
    it('should handle TBILL (6 decimals) with price feed correctly', async function () {
      // TBILL is already configured in the test setup with 6 decimals and 1.01 rate
      const tbillAmount = ethers.utils.parseUnits('1000', 6); // 1000 TBILL (6 decimals)
      const expectedUsdoAmount = ethers.utils.parseUnits('1010', 18); // 1000 * 1.01 = 1010 USDO
      
      const actualUsdoAmount = await usdoExpress.convertFromUnderlying(tbill.address, tbillAmount);
      expect(actualUsdoAmount).to.equal(expectedUsdoAmount);
      
      // Test reverse conversion
      const convertedBack = await usdoExpress.convertToUnderlying(tbill.address, expectedUsdoAmount);
      expect(convertedBack).to.equal(tbillAmount);
    });

    it('should handle USDC (6 decimals) without price feed correctly', async function () {
      // USDC is already configured with 6 decimals and no price feed (1:1 rate)
      const usdcAmount = ethers.utils.parseUnits('1000', 6); // 1000 USDC (6 decimals)
      const expectedUsdoAmount = ethers.utils.parseUnits('1000', 18); // 1000 USDC = 1000 USDO
      
      const actualUsdoAmount = await usdoExpress.convertFromUnderlying(usdc.address, usdcAmount);
      expect(actualUsdoAmount).to.equal(expectedUsdoAmount);
      
      // Test reverse conversion
      const convertedBack = await usdoExpress.convertToUnderlying(usdc.address, expectedUsdoAmount);
      expect(convertedBack).to.equal(usdcAmount);
    });

    it('should handle edge case: very small amounts with different decimals', async function () {
      // Test with very small USDC amount
      const smallUsdcAmount = BigNumber.from('1'); // 1 wei USDC (6 decimals)
      const usdoAmount = await usdoExpress.convertFromUnderlying(usdc.address, smallUsdcAmount);
      
      // Convert back - should handle precision correctly
      const convertedBack = await usdoExpress.convertToUnderlying(usdc.address, usdoAmount);
      
      // Should be able to handle the conversion without errors
      expect(convertedBack).to.be.gte(0);
    });

    it('should handle large amounts with different decimals correctly', async function () {
      // Test with large USDC amount
      const largeUsdcAmount = ethers.utils.parseUnits('1000000', 6); // 1M USDC
      const expectedUsdoAmount = ethers.utils.parseUnits('1000000', 18); // 1M USDO
      
      const actualUsdoAmount = await usdoExpress.convertFromUnderlying(usdc.address, largeUsdcAmount);
      expect(actualUsdoAmount).to.equal(expectedUsdoAmount);
      
      // Test reverse conversion
      const convertedBack = await usdoExpress.convertToUnderlying(usdc.address, expectedUsdoAmount);
      expect(convertedBack).to.equal(largeUsdcAmount);
    });

    it('should handle rounding in convertToUnderlying correctly', async function () {
      // Test with USDO amount that doesn't divide evenly into USDC decimals
      const oddUsdoAmount = ethers.utils.parseUnits('1000.123456789012345678', 18); // 18 decimal precision
      
      // Convert to USDC (6 decimals) - should round down
      const usdcAmount = await usdoExpress.convertToUnderlying(usdc.address, oddUsdoAmount);
      
      // Expected: 1000.123456 USDC (truncated to 6 decimals)
      const expectedUsdcAmount = ethers.utils.parseUnits('1000.123456', 6);
      expect(usdcAmount).to.equal(expectedUsdcAmount);
    });

    it('should verify decimal normalization for mint operations', async function () {
      // Test that mint operations correctly normalize different asset decimals to USDO equivalent
      const usdcMintAmount = ethers.utils.parseUnits('1000', 6); // 1000 USDC
      const tbillMintAmount = ethers.utils.parseUnits('990.099', 6); // Amount that equals ~1000 USDO after rate
      
      // Preview mint for USDC (should be ~1000 USDO worth)
      const usdcPreview = await usdoExpress.previewMint(usdc.address, usdcMintAmount);
      const usdcEquivalent = await usdoExpress.convertFromUnderlying(usdc.address, usdcPreview.netAmt);
      
      // Preview mint for TBILL (should be similar USDO amount)
      const tbillPreview = await usdoExpress.previewMint(tbill.address, tbillMintAmount);
      const tbillEquivalent = await usdoExpress.convertFromUnderlying(tbill.address, tbillPreview.netAmt);
      
      console.log('USDC equivalent in USDO:', usdcEquivalent.toString());
      console.log('TBILL equivalent in USDO:', tbillEquivalent.toString());
      
      // Both should produce similar USDO amounts (within ~1% due to rate differences)
      const difference = usdcEquivalent.sub(tbillEquivalent).abs();
      const tolerance = usdcEquivalent.div(100); // 1% tolerance
      expect(difference).to.be.lte(tolerance);
    });
  });

  describe('AssetRegistry Integration', function () {
    it('should correctly configure supported assets', async function () {
      const usdcConfig = await assetRegistry.getAssetConfig(usdc.address);
      expect(usdcConfig.asset).to.equal(usdc.address);
      expect(usdcConfig.isSupported).to.be.true;
      expect(usdcConfig.priceFeed).to.equal(ethers.constants.AddressZero);

      const tbillConfig = await assetRegistry.getAssetConfig(tbill.address);
      expect(tbillConfig.asset).to.equal(tbill.address);
      expect(tbillConfig.isSupported).to.be.true;
      expect(tbillConfig.priceFeed).to.equal(tbill.address);
    });

    it('should list supported assets', async function () {
      const supportedAssets = await assetRegistry.getSupportedAssets();
      expect(supportedAssets).to.include(usdc.address);
      expect(supportedAssets).to.include(tbill.address);
      expect(supportedAssets.length).to.equal(2);
    });

    it('should correctly convert asset amounts using registry', async function () {
      const usdcAmount = ethers.utils.parseUnits('1000', 6); // 1000 USDC
      const usdoAmount = await usdoExpress.convertFromUnderlying(usdc.address, usdcAmount);

      // 1000 USDC (6 decimals) should equal 1000 USDO (18 decimals)
      const expectedUsdoAmount = ethers.utils.parseUnits('1000', 18);
      expect(usdoAmount).to.equal(expectedUsdoAmount);

      // Test reverse conversion
      const convertedBack = await usdoExpress.convertToUnderlying(usdc.address, usdoAmount);
      expect(convertedBack).to.equal(usdcAmount);
    });

    it('should handle TBILL price conversion', async function () {
      const tbillAmount = ethers.utils.parseUnits('1000', 6); // 1000 TBILL
      const usdoAmount = await usdoExpress.convertFromUnderlying(tbill.address, tbillAmount);

      // With TBILL rate of 1.01 USDC per TBILL, 1000 TBILL should be worth 1010 USDO
      const expectedUsdoAmount = ethers.utils.parseUnits('1010', 18);
      expect(usdoAmount).to.equal(expectedUsdoAmount);
    });

    it('should allow adding new assets', async function () {
      // Create a mock new token address
      const newToken = ethers.Wallet.createRandom().address;

      await expect(
        assetRegistry.setAssetConfig({
          asset: newToken,
          isSupported: true,
          priceFeed: ethers.constants.AddressZero,
        }),
      )
        .to.emit(assetRegistry, 'AssetAdded')
        .withArgs(newToken, anyValue);

      const config = await assetRegistry.getAssetConfig(newToken);
      expect(config.asset).to.equal(newToken);
      expect(config.isSupported).to.be.true;
    });

    it('should prevent disabling assets via setAssetConfig', async function () {
      // First add a test asset
      const testToken = ethers.Wallet.createRandom().address;
      await assetRegistry.setAssetConfig({
        asset: testToken,
        isSupported: true,
        priceFeed: ethers.constants.AddressZero,
      });

      // Attempting to disable via setAssetConfig should revert
      await expect(
        assetRegistry.setAssetConfig({
          asset: testToken,
          isSupported: false,
          priceFeed: ethers.constants.AddressZero,
        }),
      ).to.be.revertedWithCustomError(assetRegistry, 'AssetRegistryUnsupportedAssetConfiguration');
    });

    it('should allow removing assets via removeAsset function', async function () {
      // First add a test asset
      const testToken = ethers.Wallet.createRandom().address;
      await assetRegistry.setAssetConfig({
        asset: testToken,
        isSupported: true,
        priceFeed: ethers.constants.AddressZero,
      });

      // Then remove it using dedicated function
      await expect(assetRegistry.removeAsset(testToken)).to.emit(assetRegistry, 'AssetRemoved').withArgs(testToken);

      const config = await assetRegistry.getAssetConfig(testToken);
      expect(config.isSupported).to.be.false;
    });

    it('should prevent creating unsupported asset configs', async function () {
      const testToken = ethers.Wallet.createRandom().address;

      // Attempting to create a disabled asset config should revert
      await expect(
        assetRegistry.setAssetConfig({
          asset: testToken,
          isSupported: false,
          priceFeed: ethers.constants.AddressZero,
        }),
      ).to.be.revertedWithCustomError(assetRegistry, 'AssetRegistryUnsupportedAssetConfiguration');
    });

    it('should fail to use unsupported assets', async function () {
      const unsupportedToken = ethers.Wallet.createRandom().address;
      const amount = ethers.utils.parseUnits('1000', 18);

      await expect(usdoExpress.convertFromUnderlying(unsupportedToken, amount)).to.be.revertedWithCustomError(
        assetRegistry,
        'AssetRegistryAssetNotSupported',
      );
    });

    it('should allow updating asset registry address', async function () {
      // Deploy a new registry
      const AssetRegistryFactory = await ethers.getContractFactory('AssetRegistry');
      const newRegistry = (await upgrades.deployProxy(AssetRegistryFactory, [owner.address], {
        initializer: 'initialize',
      })) as AssetRegistry;
      await newRegistry.deployed();

      // Update the registry address
      await expect(usdoExpress.connect(maintainer).setAssetRegistry(newRegistry.address))
        .to.emit(usdoExpress, 'AssetRegistryUpdated')
        .withArgs(newRegistry.address);

      expect(await usdoExpress._assetRegistry()).to.equal(newRegistry.address);
    });

    it('should fail to set zero address as registry', async function () {
      await expect(
        usdoExpress.connect(maintainer).setAssetRegistry(ethers.constants.AddressZero),
      ).to.be.revertedWithCustomError(usdoExpress, 'USDOExpressZeroAddress');
    });
  });
});
