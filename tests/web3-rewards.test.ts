import { expect, it, vi } from 'vitest';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { fighter, world } from '../packages/shared/src/game';
import { registrationData, profileKey, rewardsAbi } from '../packages/shared/src/web3';
import {
  matchKey,
  recordsAbi,
  digest,
  parseResult,
  winnerKey,
} from '../packages/shared/src/results';
import { compile } from '../scripts/contracts';

process.env.DB_PATH = ':memory:';
process.env.ALLOW_CHAIN_BROADCAST = 'false';
const store = await import('../apps/server/src/store');
const walletLinks = await import('../apps/server/src/wallet');
const web3 = await import('../apps/server/src/web3');
const { ChainRewardsAdapter } = await import('../apps/server/src/chain-rewards');

it('simulates registration and only earned badge claims without invoking any chain adapter', async () => {
  const p = await store.createProfile('Simulation', true);
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = await walletLinks.issueWalletChallenge(p.id, account.address);
  await walletLinks.bindWallet(
    p.id,
    account.address,
    await account.signMessage({ message: challenge.message }),
  );
  await expect(web3.queueBadge(p, 'First Blood')).rejects.toThrow(/recorded match/);
  const w = world('duel', true);
  w.players = [fighter(p.id, p.name), fighter('bot', 'Bot', 1, true)];
  w.winner = 0;
  w.finished = true;
  await store.recordResult('sim-badge', w, new Date().toISOString());
  expect(await web3.queueRegistration(p)).toMatchObject({ status: 'simulated' });
  expect(await web3.queueBadge(p, 'First Blood')).toMatchObject({
    status: 'simulated',
    tokenId: 1,
  });
  expect(await web3.queueBadge(p, 'First Blood')).toMatchObject({ status: 'simulated' });
  expect((await web3.web3Inventory(p.id)).jobs).toHaveLength(2);
  await expect(web3.queueBadge(p, 'Crown Champion')).rejects.toThrow(/recorded match/);
  const execute = vi.fn();
  await web3.processWeb3Jobs({ execute });
  expect(execute).not.toHaveBeenCalled();
});

