import { it, expect } from 'vitest';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from '../scripts/contracts';
import {
  canonical,
  digest,
  matchKey,
  parseResult,
  recordsAbi,
  winnerKey,
  type ResultProof,
} from '../packages/shared/src/results';
import { verifyProof, type AnchorReader } from '../apps/web/src/services/proofs';
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
    const payload = parseResult(
      JSON.stringify({
        version: 3,
        matchId: 'match',
        mode: 'duel',
        demo: false,
        winner: 0,
        scoreline: [570, 490],
        startedAt: '2026-10-29T00:00:00.000Z',
        endedAt: '2026-10-29T00:01:00.000Z',
        participants: [
          { id: 'a', name: 'A', bot: false, team: 0, identity: { kind: 'profile' } },
          { id: 'b', name: 'B', bot: true, team: 1, identity: { kind: 'bot' } },
        ],
      }),
    );
    const args = [matchKey(payload.matchId), digest(payload), winnerKey(payload)];
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
    const proof: ResultProof = {
      matchId: payload.matchId,
      payload: canonical(payload),
      hash: digest(payload),
      status: 'confirmed',
      tx: write,
      simulated: false,
      chain: { chainId: 84532, contract: address },
    };
    const read: AnchorReader = (target, key) =>
      pub.readContract({
        address: target,
        abi: recordsAbi,
        functionName: 'records',
        args: [key],
      });
    expect(await verifyProof(proof, read, address)).toMatchObject({
      local: { status: 'match' },
      chain: 'match',
    });
    // Even changing both the stored score AND its saved hash cannot match the old anchor.
    const changed = { ...payload, scoreline: [580, 490] };
    expect(
      await verifyProof(
        { ...proof, payload: canonical(changed), hash: digest(changed) },
        read,
        address,
      ),
    ).toMatchObject({ local: { status: 'match' }, chain: 'mismatch' });
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
