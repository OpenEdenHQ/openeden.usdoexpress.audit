import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

describe('USDONonEvmPoRAddressList Contract', function () {
  let porAddressList: Contract;
  let owner: HardhatEthersSigner;
  let addr1: HardhatEthersSigner;
  let addr2: HardhatEthersSigner;
  let addr1Address: string;
  let addr2Address: string;
  let testAddresses: string[];

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    addr1Address = addr1.address;
    addr2Address = addr2.address;

    // Initialize with some test addresses
    testAddresses = [
      'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', // Example XRPL address 1
      'rG1QQv2nh2gr7RCZ1P8YYcBUKCCN633jCn', // Example XRPL address 2
      'r4LqUeDxgcziGfDDnWAWkSFf3C5qqwwKQP', // Example XRPL address 3
    ];

    const PoRAddressList = await ethers.getContractFactory('USDONonEvmPoRAddressList');
    porAddressList = await PoRAddressList.deploy('xrpl', testAddresses);
    await porAddressList.waitForDeployment();
  });

  describe('Deployment', function () {
    it('Should deploy successfully and initialize with provided addresses', async function () {
      const length = await porAddressList.getPoRAddressListLength();
      expect(length).to.equal(3);

      const addresses = await porAddressList.getPoRAddressList(0, 2);
      expect(addresses).to.deep.equal(testAddresses);
    });
  });

  describe('addPoRAddresses()', function () {
    it('Should allow the owner to add new addresses', async function () {
      const newAddresses = ['r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59', 'r3kmLJN5D28dHuH8vZNUZpMC43pEHpaocV'];

      await porAddressList.addPoRAddresses(newAddresses);

      const length = await porAddressList.getPoRAddressListLength();
      expect(length).to.equal(5);

      const allAddresses = await porAddressList.getPoRAddressList(0, 4);
      expect(allAddresses).to.deep.equal([...testAddresses, ...newAddresses]);
    });

    it('Should revert if called by a non-owner', async function () {
      await expect(porAddressList.connect(addr1).addPoRAddresses([])).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });

  describe('removePoRAddress()', function () {
    it('Should allow the owner to remove an address', async function () {
      await porAddressList.removePoRAddress(0);

      const length = await porAddressList.getPoRAddressListLength();
      expect(length).to.equal(2);

      const remainingAddresses = await porAddressList.getPoRAddressList(0, 1);
      expect(remainingAddresses).to.deep.equal([testAddresses[2], testAddresses[1]]); // Last element swapped in
    });

    it('Should revert if index is out of bounds', async function () {
      await expect(porAddressList.removePoRAddress(3)).to.be.revertedWithCustomError(
        porAddressList,
        'IndexOutOfBounds',
      );
    });

    it('Should revert if called by a non-owner', async function () {
      await expect(porAddressList.connect(addr1).removePoRAddress(0)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });

  describe('getPoRAddressList()', function () {
    it('Should return the correct segment of addresses', async function () {
      const result = await porAddressList.getPoRAddressList(0, 1);
      expect(result.length).to.equal(2);
      expect(result).to.deep.equal([testAddresses[0], testAddresses[1]]);
    });

    it('Should return empty array if startIndex > endIndex', async function () {
      const result = await porAddressList.getPoRAddressList(2, 0);
      expect(result).to.deep.equal([]);
    });

    it('Should handle out-of-bounds endIndex gracefully', async function () {
      const result = await porAddressList.getPoRAddressList(0, 10);
      expect(result.length).to.equal(3);
      expect(result).to.deep.equal(testAddresses);
    });
  });

  describe('Access Control', function () {
    it('Should only allow the owner to call restricted functions', async function () {
      await expect(porAddressList.connect(addr1).addPoRAddresses([])).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );

      await expect(porAddressList.connect(addr1).removePoRAddress(0)).to.be.revertedWith(
        'Ownable: caller is not the owner',
      );
    });
  });
});
