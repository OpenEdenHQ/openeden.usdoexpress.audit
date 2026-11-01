import { expect } from 'chai';
import { ethers } from 'hardhat';
import { USDOPoRAssetsTracking } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

describe('USDOPoRAssetsTracking', function () {
  let tracking: USDOPoRAssetsTracking;
  let admin: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let token1: HardhatEthersSigner;
  let token2: HardhatEthersSigner;
  let token3: HardhatEthersSigner;
  let OPERATOR_ROLE: string;

  beforeEach(async function () {
    [admin, operator, user, token1, token2, token3] = await ethers.getSigners();

    const USDOPoRAssetsTracking = await ethers.getContractFactory('USDOPoRAssetsTracking');
    tracking = (await USDOPoRAssetsTracking.deploy(admin.address, operator.address)) as USDOPoRAssetsTracking;
    await tracking.waitForDeployment();

    OPERATOR_ROLE = await tracking.OPERATOR_ROLE();
  });

  describe('Constructor', function () {
    it('should set up roles correctly', async function () {
      const DEFAULT_ADMIN_ROLE = await tracking.DEFAULT_ADMIN_ROLE();

      expect(await tracking.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await tracking.hasRole(OPERATOR_ROLE, admin.address)).to.be.false;
      expect(await tracking.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;
      expect(await tracking.hasRole(OPERATOR_ROLE, user.address)).to.be.false;
    });

    it('should revert when deploying with zero addresses', async function () {
      const USDOPoRAssetsTracking = await ethers.getContractFactory('USDOPoRAssetsTracking');
      await expect(USDOPoRAssetsTracking.deploy(ethers.ZeroAddress, operator.address)).to.be.revertedWithCustomError(
        tracking,
        'ZeroAddress',
      );
      await expect(USDOPoRAssetsTracking.deploy(admin.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        tracking,
        'ZeroAddress',
      );
    });
  });

  describe('Asset Management', function () {
    describe('addSupportAsset', function () {
      it('should add assets correctly', async function () {
        const assets: string[] = [token1.address, token2.address];

        await expect(tracking.connect(operator).addSupportAsset(assets))
          .to.emit(tracking, 'AssetAdded')
          .withArgs(token1.address)
          .to.emit(tracking, 'AssetAdded')
          .withArgs(token2.address);

        expect(await tracking.isAssetSupported(token1.address)).to.be.true;
        expect(await tracking.isAssetSupported(token2.address)).to.be.true;
        expect(await tracking.isAssetSupported(token3.address)).to.be.false;
      });

      it('should revert when adding duplicate asset', async function () {
        const assets: string[] = [token1.address];
        await tracking.connect(operator).addSupportAsset(assets);

        await expect(tracking.connect(operator).addSupportAsset(assets))
          .to.be.revertedWithCustomError(tracking, 'DuplicateAsset')
          .withArgs(token1.address);
      });

      it('should revert when adding zero address', async function () {
        const assets: string[] = [ethers.ZeroAddress];
        await expect(tracking.connect(operator).addSupportAsset(assets)).to.be.revertedWithCustomError(
          tracking,
          'ZeroAddress',
        );
      });

      it('should revert when called by non-operator', async function () {
        const assets: string[] = [token1.address];
        await expect(tracking.connect(user).addSupportAsset(assets)).to.be.revertedWith(
          /AccessControl: account .* is missing role .*/,
        );
      });
    });

    describe('removeSupportAssets', function () {
      beforeEach(async function () {
        const assets: string[] = [token1.address, token2.address];
        await tracking.connect(operator).addSupportAsset(assets);
      });

      it('should remove assets correctly', async function () {
        const assets: string[] = [token1.address, token2.address];

        await expect(tracking.connect(operator).removeSupportAssets(assets))
          .to.emit(tracking, 'AssetRemoved')
          .withArgs(token1.address)
          .to.emit(tracking, 'AssetRemoved')
          .withArgs(token2.address);

        expect(await tracking.isAssetSupported(token1.address)).to.be.false;
        expect(await tracking.isAssetSupported(token2.address)).to.be.false;
      });

      it('should revert when removing non-existent asset', async function () {
        const assets: string[] = [token3.address];
        await expect(tracking.connect(operator).removeSupportAssets(assets))
          .to.be.revertedWithCustomError(tracking, 'AssetNotSupported')
          .withArgs(token3.address);
      });

      it('should revert when removing with empty array', async function () {
        const assets: string[] = [];
        await expect(tracking.connect(operator).removeSupportAssets(assets)).to.be.revertedWithCustomError(
          tracking,
          'ZeroAmount',
        );
      });

      it('should revert when called by non-operator', async function () {
        const assets: string[] = [token1.address];
        await expect(tracking.connect(user).removeSupportAssets(assets)).to.be.revertedWith(
          /AccessControl: account .* is missing role .*/,
        );
      });
    });

    describe('getSupportAssets', function () {
      it('should return correct list of supported assets', async function () {
        const assets: string[] = [token1.address, token2.address, token3.address];
        await tracking.connect(operator).addSupportAsset(assets);

        const supportedAssets: string[] = await tracking.getSupportAssets();
        expect(supportedAssets).to.have.lengthOf(3);
        expect(supportedAssets).to.include(token1.address);
        expect(supportedAssets).to.include(token2.address);
        expect(supportedAssets).to.include(token3.address);

        // Remove one asset and check again
        await tracking.connect(operator).removeSupportAssets([token2.address]);
        const updatedAssets: string[] = await tracking.getSupportAssets();
        expect(updatedAssets).to.have.lengthOf(2);
        expect(updatedAssets).to.include(token1.address);
        expect(updatedAssets).to.include(token3.address);
        expect(updatedAssets).to.not.include(token2.address);
      });
    });
  });

  describe('Pending Amount Operations', function () {
    beforeEach(async function () {
      await tracking.connect(operator).addSupportAsset([token1.address]);
    });

    it('should handle increase and decrease operations correctly', async function () {
      // Test increase
      await expect(tracking.connect(operator).increase(token1.address, 1000))
        .to.emit(tracking, 'Increase')
        .withArgs(token1.address, 1000);

      let pendingAmount: bigint = await tracking.getPending();
      expect(pendingAmount).to.equal(1000);

      // Test decrease
      await expect(tracking.connect(operator).decrease(token1.address, 500))
        .to.emit(tracking, 'Decrease')
        .withArgs(token1.address, 500);

      pendingAmount = await tracking.getPending();
      expect(pendingAmount).to.equal(500);

      // Test set pending
      await expect(tracking.connect(operator).setPending(1000)).to.emit(tracking, 'SetPending').withArgs(1000);

      pendingAmount = await tracking.getPending();
      expect(pendingAmount).to.equal(1000);
    });

    it('should revert on invalid operations', async function () {
      // Test zero amount
      await expect(tracking.connect(operator).increase(token1.address, 0)).to.be.revertedWithCustomError(
        tracking,
        'ZeroAmount',
      );

      await expect(tracking.connect(operator).decrease(token1.address, 0)).to.be.revertedWithCustomError(
        tracking,
        'ZeroAmount',
      );

      // Test unsupported asset
      await expect(tracking.connect(operator).increase(token2.address, 1000))
        .to.be.revertedWithCustomError(tracking, 'AssetNotSupported')
        .withArgs(token2.address);

      // Test decrease more than available
      await tracking.connect(operator).increase(token1.address, 1000);
      await expect(tracking.connect(operator).decrease(token1.address, 2000)).to.be.revertedWithCustomError(
        tracking,
        'ZeroAmount',
      );

      // Test unauthorized access
      await expect(tracking.connect(user).increase(token1.address, 1000)).to.be.revertedWith(
        /AccessControl: account .* is missing role .*/,
      );
    });
  });

  describe('Access Control', function () {
    it('should allow admin to grant and revoke operator role', async function () {
      // Grant operator role
      await tracking.connect(admin).grantRole(OPERATOR_ROLE, user.address);
      expect(await tracking.hasRole(OPERATOR_ROLE, user.address)).to.be.true;

      // Revoke operator role
      await tracking.connect(admin).revokeRole(OPERATOR_ROLE, user.address);
      expect(await tracking.hasRole(OPERATOR_ROLE, user.address)).to.be.false;
    });

    it('should not allow non-admin to grant or revoke roles', async function () {
      await expect(tracking.connect(user).grantRole(OPERATOR_ROLE, user.address)).to.be.revertedWith(
        /AccessControl: account .* is missing role .*/,
      );

      await expect(tracking.connect(user).revokeRole(OPERATOR_ROLE, operator.address)).to.be.revertedWith(
        /AccessControl: account .* is missing role .*/,
      );
    });
  });

  describe('Integration Tests', function () {
    it('should handle complex scenarios with multiple assets and operations', async function () {
      // Setup: Add multiple assets
      await tracking.connect(operator).addSupportAsset([token1.address, token2.address, token3.address]);

      // Perform operations on different assets
      await tracking.connect(operator).increase(token1.address, 1000);
      await tracking.connect(operator).decrease(token1.address, 500);
      await tracking.connect(operator).increase(token2.address, 2000);
      await tracking.connect(operator).decrease(token2.address, 1000);

      // Verify final state
      const pendingAmount: bigint = await tracking.getPending();
      expect(pendingAmount).to.equal(1500); // 1000 - 500 + 2000 - 1000 = 1500
    });

    it('should handle role changes during operations', async function () {
      // Setup initial state
      await tracking.connect(operator).addSupportAsset([token1.address]);
      await tracking.connect(operator).increase(token1.address, 1000);

      // Change roles
      await tracking.connect(admin).grantRole(OPERATOR_ROLE, user.address);
      await tracking.connect(admin).revokeRole(OPERATOR_ROLE, operator.address);

      // Verify new operator can perform operations
      await expect(tracking.connect(user).decrease(token1.address, 500))
        .to.emit(tracking, 'Decrease')
        .withArgs(token1.address, 500);

      // Verify old operator cannot perform operations
      await expect(tracking.connect(operator).increase(token1.address, 1000)).to.be.revertedWith(
        /AccessControl: account .* is missing role .*/,
      );
    });
  });
});
