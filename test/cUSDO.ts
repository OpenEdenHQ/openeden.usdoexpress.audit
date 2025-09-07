import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { Contract, BigNumber, constants, logger } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer';
import {
  parseUnits,
  keccak256,
  toUtf8Bytes,
  defaultAbiCoder,
  id,
  splitSignature,
  parseEther,
  formatEther,
} from 'ethers/lib/utils';

const { AddressZero, MaxUint256 } = constants;

const roles = {
  MINTER: keccak256(toUtf8Bytes('MINTER_ROLE')),
  BURNER: keccak256(toUtf8Bytes('BURNER_ROLE')),
  BANLIST: keccak256(toUtf8Bytes('BANLIST_ROLE')),
  MULTIPLIER: keccak256(toUtf8Bytes('MULTIPLIER_ROLE')),
  UPGRADE: keccak256(toUtf8Bytes('UPGRADE_ROLE')),
  PAUSE: keccak256(toUtf8Bytes('PAUSE_ROLE')),
  DEFAULT_ADMIN_ROLE: ethers.constants.HashZero,
};

describe('cUSDO', () => {
  const name = 'Compounding Open Dollar';
  const symbol = 'cUSDO';
  const totalUSDOShares = parseUnits('1337');

  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshopt in every test.
  const deployFixture = async () => {
    // Contracts are deployed using the first signer/account by default
    const [owner, acc1, acc2] = await ethers.getSigners();

    const USDO = await ethers.getContractFactory('USDO');
    const USDOContract = await upgrades.deployProxy(USDO, ['USDO-n', 'USDO-s', owner.address], {
      initializer: 'initialize',
    });

    // Set a high cap to allow initial minting
    await USDOContract.updateTotalSupplyCap(parseUnits('10000000000')); // 10 billion USDO

    await USDOContract.grantRole(roles.MINTER, owner.address);
    await USDOContract.grantRole(roles.MULTIPLIER, owner.address);
    await USDOContract.grantRole(roles.PAUSE, owner.address);
    await USDOContract.grantRole(roles.BANLIST, owner.address);
    await USDOContract.mint(owner.address, totalUSDOShares);

    const cUSDO = await ethers.getContractFactory('cUSDO');
    const cUSDOContract = await upgrades.deployProxy(cUSDO, [USDOContract.address, owner.address], {
      initializer: 'initialize',
    });

    await cUSDOContract.grantRole(roles.PAUSE, owner.address);
    await cUSDOContract.grantRole(roles.UPGRADE, owner.address);

    return { cUSDOContract, USDOContract, owner, acc1, acc2 };
  };

  describe('Deployment', () => {
    it('has a name', async () => {
      const { cUSDOContract } = await loadFixture(deployFixture);

      expect(await cUSDOContract.name()).to.equal(name);
    });

    it('has a symbol', async () => {
      const { cUSDOContract } = await loadFixture(deployFixture);

      expect(await cUSDOContract.symbol()).to.equal(symbol);
    });

    it('has an asset', async () => {
      const { cUSDOContract, USDOContract } = await loadFixture(deployFixture);

      expect(await cUSDOContract.asset()).to.equal(USDOContract.address);
    });

    it('has a totalAssets', async () => {
      const { cUSDOContract } = await loadFixture(deployFixture);

      expect(await cUSDOContract.totalAssets()).to.equal(0);
    });

    it('has a maxDeposit', async () => {
      const { cUSDOContract, acc1 } = await loadFixture(deployFixture);

      expect(await cUSDOContract.maxDeposit(acc1.address)).to.equal(MaxUint256);
    });

    it('has a maxMint', async () => {
      const { cUSDOContract, acc1 } = await loadFixture(deployFixture);

      expect(await cUSDOContract.maxMint(acc1.address)).to.equal(MaxUint256);
    });

    it('has 18 decimals', async () => {
      const { cUSDOContract } = await loadFixture(deployFixture);

      expect(await cUSDOContract.decimals()).to.be.equal(18);
    });

    it('grants admin role to the address passed to the initializer', async () => {
      const { cUSDOContract, owner } = await loadFixture(deployFixture);

      expect(await cUSDOContract.hasRole(await cUSDOContract.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
    });

    it('fails if initialize is called again after initialization', async () => {
      const { cUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);

      await expect(cUSDOContract.initialize(USDOContract.address, owner.address)).to.be.revertedWith(
        'Initializable: contract is already initialized',
      );
    });
  });

  describe('Access control', () => {
    it('pauses when pause role', async () => {
      const { cUSDOContract, owner } = await loadFixture(deployFixture);

      await expect(await cUSDOContract.pause()).to.not.be.revertedWith(
        `AccessControl: account ${owner.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('does not pause without pause role', async () => {
      const { cUSDOContract, acc1 } = await loadFixture(deployFixture);

      await expect(cUSDOContract.connect(acc1).pause()).to.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('unpauses when pause role', async () => {
      const { cUSDOContract, owner } = await loadFixture(deployFixture);

      await cUSDOContract.connect(owner).pause();

      await expect(await cUSDOContract.unpause()).to.not.be.revertedWith(
        `AccessControl: account ${owner.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('does not unpause without pause role', async () => {
      const { cUSDOContract, owner, acc1 } = await loadFixture(deployFixture);

      await cUSDOContract.connect(owner).pause();

      await expect(cUSDOContract.connect(acc1).unpause()).to.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.PAUSE}`,
      );
    });

    it('does not upgrade without upgrade role', async () => {
      const { cUSDOContract, acc1 } = await loadFixture(deployFixture);

      await expect(cUSDOContract.connect(acc1).upgradeTo(AddressZero)).to.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.UPGRADE}`,
      );
    });

    it('upgrades with upgrade role', async () => {
      const { cUSDOContract, acc1 } = await loadFixture(deployFixture);

      await cUSDOContract.grantRole(roles.UPGRADE, acc1.address);

      await expect(cUSDOContract.connect(acc1).upgradeTo(AddressZero)).to.not.be.revertedWith(
        `AccessControl: account ${acc1.address.toLowerCase()} is missing role ${roles.UPGRADE}`,
      );
    });
  });

  describe('Pause status should follow USDO pause status', () => {
    it('should be paused when USDO is paused', async () => {
      const { cUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);

      expect(await cUSDOContract.paused()).to.equal(false);
      await USDOContract.connect(owner).pause();
      expect(await cUSDOContract.paused()).to.equal(true);
    });
  });

  describe('Accrue value', () => {
    // Error should always fall 7 orders of magnitud below than one cent of a dollar (1 GWEI)
    // Inaccuracy stems from using fixed-point arithmetic and Solidity's 18-decimal support
    // resulting in periodic number approximations during divisions
    const expectEqualWithError = (actual: BigNumber, expected: BigNumber, error = '0.000000001') => {
      expect(actual).to.be.closeTo(expected, parseUnits(error));
    };

    it('can accrue value without rebasing', async () => {
      const { cUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);
      const initialBalance = await USDOContract.balanceOf(owner.address);

      await USDOContract.connect(owner).approve(cUSDOContract.address, MaxUint256);
      await cUSDOContract.connect(owner).deposit(initialBalance, owner.address);

      expect(await USDOContract.balanceOf(owner.address)).to.be.equal(0);
      expect(await cUSDOContract.balanceOf(owner.address)).to.be.equal(initialBalance);

      const bonusMultiplier = parseUnits('1.0001');
      const expectedIncrement = initialBalance.mul(bonusMultiplier).div(parseUnits('1'));

      await USDOContract.connect(owner).updateBonusMultiplier(bonusMultiplier);

      expect(await cUSDOContract.balanceOf(owner.address)).to.be.equal(initialBalance);
      expect(await cUSDOContract.totalAssets()).to.be.equal(expectedIncrement);
      expect(await USDOContract.balanceOf(cUSDOContract.address)).to.be.equal(expectedIncrement);

      await cUSDOContract
        .connect(owner)
        .redeem(await cUSDOContract.balanceOf(owner.address), owner.address, owner.address);

      expectEqualWithError(await USDOContract.balanceOf(owner.address), expectedIncrement);
    });
  });

  describe('Transfer between users', () => {
    it('can transfer cUSDO and someone else redeem', async () => {
      const { cUSDOContract, USDOContract, owner, acc1 } = await loadFixture(deployFixture);

      await USDOContract.connect(owner).approve(cUSDOContract.address, MaxUint256);
      await cUSDOContract.connect(owner).deposit(parseUnits('2'), owner.address);
      await cUSDOContract.connect(owner).transfer(acc1.address, parseUnits('1'));

      expect(await cUSDOContract.totalAssets()).to.be.equal(parseUnits('2'));
      expect(await cUSDOContract.balanceOf(acc1.address)).to.be.equal(parseUnits('1'));
      expect(await cUSDOContract.maxWithdraw(acc1.address)).to.be.equal(parseUnits('1'));

      await cUSDOContract.connect(acc1).withdraw(parseUnits('1'), acc1.address, acc1.address);

      expect(await USDOContract.balanceOf(acc1.address)).to.be.equal(parseUnits('1'));
    });

    it('should not transfer on a USDO pause', async () => {
      const { cUSDOContract, USDOContract, owner, acc1 } = await loadFixture(deployFixture);

      await USDOContract.connect(owner).approve(cUSDOContract.address, MaxUint256);
      await cUSDOContract.connect(owner).deposit(parseUnits('2'), owner.address);
      await USDOContract.connect(owner).pause();

      await expect(cUSDOContract.connect(owner).transfer(acc1.address, parseUnits('2'))).to.be.revertedWithCustomError(
        cUSDOContract,
        'cUSDOPausedTransfers',
      );

      await USDOContract.connect(owner).unpause();

      await expect(cUSDOContract.connect(owner).transfer(acc1.address, parseUnits('2'))).not.to.be.reverted;
    });

    it('should not transfer if blocked', async () => {
      const { cUSDOContract, USDOContract, owner, acc1, acc2 } = await loadFixture(deployFixture);

      await USDOContract.connect(owner).approve(cUSDOContract.address, MaxUint256);
      await cUSDOContract.connect(owner).deposit(parseUnits('2'), owner.address);
      await cUSDOContract.connect(owner).transfer(acc1.address, parseUnits('2'));
      await USDOContract.connect(owner).banAddresses([acc1.address]);

      await expect(cUSDOContract.connect(acc1).transfer(acc2.address, parseUnits('2'))).to.be.revertedWithCustomError(
        cUSDOContract,
        'cUSDOBlockedSender',
      );

      await USDOContract.connect(owner).unbanAddresses([acc1.address]);

      await expect(cUSDOContract.connect(acc1).transfer(acc1.address, parseUnits('2'))).not.to.be.reverted;
    });

    it('transfers the proper amount with a non default multiplier', async () => {
      const { cUSDOContract, USDOContract, owner, acc1 } = await loadFixture(deployFixture);
      const amount = '1999999692838904485'; // 1.999999692838904485

      await USDOContract.connect(owner).updateBonusMultiplier('1002948000000000000'); // 1.002948
      expect(await cUSDOContract.balanceOf(acc1.address)).to.equal(0);

      await USDOContract.connect(owner).approve(cUSDOContract.address, MaxUint256);
      await cUSDOContract.connect(owner).deposit(parseUnits('100'), owner.address);

      await cUSDOContract.connect(owner).transfer(acc1.address, amount);

      expect(await cUSDOContract.balanceOf(acc1.address)).to.equal('1999999692838904485');
    });
  });

  describe('Permit', () => {
    const buildData = async (
      contract: Contract,
      owner: SignerWithAddress,
      spender: SignerWithAddress,
      value: number,
      nonce: number,
      deadline: number | BigNumber,
    ) => {
      const domain = {
        name: await contract.name(),
        version: '1',
        chainId: (await contract.provider.getNetwork()).chainId,
        verifyingContract: contract.address,
      };

      const types = {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      };

      const message: Message = {
        owner: owner.address,
        spender: spender.address,
        value,
        nonce,
        deadline,
      };

      return { domain, types, message };
    };

    interface Message {
      owner: string;
      spender: string;
      value: number;
      nonce: number;
      deadline: number | BigNumber;
    }

    const signTypedData = async (
      signer: SignerWithAddress,
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      message: Message,
    ) => {
      const signature = await signer._signTypedData(domain, types, message);

      return splitSignature(signature);
    };

    it('initializes nonce at 0', async () => {
      const { cUSDOContract, acc1 } = await loadFixture(deployFixture);

      expect(await cUSDOContract.nonces(acc1.address)).to.equal(0);
    });

    it('returns the correct domain separator', async () => {
      const { cUSDOContract } = await loadFixture(deployFixture);
      const chainId = (await cUSDOContract.provider.getNetwork()).chainId;

      const expected = keccak256(
        defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
          [
            id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
            id(await cUSDOContract.name()),
            id('1'),
            chainId,
            cUSDOContract.address,
          ],
        ),
      );

      expect(await cUSDOContract.DOMAIN_SEPARATOR()).to.equal(expected);
    });

    it('accepts owner signature', async () => {
      const { cUSDOContract, owner, acc1: spender } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await cUSDOContract.nonces(owner.address);
      const deadline = MaxUint256;

      const { domain, types, message } = await buildData(cUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(owner, domain, types, message);

      await expect(cUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s))
        .to.emit(cUSDOContract, 'Approval')
        .withArgs(owner.address, spender.address, value);
      expect(await cUSDOContract.nonces(owner.address)).to.equal(1);
      expect(await cUSDOContract.allowance(owner.address, spender.address)).to.equal(value);
    });

    it('reverts reused signature', async () => {
      const { cUSDOContract, owner, acc1: spender } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await cUSDOContract.nonces(owner.address);
      const deadline = MaxUint256;

      const { domain, types, message } = await buildData(cUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(owner, domain, types, message);

      await cUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s);

      await expect(
        cUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s),
      ).to.be.revertedWithCustomError(cUSDOContract, 'ERC2612InvalidSignature');
    });

    it('reverts other signature', async () => {
      const { cUSDOContract, owner, acc1: spender, acc2: otherAcc } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await cUSDOContract.nonces(owner.address);
      const deadline = MaxUint256;

      const { domain, types, message } = await buildData(cUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(otherAcc, domain, types, message);

      await expect(cUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(cUSDOContract, 'ERC2612InvalidSignature')
        .withArgs(otherAcc.address, owner.address);
    });

    it('reverts expired permit', async () => {
      const { cUSDOContract, owner, acc1: spender } = await loadFixture(deployFixture);
      const value = 100;
      const nonce = await cUSDOContract.nonces(owner.address);
      const deadline = await time.latest();

      // Advance time by one hour and mine a new block
      await time.increase(3600);

      // Set the timestamp of the next block but don't mine a new block
      // New block timestamp needs larger than current, so we need to add 1
      const blockTimestamp = (await time.latest()) + 1;
      await time.setNextBlockTimestamp(blockTimestamp);

      const { domain, types, message } = await buildData(cUSDOContract, owner, spender, value, nonce, deadline);
      const { v, r, s } = await signTypedData(owner, domain, types, message);

      await expect(cUSDOContract.permit(owner.address, spender.address, value, deadline, v, r, s))
        .to.be.revertedWithCustomError(cUSDOContract, 'ERC2612ExpiredDeadline')
        .withArgs(deadline, blockTimestamp);
    });
  });

  describe.skip('Dust accumulation', () => {
    it('no dust during deposit and withdrawal', async () => {
      const { cUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);
      const initialDeposit = parseUnits('1', 18); // 1 USDO

      // Deposit USDO into cUSDO
      await USDOContract.updateBonusMultiplier(parseUnits('1', 18)); // Set to 1 initially
      await USDOContract.mint(owner.address, initialDeposit);
      await USDOContract.approve(cUSDOContract.address, initialDeposit);
      await cUSDOContract.deposit(initialDeposit, owner.address);

      // Withdraw the all amount
      await cUSDOContract.withdraw(initialDeposit, owner.address, owner.address);

      // Check for dust accumulation
      const remainingUSDO = await USDOContract.balanceOf(cUSDOContract.address);
      // Dust should be 0 when bonus multiplier is 1
      expect(remainingUSDO).to.be.eq(ethers.BigNumber.from('0'));
    });

    it('should adjust dust accumulation with multiplier change', async () => {
      const { cUSDOContract, USDOContract, owner } = await loadFixture(deployFixture);
      const initialDeposit = parseUnits('100000000000000', 18); // 1 USDO

      // Set initial multiplier and deposit USDO
      await USDOContract.updateBonusMultiplier(parseUnits('1', 18)); // Set to 1 initially
      await USDOContract.mint(owner.address, initialDeposit);
      await USDOContract.approve(cUSDOContract.address, initialDeposit);

      let lastDustBal = 0;
      let remainingUSDO = ethers.BigNumber.from('0');
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < 10; j++) {
          const randomDepositAmt = Math.floor(Math.random() * 1000000) + 1;
          const rawAmt = parseUnits(randomDepositAmt.toString(), 18);
          await cUSDOContract.deposit(rawAmt, owner.address);

          // Change the multiplier
          await USDOContract.updateBonusMultiplier(parseUnits('1.1', 18)); // Increase by 10%

          // Redeem all cUSDO
          const cUSDOBalance = await cUSDOContract.balanceOf(owner.address);
          const randomWithdraw = cUSDOBalance
            .mul(Math.floor(Math.random() * 100))
            .div(100)
            .toString();

          await cUSDOContract.redeem(randomWithdraw, owner.address, owner.address);

          const randomWithdrawReadable = formatEther(randomWithdraw);
          console.log(`\t\t${j}, randomDepositAmt: ${randomDepositAmt}, randomWithdrawAmt: ${randomWithdrawReadable}`);
        }

        // Check the accumulated dust
        const cUSDOBalance = await cUSDOContract.balanceOf(owner.address);
        await cUSDOContract.redeem(cUSDOBalance, owner.address, owner.address);

        remainingUSDO = await USDOContract.balanceOf(cUSDOContract.address);
        const dustChange = remainingUSDO.sub(lastDustBal);
        console.log(
          `${i}, dust now: ${remainingUSDO.toString()}, dust before: ${lastDustBal} dust change: ${dustChange.toString()}`,
        );

        lastDustBal = remainingUSDO.toNumber();
      }
      expect(remainingUSDO).to.be.lte(BigNumber.from('100')); // dust very small 1 / 10^18 USDO
    });
  });
});
