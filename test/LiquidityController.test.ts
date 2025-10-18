import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { LiquidityController } from '../typechain-types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('LiquidityController', function () {
  let liquidityController: LiquidityController;
  let owner: SignerWithAddress;
  let caller: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const TOTAL_LIQUIDITY = ethers.utils.parseEther('1000000'); // 1M USYC
  const USER1_QUOTA = ethers.utils.parseEther('100000'); // 100K USYC
  const USER2_QUOTA = ethers.utils.parseEther('200000'); // 200K USYC

  beforeEach(async function () {
    [owner, caller, user1, user2, user3] = await ethers.getSigners();

    // Deploy LiquidityController
    const LiquidityControllerFactory = await ethers.getContractFactory('LiquidityController');
    liquidityController = (await upgrades.deployProxy(LiquidityControllerFactory, [caller.address, TOTAL_LIQUIDITY], {
      initializer: 'initialize',
    })) as LiquidityController;
  });

  describe('Initialization', function () {
    it('Should initialize with correct parameters', async function () {
      expect(await liquidityController.caller()).to.equal(caller.address);
      expect(await liquidityController.totalLiquidity()).to.equal(TOTAL_LIQUIDITY);
      expect(await liquidityController.totalAllocated()).to.equal(0);
      expect(await liquidityController.totalUsed()).to.equal(0);
    });

    it('Should revert if initialized with zero caller', async function () {
      const LiquidityControllerFactory = await ethers.getContractFactory('LiquidityController');
      await expect(
        upgrades.deployProxy(LiquidityControllerFactory, [ethers.constants.AddressZero, TOTAL_LIQUIDITY], {
          initializer: 'initialize',
        }),
      ).to.be.revertedWithCustomError(liquidityController, 'ZeroAddress');
    });
  });

  describe('Quota Management', function () {
    it('Should allow owner to set user quotas', async function () {
      await expect(liquidityController.setUserQuota(user1.address, USER1_QUOTA))
        .to.emit(liquidityController, 'QuotaSet')
        .withArgs(user1.address, USER1_QUOTA);

      expect(await liquidityController.userQuotas(user1.address)).to.equal(USER1_QUOTA);
      expect(await liquidityController.totalAllocated()).to.equal(USER1_QUOTA);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.true;
    });

    it('Should allow setting multiple user quotas', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      await liquidityController.setUserQuota(user2.address, USER2_QUOTA);

      expect(await liquidityController.userQuotas(user1.address)).to.equal(USER1_QUOTA);
      expect(await liquidityController.userQuotas(user2.address)).to.equal(USER2_QUOTA);
      expect(await liquidityController.totalAllocated()).to.equal(USER1_QUOTA.add(USER2_QUOTA));
    });

    it('Should revert if quota exceeds total liquidity', async function () {
      const excessiveQuota = TOTAL_LIQUIDITY.add(1);
      await expect(liquidityController.setUserQuota(user1.address, excessiveQuota)).to.be.revertedWithCustomError(
        liquidityController,
        'QuotaExceedsTotal',
      );
    });

    it('Should revert if total quotas exceed total liquidity', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const remainingQuota = TOTAL_LIQUIDITY.sub(USER1_QUOTA).add(1);

      await expect(liquidityController.setUserQuota(user2.address, remainingQuota)).to.be.revertedWithCustomError(
        liquidityController,
        'QuotaExceedsTotal',
      );
    });

    it('Should allow updating existing quotas', async function () {
      // Set initial quota
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);

      // Update quota
      const newQuota = ethers.utils.parseEther('150000');
      await liquidityController.setUserQuota(user1.address, newQuota);

      expect(await liquidityController.userQuotas(user1.address)).to.equal(newQuota);
      expect(await liquidityController.totalAllocated()).to.equal(newQuota);
    });

    it('Should remove user quota when set to zero', async function () {
      // Set quota
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.true;

      // Remove quota
      await liquidityController.setUserQuota(user1.address, 0);

      expect(await liquidityController.userQuotas(user1.address)).to.equal(0);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.false;
      expect(await liquidityController.totalAllocated()).to.equal(0);
    });

    it('Should only allow owner to set quotas', async function () {
      await expect(liquidityController.connect(user1).setUserQuota(user2.address, USER1_QUOTA)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });

    it('Should revert when decreasing quota below used amount', async function () {
      // Set initial quota and use some of it
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const usedAmount = ethers.utils.parseEther('80000');
      await liquidityController.connect(caller).reserveLiquidity(user1.address, usedAmount);

      // Try to set quota below used amount (50k < 80k used)
      const insufficientQuota = ethers.utils.parseEther('50000');
      await expect(liquidityController.setUserQuota(user1.address, insufficientQuota)).to.be.revertedWithCustomError(
        liquidityController,
        'QuotaExceedsUsed',
      );
    });
  });

  describe('Liquidity Reservation', function () {
    beforeEach(async function () {
      // Set up quotas
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      await liquidityController.setUserQuota(user2.address, USER2_QUOTA);
    });

    it('Should allow caller to reserve liquidity for authorized user', async function () {
      const reserveAmount = ethers.utils.parseEther('50000');

      await expect(liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount))
        .to.emit(liquidityController, 'QuotaUsed')
        .withArgs(user1.address, reserveAmount, USER1_QUOTA.sub(reserveAmount));

      expect(await liquidityController.usedQuotas(user1.address)).to.equal(reserveAmount);
      expect(await liquidityController.totalUsed()).to.equal(reserveAmount);
    });

    it('Should revert if non-caller tries to reserve', async function () {
      const reserveAmount = ethers.utils.parseEther('50000');

      await expect(
        liquidityController.connect(user1).reserveLiquidity(user1.address, reserveAmount),
      ).to.be.revertedWithCustomError(liquidityController, 'UnauthorizedCaller');
    });

    it('Should revert if user has no quota', async function () {
      const reserveAmount = ethers.utils.parseEther('50000');

      await expect(
        liquidityController.connect(caller).reserveLiquidity(user3.address, reserveAmount),
      ).to.be.revertedWithCustomError(liquidityController, 'UserNotFound');
    });

    it('Should revert if user has insufficient quota', async function () {
      const reserveAmount = USER1_QUOTA.add(1);

      await expect(
        liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount),
      ).to.be.revertedWithCustomError(liquidityController, 'InsufficientUserQuota');
    });

    it.skip('Should revert if total liquidity is insufficient', async function () {
      // Create a scenario where total liquidity is limited
      // Deploy a new controller with limited total liquidity (250k)
      const LiquidityControllerFactory = await ethers.getContractFactory('LiquidityController');
      const limitedLiquidityController = (await upgrades.deployProxy(
        LiquidityControllerFactory,
        [caller.address, ethers.utils.parseEther('250000')], // Only 250k total
        { initializer: 'initialize' },
      )) as LiquidityController;

      // Set quotas: user1: 150k, user2: 100k (total = 250k, fits in total liquidity)
      await limitedLiquidityController.setUserQuota(user1.address, ethers.utils.parseEther('150000'));
      await limitedLiquidityController.setUserQuota(user2.address, USER1_QUOTA); // 100k

      // Reserve 150k for user1 (total used = 150k, remaining = 100k)
      await limitedLiquidityController
        .connect(caller)
        .reserveLiquidity(user1.address, ethers.utils.parseEther('150000'));

      // Now only 100k remains in total liquidity pool
      // User2 has 100k quota, so user quota check will pass
      // But we try to reserve 100k + 1 wei, which will fail on total liquidity check
      await expect(
        limitedLiquidityController.connect(caller).reserveLiquidity(user2.address, USER1_QUOTA.add(1)),
      ).to.be.revertedWithCustomError(limitedLiquidityController, 'InsufficientTotalLiquidity');
    });

    it('Should handle multiple reservations correctly', async function () {
      const reserve1 = ethers.utils.parseEther('30000');
      const reserve2 = ethers.utils.parseEther('20000');

      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserve1);
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserve2);

      expect(await liquidityController.usedQuotas(user1.address)).to.equal(reserve1.add(reserve2));
      expect(await liquidityController.totalUsed()).to.equal(reserve1.add(reserve2));
    });

    it('Should revert on zero amount reservation', async function () {
      await expect(
        liquidityController.connect(caller).reserveLiquidity(user1.address, 0),
      ).to.be.revertedWithCustomError(liquidityController, 'ZeroAmount');
    });
  });

  describe('Liquidity Restoration', function () {
    beforeEach(async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const reserveAmount = ethers.utils.parseEther('50000');
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount);
    });

    it('Should allow owner to restore liquidity', async function () {
      const restoreAmount = ethers.utils.parseEther('20000');
      const initialUsed = await liquidityController.usedQuotas(user1.address);

      await expect(liquidityController.restoreLiquidity(user1.address, restoreAmount))
        .to.emit(liquidityController, 'QuotaRestored')
        .withArgs(user1.address, restoreAmount, USER1_QUOTA.sub(initialUsed.sub(restoreAmount)));

      expect(await liquidityController.usedQuotas(user1.address)).to.equal(initialUsed.sub(restoreAmount));
    });

    it('Should revert if non-owner tries to restore', async function () {
      const restoreAmount = ethers.utils.parseEther('20000');

      await expect(
        liquidityController.connect(user1).restoreLiquidity(user1.address, restoreAmount),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should cap restoration at used amount', async function () {
      const usedAmount = await liquidityController.usedQuotas(user1.address);
      const excessiveRestore = usedAmount.add(ethers.utils.parseEther('10000'));

      await liquidityController.restoreLiquidity(user1.address, excessiveRestore);

      expect(await liquidityController.usedQuotas(user1.address)).to.equal(0);
      expect(await liquidityController.totalUsed()).to.equal(0);
    });

    it('Should revert on zero amount restoration', async function () {
      await expect(liquidityController.restoreLiquidity(user1.address, 0)).to.be.revertedWithCustomError(
        liquidityController,
        'ZeroAmount',
      );
    });
  });

  describe('Liquidity Queries', function () {
    beforeEach(async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      await liquidityController.setUserQuota(user2.address, USER2_QUOTA);
    });

    it('Should return correct user liquidity status', async function () {
      const [available, total, used] = await liquidityController.checkUserLiquidity(user1.address);

      expect(available).to.equal(USER1_QUOTA);
      expect(total).to.equal(USER1_QUOTA);
      expect(used).to.equal(0);
    });

    it('Should return correct total liquidity status', async function () {
      const [totalAvailable, totalReserved, totalConsumed, poolBalance] =
        await liquidityController.checkTotalLiquidity();

      expect(totalAvailable).to.equal(TOTAL_LIQUIDITY.sub(USER1_QUOTA.add(USER2_QUOTA)));
      expect(totalReserved).to.equal(USER1_QUOTA.add(USER2_QUOTA));
      expect(totalConsumed).to.equal(0);
      expect(poolBalance).to.equal(TOTAL_LIQUIDITY);
    });

    it('Should return user authorization status', async function () {
      const [hasQuota1, quota1, available1] = await liquidityController.isUserAuthorized(user1.address);
      const [hasQuota3, quota3, available3] = await liquidityController.isUserAuthorized(user3.address);

      expect(hasQuota1).to.be.true;
      expect(quota1).to.equal(USER1_QUOTA);
      expect(available1).to.equal(USER1_QUOTA);

      expect(hasQuota3).to.be.false;
      expect(quota3).to.equal(0);
      expect(available3).to.equal(0);
    });

    it('Should return all users with quotas', async function () {
      const users = await liquidityController.getAllUsers();

      expect(users).to.have.lengthOf(2);
      expect(users).to.include(user1.address);
      expect(users).to.include(user2.address);
    });

    it('Should validate user quota correctly', async function () {
      const testAmount = ethers.utils.parseEther('50000');
      const [allowed1, quota1] = await liquidityController.validateUserQuota(user1.address, testAmount);
      const [allowed2, quota2] = await liquidityController.validateUserQuota(user1.address, USER1_QUOTA.add(1));

      expect(allowed1).to.be.true;
      expect(quota1).to.equal(USER1_QUOTA);

      expect(allowed2).to.be.false;
      expect(quota2).to.equal(USER1_QUOTA);
    });
  });

  describe('Admin Functions', function () {
    it('Should allow owner to update total liquidity', async function () {
      const newTotal = ethers.utils.parseEther('2000000');

      await expect(liquidityController.updateTotalLiquidity(newTotal))
        .to.emit(liquidityController, 'TotalLiquidityUpdated')
        .withArgs(newTotal);

      expect(await liquidityController.totalLiquidity()).to.equal(newTotal);
    });

    it('Should revert if new total is less than allocated', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const insufficientTotal = USER1_QUOTA.sub(1);

      await expect(liquidityController.updateTotalLiquidity(insufficientTotal)).to.be.revertedWithCustomError(
        liquidityController,
        'InsufficientTotalLiquidity',
      );
    });

    it('Should allow owner to update caller', async function () {
      const newCaller = user1.address;

      await expect(liquidityController.updateCaller(newCaller))
        .to.emit(liquidityController, 'CallerUpdated')
        .withArgs(newCaller);

      expect(await liquidityController.caller()).to.equal(newCaller);
    });

    it('Should revert if trying to set zero address as caller', async function () {
      await expect(liquidityController.updateCaller(ethers.constants.AddressZero)).to.be.revertedWithCustomError(
        liquidityController,
        'ZeroAddress',
      );
    });

    it('Should only allow owner to call admin functions', async function () {
      await expect(
        liquidityController.connect(user1).updateTotalLiquidity(ethers.utils.parseEther('2000000')),
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(liquidityController.connect(user1).updateCaller(user2.address)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });

  describe('Edge Cases', function () {
    it('Should prevent duplicate user entries when quota is reset and reassigned', async function () {
      // Initial setup: set quota for user1
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);

      // Verify user is in the list once
      let users = await liquidityController.getAllUsers();
      expect(users).to.have.lengthOf(1);
      expect(users[0]).to.equal(user1.address);

      // Reset quota to zero (this should not remove user from array)
      await liquidityController.setUserQuota(user1.address, 0);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.false;

      // Reassign quota (this should NOT add duplicate entry)
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.true;

      // Verify user is still in the list only once
      users = await liquidityController.getAllUsers();
      expect(users).to.have.lengthOf(1);
      expect(users[0]).to.equal(user1.address);

      // Repeat the cycle multiple times to ensure no duplicates accumulate
      for (let i = 0; i < 5; i++) {
        await liquidityController.setUserQuota(user1.address, 0);
        await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      }

      // Final verification: user should still appear only once
      users = await liquidityController.getAllUsers();
      expect(users).to.have.lengthOf(1);
      expect(users[0]).to.equal(user1.address);
    });

    it('Should handle quota removal correctly', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.true;

      // Remove quota
      await liquidityController.setUserQuota(user1.address, 0);

      expect(await liquidityController.userQuotas(user1.address)).to.equal(0);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.false;
      expect(await liquidityController.totalAllocated()).to.equal(0);
    });

    it('Should handle quota updates correctly', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);

      // Update quota to higher value
      const newQuota = ethers.utils.parseEther('150000');
      await liquidityController.setUserQuota(user1.address, newQuota);

      expect(await liquidityController.userQuotas(user1.address)).to.equal(newQuota);
      expect(await liquidityController.totalAllocated()).to.equal(newQuota);
    });

    it('Should handle quota updates with existing usage', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const reserveAmount = ethers.utils.parseEther('30000');
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount);

      // Update quota to higher value (should work)
      const newQuota = ethers.utils.parseEther('150000');
      await liquidityController.setUserQuota(user1.address, newQuota);

      expect(await liquidityController.usedQuotas(user1.address)).to.equal(reserveAmount);
      expect(await liquidityController.userQuotas(user1.address)).to.equal(newQuota);
    });

    it('Should allow setting quota exactly equal to used amount', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const reserveAmount = ethers.utils.parseEther('30000');
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount);

      // Set quota exactly equal to used amount (edge case - should work)
      await liquidityController.setUserQuota(user1.address, reserveAmount);

      expect(await liquidityController.userQuotas(user1.address)).to.equal(reserveAmount);
      expect(await liquidityController.usedQuotas(user1.address)).to.equal(reserveAmount);

      // Verify available is now 0
      const [available, total, used] = await liquidityController.checkUserLiquidity(user1.address);
      expect(available).to.equal(0);
      expect(total).to.equal(reserveAmount);
      expect(used).to.equal(reserveAmount);
    });

    it('Should prevent quota removal when user has active usage', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const reserveAmount = ethers.utils.parseEther('30000');
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount);

      // Attempt to remove quota should fail due to active usage
      await expect(liquidityController.setUserQuota(user1.address, 0)).to.be.revertedWithCustomError(
        liquidityController,
        'QuotaExceedsUsed',
      );

      // Quota and usage should remain unchanged
      expect(await liquidityController.usedQuotas(user1.address)).to.equal(reserveAmount);
      expect(await liquidityController.totalUsed()).to.equal(reserveAmount);
      expect(await liquidityController.userQuotas(user1.address)).to.equal(USER1_QUOTA);
    });

    it('Should allow quota removal after restoring liquidity first', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const reserveAmount = ethers.utils.parseEther('30000');
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount);

      // Step 1: Restore liquidity first (simulating returned liquidity)
      await liquidityController.restoreLiquidity(user1.address, reserveAmount);

      // Step 2: Now quota removal should work
      await liquidityController.setUserQuota(user1.address, 0);

      // Verify final state
      expect(await liquidityController.usedQuotas(user1.address)).to.equal(0);
      expect(await liquidityController.totalUsed()).to.equal(0);
      expect(await liquidityController.userQuotas(user1.address)).to.equal(0);
      expect(await liquidityController.authorizedUsers(user1.address)).to.be.false;
    });

    it('Should handle sequential reservations that exhaust quota', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);

      const reserve1 = ethers.utils.parseEther('60000');
      const reserve2 = ethers.utils.parseEther('40000');

      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserve1);
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserve2);

      // Quota should be fully exhausted
      const [available, total, used] = await liquidityController.checkUserLiquidity(user1.address);
      expect(available).to.equal(0);
      expect(total).to.equal(USER1_QUOTA);
      expect(used).to.equal(USER1_QUOTA);

      // Further reservation should fail
      await expect(
        liquidityController.connect(caller).reserveLiquidity(user1.address, 1),
      ).to.be.revertedWithCustomError(liquidityController, 'InsufficientUserQuota');
    });

    it('Should handle partial restoration correctly', async function () {
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA);
      const reserveAmount = ethers.utils.parseEther('50000');
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserveAmount);

      // Restore only part of it
      const restoreAmount = ethers.utils.parseEther('20000');
      await liquidityController.restoreLiquidity(user1.address, restoreAmount);

      const [available, total, used] = await liquidityController.checkUserLiquidity(user1.address);
      expect(available).to.equal(ethers.utils.parseEther('70000')); // 100k - 30k
      expect(total).to.equal(USER1_QUOTA);
      expect(used).to.equal(ethers.utils.parseEther('30000'));
    });
  });

  describe('Multi-User Scenarios', function () {
    beforeEach(async function () {
      // Set up different quotas for different users
      await liquidityController.setUserQuota(user1.address, USER1_QUOTA); // 100k
      await liquidityController.setUserQuota(user2.address, USER2_QUOTA); // 200k
      await liquidityController.setUserQuota(user3.address, ethers.utils.parseEther('50000')); // 50k
    });

    it('Should handle independent reservations from multiple users', async function () {
      const reserve1 = ethers.utils.parseEther('40000');
      const reserve2 = ethers.utils.parseEther('80000');
      const reserve3 = ethers.utils.parseEther('20000');

      // Reserve for each user
      await liquidityController.connect(caller).reserveLiquidity(user1.address, reserve1);
      await liquidityController.connect(caller).reserveLiquidity(user2.address, reserve2);
      await liquidityController.connect(caller).reserveLiquidity(user3.address, reserve3);

      // Verify each user's state independently
      const [avail1, total1, used1] = await liquidityController.checkUserLiquidity(user1.address);
      expect(avail1).to.equal(USER1_QUOTA.sub(reserve1));
      expect(total1).to.equal(USER1_QUOTA);
      expect(used1).to.equal(reserve1);

      const [avail2, total2, used2] = await liquidityController.checkUserLiquidity(user2.address);
      expect(avail2).to.equal(USER2_QUOTA.sub(reserve2));
      expect(total2).to.equal(USER2_QUOTA);
      expect(used2).to.equal(reserve2);

      const [avail3, total3, used3] = await liquidityController.checkUserLiquidity(user3.address);
      expect(avail3).to.equal(ethers.utils.parseEther('30000')); // 50k - 20k
      expect(total3).to.equal(ethers.utils.parseEther('50000'));
      expect(used3).to.equal(reserve3);

      // Verify total used
      expect(await liquidityController.totalUsed()).to.equal(reserve1.add(reserve2).add(reserve3));
    });

    it('Should handle independent restorations from multiple users', async function () {
      // First reserve for all users
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('50000'));
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('100000'));
      await liquidityController.connect(caller).reserveLiquidity(user3.address, ethers.utils.parseEther('30000'));

      const totalUsedBefore = await liquidityController.totalUsed();

      // Restore for user1 and user3 only
      await liquidityController.restoreLiquidity(user1.address, ethers.utils.parseEther('20000'));
      await liquidityController.restoreLiquidity(user3.address, ethers.utils.parseEther('10000'));

      // Verify user1
      const [avail1, , used1] = await liquidityController.checkUserLiquidity(user1.address);
      expect(used1).to.equal(ethers.utils.parseEther('30000')); // 50k - 20k
      expect(avail1).to.equal(ethers.utils.parseEther('70000')); // 100k - 30k

      // Verify user2 unchanged
      const [avail2, , used2] = await liquidityController.checkUserLiquidity(user2.address);
      expect(used2).to.equal(ethers.utils.parseEther('100000')); // unchanged
      expect(avail2).to.equal(ethers.utils.parseEther('100000')); // 200k - 100k

      // Verify user3
      const [avail3, , used3] = await liquidityController.checkUserLiquidity(user3.address);
      expect(used3).to.equal(ethers.utils.parseEther('20000')); // 30k - 10k
      expect(avail3).to.equal(ethers.utils.parseEther('30000')); // 50k - 20k

      // Verify total used decreased correctly
      const expectedDecrease = ethers.utils.parseEther('30000'); // 20k + 10k
      expect(await liquidityController.totalUsed()).to.equal(totalUsedBefore.sub(expectedDecrease));
    });

    it('Should validate quota independently for each user', async function () {
      // Test validation for different amounts for different users
      const [allowed1_small, quota1] = await liquidityController.validateUserQuota(
        user1.address,
        ethers.utils.parseEther('50000'),
      );
      const [allowed1_large] = await liquidityController.validateUserQuota(
        user1.address,
        ethers.utils.parseEther('150000'),
      );

      const [allowed2_small, quota2] = await liquidityController.validateUserQuota(
        user2.address,
        ethers.utils.parseEther('50000'),
      );
      const [allowed2_large] = await liquidityController.validateUserQuota(
        user2.address,
        ethers.utils.parseEther('250000'),
      );

      // User1: 100k quota
      expect(allowed1_small).to.be.true;
      expect(quota1).to.equal(USER1_QUOTA);
      expect(allowed1_large).to.be.false; // 150k > 100k

      // User2: 200k quota
      expect(allowed2_small).to.be.true;
      expect(quota2).to.equal(USER2_QUOTA);
      expect(allowed2_large).to.be.false; // 250k > 200k
    });

    it('Should handle mixed reserve and restore across users', async function () {
      // User1: Reserve 60k
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('60000'));

      // User2: Reserve 150k
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('150000'));

      // User3: Reserve 40k
      await liquidityController.connect(caller).reserveLiquidity(user3.address, ethers.utils.parseEther('40000'));

      const totalUsedAfterReserve = await liquidityController.totalUsed();
      expect(totalUsedAfterReserve).to.equal(ethers.utils.parseEther('250000')); // 60k + 150k + 40k

      // Restore some for user2
      await liquidityController.restoreLiquidity(user2.address, ethers.utils.parseEther('50000'));

      // Reserve more for user1
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('30000'));

      // Final state verification
      const [avail1, , used1] = await liquidityController.checkUserLiquidity(user1.address);
      expect(used1).to.equal(ethers.utils.parseEther('90000')); // 60k + 30k
      expect(avail1).to.equal(ethers.utils.parseEther('10000')); // 100k - 90k

      const [avail2, , used2] = await liquidityController.checkUserLiquidity(user2.address);
      expect(used2).to.equal(ethers.utils.parseEther('100000')); // 150k - 50k
      expect(avail2).to.equal(ethers.utils.parseEther('100000')); // 200k - 100k

      const [avail3, , used3] = await liquidityController.checkUserLiquidity(user3.address);
      expect(used3).to.equal(ethers.utils.parseEther('40000')); // unchanged
      expect(avail3).to.equal(ethers.utils.parseEther('10000')); // 50k - 40k

      // Total: 60k + 30k + 100k + 40k = 230k
      expect(await liquidityController.totalUsed()).to.equal(ethers.utils.parseEther('230000'));
    });

    it('Should return correct authorization status for multiple users', async function () {
      // Check all three users
      const [hasQuota1, quota1, avail1] = await liquidityController.isUserAuthorized(user1.address);
      const [hasQuota2, quota2, avail2] = await liquidityController.isUserAuthorized(user2.address);
      const [hasQuota3, quota3, avail3] = await liquidityController.isUserAuthorized(user3.address);

      expect(hasQuota1).to.be.true;
      expect(quota1).to.equal(USER1_QUOTA);
      expect(avail1).to.equal(USER1_QUOTA);

      expect(hasQuota2).to.be.true;
      expect(quota2).to.equal(USER2_QUOTA);
      expect(avail2).to.equal(USER2_QUOTA);

      expect(hasQuota3).to.be.true;
      expect(quota3).to.equal(ethers.utils.parseEther('50000'));
      expect(avail3).to.equal(ethers.utils.parseEther('50000'));

      // Get all users
      const allUsers = await liquidityController.getAllUsers();
      expect(allUsers).to.have.lengthOf(3);
      expect(allUsers).to.include(user1.address);
      expect(allUsers).to.include(user2.address);
      expect(allUsers).to.include(user3.address);
    });

    it('Should prevent one user from affecting another users quota', async function () {
      // User1 uses their full quota
      await liquidityController.connect(caller).reserveLiquidity(user1.address, USER1_QUOTA);

      // User2 should still have full quota available
      const [allowed, quota] = await liquidityController.validateUserQuota(user2.address, USER2_QUOTA);
      expect(allowed).to.be.true;
      expect(quota).to.equal(USER2_QUOTA);

      // User2 can still reserve
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('100000'));

      // User1 should still be at max usage
      const [avail1, , used1] = await liquidityController.checkUserLiquidity(user1.address);
      expect(used1).to.equal(USER1_QUOTA);
      expect(avail1).to.equal(0);
    });

    it('Should handle quota updates for one user without affecting others', async function () {
      // Reserve for all users
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('30000'));
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('50000'));
      await liquidityController.connect(caller).reserveLiquidity(user3.address, ethers.utils.parseEther('20000'));

      // Update user2's quota to higher value
      const newUser2Quota = ethers.utils.parseEther('300000');
      await liquidityController.setUserQuota(user2.address, newUser2Quota);

      // Verify user2 updated
      expect(await liquidityController.userQuotas(user2.address)).to.equal(newUser2Quota);
      const [avail2, , used2] = await liquidityController.checkUserLiquidity(user2.address);
      expect(used2).to.equal(ethers.utils.parseEther('50000')); // unchanged
      expect(avail2).to.equal(newUser2Quota.sub(ethers.utils.parseEther('50000')));

      // Verify user1 and user3 unchanged
      expect(await liquidityController.userQuotas(user1.address)).to.equal(USER1_QUOTA);
      expect(await liquidityController.usedQuotas(user1.address)).to.equal(ethers.utils.parseEther('30000'));

      expect(await liquidityController.userQuotas(user3.address)).to.equal(ethers.utils.parseEther('50000'));
      expect(await liquidityController.usedQuotas(user3.address)).to.equal(ethers.utils.parseEther('20000'));

      // Total allocated should reflect the change
      const expectedTotal = USER1_QUOTA.add(newUser2Quota).add(ethers.utils.parseEther('50000'));
      expect(await liquidityController.totalAllocated()).to.equal(expectedTotal);
    });

    it('Should handle complete quota lifecycle for multiple users', async function () {
      // Phase 1: Set quotas (already done in beforeEach)
      expect(await liquidityController.totalAllocated()).to.equal(
        USER1_QUOTA.add(USER2_QUOTA).add(ethers.utils.parseEther('50000')),
      );

      // Phase 2: Users reserve different amounts
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('80000'));
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('120000'));
      await liquidityController.connect(caller).reserveLiquidity(user3.address, ethers.utils.parseEther('35000'));

      expect(await liquidityController.totalUsed()).to.equal(ethers.utils.parseEther('235000'));

      // Phase 3: Partially restore for some users
      await liquidityController.restoreLiquidity(user1.address, ethers.utils.parseEther('30000'));
      await liquidityController.restoreLiquidity(user3.address, ethers.utils.parseEther('15000'));

      expect(await liquidityController.totalUsed()).to.equal(ethers.utils.parseEther('190000')); // 235k - 45k

      // Phase 4: Reserve more
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('20000'));

      // Final verification
      const [avail1, , used1] = await liquidityController.checkUserLiquidity(user1.address);
      expect(used1).to.equal(ethers.utils.parseEther('70000')); // 80k - 30k + 20k
      expect(avail1).to.equal(ethers.utils.parseEther('30000'));

      const [avail2, , used2] = await liquidityController.checkUserLiquidity(user2.address);
      expect(used2).to.equal(ethers.utils.parseEther('120000')); // unchanged
      expect(avail2).to.equal(ethers.utils.parseEther('80000'));

      const [avail3, , used3] = await liquidityController.checkUserLiquidity(user3.address);
      expect(used3).to.equal(ethers.utils.parseEther('20000')); // 35k - 15k
      expect(avail3).to.equal(ethers.utils.parseEther('30000'));

      expect(await liquidityController.totalUsed()).to.equal(ethers.utils.parseEther('210000')); // 70k + 120k + 20k
    });

    it('Should validate quotas correctly for different users simultaneously', async function () {
      // Reserve some for user1
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('70000'));

      // Now validate different scenarios
      const [allowed1_remaining] = await liquidityController.validateUserQuota(
        user1.address,
        ethers.utils.parseEther('30000'),
      ); // 30k <= 30k remaining
      const [allowed1_exceeds] = await liquidityController.validateUserQuota(
        user1.address,
        ethers.utils.parseEther('31000'),
      ); // 31k > 30k remaining

      const [allowed2_half] = await liquidityController.validateUserQuota(
        user2.address,
        ethers.utils.parseEther('100000'),
      ); // 100k <= 200k
      const [allowed2_full] = await liquidityController.validateUserQuota(user2.address, USER2_QUOTA); // 200k <= 200k

      expect(allowed1_remaining).to.be.true;
      expect(allowed1_exceeds).to.be.false;
      expect(allowed2_half).to.be.true;
      expect(allowed2_full).to.be.true;
    });

    it('Should allow different users to reach quota limits independently', async function () {
      // User1 exhausts their quota
      await liquidityController.connect(caller).reserveLiquidity(user1.address, USER1_QUOTA);

      // User1 cannot reserve more
      await expect(
        liquidityController.connect(caller).reserveLiquidity(user1.address, 1),
      ).to.be.revertedWithCustomError(liquidityController, 'InsufficientUserQuota');

      // User2 can still reserve (has separate quota)
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('50000'));

      // User3 can still reserve (has separate quota)
      await liquidityController.connect(caller).reserveLiquidity(user3.address, ethers.utils.parseEther('25000'));

      // Verify states
      expect(await liquidityController.usedQuotas(user1.address)).to.equal(USER1_QUOTA);
      expect(await liquidityController.usedQuotas(user2.address)).to.equal(ethers.utils.parseEther('50000'));
      expect(await liquidityController.usedQuotas(user3.address)).to.equal(ethers.utils.parseEther('25000'));
    });

    it('Should handle quota removal with proper restoration workflow', async function () {
      // Reserve for all users
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('40000'));
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('80000'));
      await liquidityController.connect(caller).reserveLiquidity(user3.address, ethers.utils.parseEther('20000'));

      const totalUsedBefore = await liquidityController.totalUsed();

      // Step 1: Restore user2's liquidity first (simulating returned liquidity)
      await liquidityController.restoreLiquidity(user2.address, ethers.utils.parseEther('80000'));

      // Step 2: Now remove user2's quota
      await liquidityController.setUserQuota(user2.address, 0);

      // Verify user2 is cleared
      expect(await liquidityController.userQuotas(user2.address)).to.equal(0);
      expect(await liquidityController.usedQuotas(user2.address)).to.equal(0);
      expect(await liquidityController.authorizedUsers(user2.address)).to.be.false;

      // Verify user1 and user3 unchanged
      expect(await liquidityController.usedQuotas(user1.address)).to.equal(ethers.utils.parseEther('40000'));
      expect(await liquidityController.usedQuotas(user3.address)).to.equal(ethers.utils.parseEther('20000'));

      // Total used should have decreased by user2's usage due to restoreLiquidity(), not quota removal
      expect(await liquidityController.totalUsed()).to.equal(totalUsedBefore.sub(ethers.utils.parseEther('80000')));
    });

    it('Should correctly track total liquidity across multiple user operations', async function () {
      // Initial state
      const [totalAvail0, totalRes0, totalCons0, pool0] = await liquidityController.checkTotalLiquidity();
      expect(pool0).to.equal(TOTAL_LIQUIDITY);
      expect(totalRes0).to.equal(ethers.utils.parseEther('350000')); // 100k + 200k + 50k
      expect(totalCons0).to.equal(0);
      expect(totalAvail0).to.equal(TOTAL_LIQUIDITY.sub(ethers.utils.parseEther('350000')));

      // Reserve operations
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('100000'));
      await liquidityController.connect(caller).reserveLiquidity(user2.address, ethers.utils.parseEther('200000'));

      const [totalAvail1, totalRes1, totalCons1, pool1] = await liquidityController.checkTotalLiquidity();
      expect(totalCons1).to.equal(ethers.utils.parseEther('300000'));
      expect(pool1).to.equal(TOTAL_LIQUIDITY);

      // Restore operation
      await liquidityController.restoreLiquidity(user1.address, ethers.utils.parseEther('50000'));

      const [totalAvail2, totalRes2, totalCons2, pool2] = await liquidityController.checkTotalLiquidity();
      expect(totalCons2).to.equal(ethers.utils.parseEther('250000')); // 300k - 50k
      expect(pool2).to.equal(TOTAL_LIQUIDITY);
      expect(totalRes2).to.equal(ethers.utils.parseEther('350000')); // allocated unchanged
    });

    it('Should handle authorization checks across multiple users with different states', async function () {
      // Reserve for user1
      await liquidityController.connect(caller).reserveLiquidity(user1.address, ethers.utils.parseEther('90000'));

      // Check authorization with different usage levels
      const [hasQuota1, quota1, avail1] = await liquidityController.isUserAuthorized(user1.address);
      expect(hasQuota1).to.be.true;
      expect(quota1).to.equal(USER1_QUOTA);
      expect(avail1).to.equal(ethers.utils.parseEther('10000')); // 100k - 90k

      const [hasQuota2, quota2, avail2] = await liquidityController.isUserAuthorized(user2.address);
      expect(hasQuota2).to.be.true;
      expect(quota2).to.equal(USER2_QUOTA);
      expect(avail2).to.equal(USER2_QUOTA); // full quota available

      // Create a user with no quota
      const [owner] = await ethers.getSigners();
      const [hasQuotaOwner, quotaOwner, availOwner] = await liquidityController.isUserAuthorized(owner.address);
      expect(hasQuotaOwner).to.be.false;
      expect(quotaOwner).to.equal(0);
      expect(availOwner).to.equal(0);
    });
  });
});
