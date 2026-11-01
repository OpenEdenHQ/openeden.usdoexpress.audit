import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

describe('USDOMultiEVMPoRAddressList Contract', function () {
  let porAddressList: Contract;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;
  let addr2: HardhatEthersSigner;
  let addr1Address: string;
  let addr2Address: string;
  let porInfo: any;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    addr1Address = addr1.address;
    addr2Address = addr2.address;

    const PoRAddressList = await ethers.getContractFactory('USDOMultiEVMPoRAddressList');
    porAddressList = await PoRAddressList.deploy();
    await porAddressList.waitForDeployment();

    porInfo = [
      {
        chain: 'Ethereum',
        chainId: 1,
        tokenSymbol: 'USDT',
        tokenAddress: addr1Address,
        tokenDecimals: 6,
        tokenPriceOracle: ethers.ZeroAddress,
        yourVaultAddress: addr1Address,
      },
      {
        chain: 'Polygon',
        chainId: 137,
        tokenSymbol: 'USDC',
        tokenAddress: addr2Address,
        tokenDecimals: 6,
        tokenPriceOracle: ethers.ZeroAddress,
        yourVaultAddress: addr2Address,
      },
      {
        chain: 'Binance',
        chainId: 56,
        tokenSymbol: 'TBILL',
        tokenAddress: addr2Address,
        tokenDecimals: 6,
        tokenPriceOracle: ethers.ZeroAddress,
        yourVaultAddress: addr2Address,
      },
    ];
  });

  describe('Deployment', function () {
    it('Should deploy successfully and have no addresses initially', async function () {
      const length = await porAddressList.getPoRAddressListLength();
      expect(length).to.equal(0);
    });
  });

  describe('addPoRInfos()', function () {
    it('Should allow the owner to add PoRInfo entries', async function () {
      await porAddressList.addPoRInfos(porInfo);

      const length = await porAddressList.getPoRAddressListLength();
      expect(length).to.equal(3);
    });

    it('Should revert if called by a non-owner', async function () {
      await expect(porAddressList.connect(addr1).addPoRInfos([])).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });

  describe('removePoRInfo()', function () {
    beforeEach(async function () {
      await porAddressList.addPoRInfos(porInfo);
    });

    it('Should allow the owner to remove a PoRInfo entry', async function () {
      await porAddressList.removePoRInfo(0);

      const length = await porAddressList.getPoRAddressListLength();
      expect(length).to.equal(2);

      const remainingInfo = await porAddressList.getPoRAddressList(0, 1);
      expect(remainingInfo[0].tokenAddress).to.equal(addr2Address); // Last element swapped in
    });

    it('Should revert if index is out of bounds', async function () {
      await expect(porAddressList.removePoRInfo(3)).to.be.revertedWithCustomError(porAddressList, 'IndexOutOfBounds');
    });
  });

  describe('getPoRAddressList()', function () {
    beforeEach(async function () {
      await porAddressList.addPoRInfos(porInfo);
    });

    it('Should return the correct segment of PoRInfo entries', async function () {
      const result = await porAddressList.getPoRAddressList(0, 2);
      expect(result.length).to.equal(3);
      expect(result[0].tokenAddress).to.equal(addr1Address);
      expect(result[1].tokenAddress).to.equal(addr2Address);
    });

    it('Should revert with InvalidIndexRange if startIndex > endIndex', async function () {
      await expect(porAddressList.getPoRAddressList(2, 0)).to.be.revertedWithCustomError(
        porAddressList,
        'InvalidIndexRange',
      );
    });

    it('Should handle out-of-bounds endIndex gracefully', async function () {
      const result = await porAddressList.getPoRAddressList(0, 10);
      expect(result.length).to.equal(3);
    });
  });

  describe('Access Control', function () {
    it('Should only allow the owner to call restricted functions', async function () {
      await expect(porAddressList.connect(addr1).addPoRInfos([])).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );

      await expect(porAddressList.connect(addr1).removePoRInfo(0)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });
});