it('registers a consenting wallet and reconciles a badge receipt outage without a duplicate mint', async () => {
  const provider = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 84532, hardfork: 'shanghai' },
  });
  try {
    const transport = custom(provider as any),
      pub = createPublicClient({ transport }),
      wallet = createWalletClient({ transport });
    const accounts = Object.values(provider.getInitialAccounts()).map((a) =>
      privateKeyToAccount(a.secretKey as Hex),
    );
    const contract = compile();
    const deployment = await wallet.deployContract({
      account: accounts[0],
      chain: null,
      abi: contract.abi,
      bytecode: ('0x' + contract.evm.bytecode.object) as Hex,
      args: [accounts[0].address, 'https://fixture.invalid/achievements/{id}.json'],
    });
    const address = (await pub.waitForTransactionReceipt({ hash: deployment })).contractAddress!;
    process.env.ALLOW_CHAIN_BROADCAST = 'true';
    process.env.RECORDS_ADDRESS = address;
    const p = await store.createProfile('Live fixture', false);
    await store.db
      .prepare('INSERT INTO hosted_identities(id,auth_id) VALUES (?,?)')
      .run(p.id, p.id);
    await store.db
      .prepare(
        'INSERT INTO age_reviews(id,player_id,status,birth_date,created,expires) VALUES (?,?,?,?,?,?)',
      )
      .run(p.id, p.id, 'approved', '2000-01-01', Date.now(), Date.now() + 86400000);
    const link = await walletLinks.issueWalletChallenge(p.id, accounts[1].address);
    await walletLinks.bindWallet(
      p.id,
      accounts[1].address,
      await accounts[1].signMessage({ message: link.message }),
    );
    const challenge = await web3.registrationChallenge(p);
    if (challenge.mode !== 'testnet') throw Error('Expected live fixture');
    const typed = registrationData(
      address,
      challenge.owner,
      challenge.profileHash,
      challenge.deadline,
      challenge.nonce,
    );
    await expect(web3.queueRegistration(p, await accounts[2].signTypedData(typed))).rejects.toThrow(
      /signature/,
    );
    const wrongDomain = {
      ...typed,
      domain: { ...typed.domain, verifyingContract: accounts[2].address },
    };
    await expect(
      web3.queueRegistration(p, await accounts[1].signTypedData(wrongDomain)),
    ).rejects.toThrow(/signature/);
    const signature = await accounts[1].signTypedData(typed);
    const requests = await Promise.allSettled([
      web3.queueRegistration(p, signature),
      web3.queueRegistration(p, signature),
    ]);
    expect(requests.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    await store.db
      .prepare(
        "UPDATE web3_jobs SET status='processing',lease_until=?,attempts=1 WHERE player_id=? AND kind='profile'",
      )
      .run(Date.now() - 1, p.id);
    let registrations = 0,
      awards = 0,
      failReceipt = false,
      badgeTx: Hex | undefined;
    const adapter = new ChainRewardsAdapter({
      profile: (owner) =>
        pub.readContract({ address, abi: rewardsAbi, functionName: 'profiles', args: [owner] }),
      awarded: (owner, id) =>
        pub.readContract({
          address,
          abi: rewardsAbi,
          functionName: 'awarded',
          args: [owner, BigInt(id)],
        }),
      record: (id) =>
        pub.readContract({
          address,
          abi: recordsAbi,
          functionName: 'records',
          args: [matchKey(id)],
        }),
      register: async (data) => {
        registrations++;
        return wallet.writeContract({
          address,
          abi: rewardsAbi,
          functionName: 'registerProfile',
          args: [data.owner, data.profileHash, BigInt(data.deadline), data.nonce, data.signature!],
          account: accounts[0],
          chain: null,
        });
      },
      award: async (data) => {
        awards++;
        badgeTx = await wallet.writeContract({
          address,
          abi: rewardsAbi,
          functionName: 'award',
          args: [data.owner, BigInt(data.tokenId)],
          account: accounts[0],
          chain: null,
        });
        return badgeTx;
      },
      receipt: async (hash) => {
        if (hash === badgeTx && failReceipt) {
          failReceipt = false;
          throw Error('Synthetic receipt outage');
        }
        return (await pub.waitForTransactionReceipt({ hash })).status;
      },
    });
    await web3.processWeb3Jobs(adapter);
    expect(registrations).toBe(1);
    expect(
      await pub.readContract({
        address,
        abi: rewardsAbi,
        functionName: 'profiles',
        args: [accounts[1].address],
      }),
    ).toBe(profileKey(p.id));
    expect((await web3.web3Inventory(p.id)).jobs[0]?.status).toBe('confirmed');
    await expect(
      pub.simulateContract({
        address,
        abi: rewardsAbi,
        functionName: 'registerProfile',
        args: [
          challenge.owner,
          challenge.profileHash,
          BigInt(challenge.deadline),
          challenge.nonce,
          signature,
        ],
        account: accounts[0].address,
      }),
    ).rejects.toThrow();

    const w = world('duel', false);
    w.players = [fighter(p.id, p.name), fighter('opponent', 'Opponent', 1, true)];
    w.winner = 0;
    w.finished = true;
    await store.recordResult('earned-live-badge', w, new Date().toISOString());
    await expect(web3.queueBadge(p, 'First Blood')).rejects.toThrow(/confirmed non-demo/);
    const result = await store.db
      .prepare('SELECT payload FROM results WHERE id=?')
      .get('earned-live-badge');
    const payload = parseResult(result.payload);
    // A forged DB "confirmed" flag alone still cannot authorize an on-chain badge.
    await store.db
      .prepare("UPDATE outbox SET status='confirmed' WHERE match_id=?")
      .run('earned-live-badge');
    await web3.queueBadge(p, 'First Blood');
    await web3.processWeb3Jobs(adapter);
    expect(awards).toBe(0);
    const anchor = await wallet.writeContract({
      address,
      abi: recordsAbi,
      functionName: 'attest',
      args: [matchKey('earned-live-badge'), digest(payload), winnerKey(payload)],
      account: accounts[0],
      chain: null,
    });
    await pub.waitForTransactionReceipt({ hash: anchor });
    await web3.queueBadge(p, 'First Blood');
    failReceipt = true;
    await web3.processWeb3Jobs(adapter);
    const pending = (await web3.web3Inventory(p.id)).jobs.find((job) => job?.kind === 'badge');
    expect(pending).toMatchObject({ status: 'failed', tx: badgeTx });
    expect(awards).toBe(1);
    await web3.queueBadge(p, 'First Blood');
    await web3.processWeb3Jobs(adapter);
    expect((await web3.web3Inventory(p.id)).jobs.find((job) => job?.kind === 'badge')?.status).toBe(
      'confirmed',
    );
    expect(awards).toBe(1);
    expect(
      await pub.readContract({
        address,
        abi: rewardsAbi,
        functionName: 'balanceOf',
        args: [accounts[1].address, 1n],
      }),
    ).toBe(1n);
    await web3.queueBadge(p, 'First Blood');
    await web3.processWeb3Jobs(adapter);
    expect(awards).toBe(1);
    await expect(web3.queueBadge(p, 'Crown Champion')).rejects.toThrow(/recorded match/);
  } finally {
    process.env.ALLOW_CHAIN_BROADCAST = 'false';
    await provider.disconnect();
  }
});
