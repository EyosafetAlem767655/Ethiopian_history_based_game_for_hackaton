import { it, expect } from 'vitest';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from '../scripts/contracts';
it('enforces attestor access, result replay protection, and one badge per recipient', async () => {
  const provider = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' } });
  try {
    const transport = custom(provider as any),
      wallet = createWalletClient({ transport }),
      pub = createPublicClient({ transport }),
      accounts = Object.values(provider.getInitialAccounts()).map((a) =>
        privateKeyToAccount(a.secretKey as `0x${string}`),
      ),
      c = compile();
    const tx = await wallet.deployContract({
      account: accounts[0],
      chain: null,
      abi: c.abi,
      bytecode: ('0x' + c.evm.bytecode.object) as `0x${string}`,
      args: [accounts[0].address, 'ipfs://royal/{id}.json'],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: tx }),
      address = receipt.contractAddress!;
    const args = [
      keccak256(stringToHex('match')),
      keccak256(stringToHex('result')),
      keccak256(stringToHex('winner')),
    ];
    await expect(
      pub.simulateContract({
        address,
        abi: c.abi,
        functionName: 'attest',
        args,
        account: accounts[1].address,
      }),
    ).rejects.toThrow();
    const write = await wallet.writeContract({
      address,
      abi: c.abi,
      functionName: 'attest',
      args,
      account: accounts[0],
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash: write });
    await expect(
      pub.simulateContract({
        address,
        abi: c.abi,
        functionName: 'attest',
        args,
        account: accounts[0].address,
      }),
    ).rejects.toThrow();
    const award = await wallet.writeContract({
      address,
      abi: c.abi,
      functionName: 'award',
      args: [accounts[1].address, 1n],
      account: accounts[0],
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash: award });
    expect(
      await pub.readContract({
        address,
        abi: c.abi,
        functionName: 'balanceOf',
        args: [accounts[1].address, 1n],
      }),
    ).toBe(1n);
    await expect(
      pub.simulateContract({
        address,
        abi: c.abi,
        functionName: 'award',
        args: [accounts[1].address, 1n],
        account: accounts[0].address,
      }),
    ).rejects.toThrow();
  } finally {
    await provider.disconnect();
  }
});
