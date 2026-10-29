import { beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { parseSiweMessage } from 'viem/siwe';

process.env.DB_PATH = ':memory:';
process.env.WALLET_ORIGIN = 'http://localhost:5173';
const { createProfile, db } = await import('../apps/server/src/store');
const { bindWallet, checkWalletOrigin, issueWalletChallenge, walletIdentity } = await import(
  '../apps/server/src/wallet'
);
const account = () => privateKeyToAccount(generatePrivateKey());

beforeEach(() => {
  db.exec('DELETE FROM wallet_nonces; DELETE FROM wallets; DELETE FROM profiles;');
});

describe('wallet ownership and player identity', () => {
  it('issues a fresh, expiring challenge bound to the site, network, wallet and player', () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      first = issueWalletChallenge(player.id, wallet.address),
      second = issueWalletChallenge(player.id, wallet.address),
      message = parseSiweMessage(second.message);
    expect(message).toMatchObject({
      domain: 'localhost:5173',
      scheme: 'http',
      uri: 'http://localhost:5173',
      chainId: 84532,
      address: wallet.address,
      requestId: player.id,
      version: '1',
    });
    expect(message.nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(parseSiweMessage(first.message).nonce).not.toBe(message.nonce);
    expect(message.expirationTime!.getTime() - message.issuedAt!.getTime()).toBe(300000);
    expect(message.expirationTime!.toISOString()).toBe(second.expiresAt);
    expect(walletIdentity(player.id).status).toBe('pending');
  });

  it('links a valid signature to a stable wallet ID and permits fresh verification of the same link', async () => {
    const player = createProfile('Sam', false),
      wallet = account();
    for (let n = 0; n < 2; n++) {
      const challenge = issueWalletChallenge(player.id, wallet.address),
        signature = await wallet.signMessage({ message: challenge.message }),
        identity = await bindWallet(player.id, wallet.address, signature);
      expect(identity).toEqual({
        status: 'verified',
        address: wallet.address.toLowerCase(),
        playerId: `eip155:84532:${wallet.address.toLowerCase()}`,
        chainId: 84532,
        registration: 'off-chain',
      });
    }
    expect(db.prepare('SELECT * FROM wallet_nonces').all()).toHaveLength(0);
    expect(db.prepare('SELECT * FROM wallets').all()).toHaveLength(1);
  });

  it('rejects a signature made by a different wallet and preserves the challenge for its owner', async () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      stranger = account(),
      challenge = issueWalletChallenge(player.id, wallet.address);
    await expect(
      bindWallet(
        player.id,
        wallet.address,
        await stranger.signMessage({ message: challenge.message }),
      ),
    ).rejects.toThrow('Wallet signature invalid');
    expect(walletIdentity(player.id).status).toBe('pending');
    await expect(
      bindWallet(
        player.id,
        wallet.address,
        await wallet.signMessage({ message: challenge.message }),
      ),
    ).resolves.toMatchObject({ status: 'verified' });
  });

  it('rejects changing the address after the challenge was issued', async () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      other = account(),
      challenge = issueWalletChallenge(player.id, wallet.address);
    await expect(
      bindWallet(player.id, other.address, await other.signMessage({ message: challenge.message })),
    ).rejects.toThrow('Challenge does not match');
  });

  it('rejects reusing a signature for another player', async () => {
    const sam = createProfile('Sam', false),
      other = createProfile('Other', false),
      wallet = account(),
      challenge = issueWalletChallenge(sam.id, wallet.address);
    issueWalletChallenge(other.id, wallet.address);
    const signature = await wallet.signMessage({ message: challenge.message });
    await expect(bindWallet(other.id, wallet.address, signature)).rejects.toThrow(
      'Wallet signature invalid',
    );
    expect(walletIdentity(other.id).status).toBe('pending');
  });

  it('rejects expired challenges', async () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      challenge = issueWalletChallenge(player.id, wallet.address),
      signature = await wallet.signMessage({ message: challenge.message });
    db.prepare('UPDATE wallet_nonces SET expires=? WHERE player_id=?').run(
      Date.now() - 1,
      player.id,
    );
    await expect(bindWallet(player.id, wallet.address, signature)).rejects.toThrow(
      'fresh signing challenge',
    );
    expect(walletIdentity(player.id).status).toBe('pending');
  });

  it('rejects a superseded challenge', async () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      old = issueWalletChallenge(player.id, wallet.address),
      signature = await wallet.signMessage({ message: old.message });
    issueWalletChallenge(player.id, wallet.address);
    await expect(bindWallet(player.id, wallet.address, signature)).rejects.toThrow(
      'Wallet signature invalid',
    );
  });

  it('accepts exactly one of two concurrent attempts to consume the same challenge', async () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      challenge = issueWalletChallenge(player.id, wallet.address),
      signature = await wallet.signMessage({ message: challenge.message }),
      results = await Promise.allSettled([
        bindWallet(player.id, wallet.address, signature),
        bindWallet(player.id, wallet.address, signature),
      ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(bindWallet(player.id, wallet.address, signature)).rejects.toThrow(
      'fresh signing challenge',
    );
  });

  it('rejects a challenge replaced while signature verification is in flight', async () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      old = issueWalletChallenge(player.id, wallet.address),
      signature = await wallet.signMessage({ message: old.message }),
      pending = bindWallet(player.id, wallet.address, signature),
      fresh = issueWalletChallenge(player.id, wallet.address);
    await expect(pending).rejects.toThrow('already used or replaced');
    await expect(
      bindWallet(player.id, wallet.address, await wallet.signMessage({ message: fresh.message })),
    ).resolves.toMatchObject({ status: 'verified' });
  });

  it('preserves an existing owner when two profiles race to link one wallet', async () => {
    const sam = createProfile('Sam', false),
      other = createProfile('Other', false),
      wallet = account(),
      a = issueWalletChallenge(sam.id, wallet.address),
      b = issueWalletChallenge(other.id, wallet.address),
      sa = await wallet.signMessage({ message: a.message }),
      sb = await wallet.signMessage({ message: b.message });
    await bindWallet(sam.id, wallet.address, sa);
    await expect(bindWallet(other.id, wallet.address, sb)).rejects.toMatchObject({ status: 409 });
    expect(walletIdentity(sam.id).status).toBe('verified');
    expect(walletIdentity(other.id).status).toBe('pending');
    expect(() => issueWalletChallenge(other.id, wallet.address)).toThrow(
      'already linked to another',
    );
  });

  it('prevents silently replacing the wallet on an existing profile', async () => {
    const player = createProfile('Sam', false),
      wallet = account(),
      otherWallet = account(),
      a = issueWalletChallenge(player.id, wallet.address),
      sa = await wallet.signMessage({ message: a.message });
    await bindWallet(player.id, wallet.address, sa);
    expect(() => issueWalletChallenge(player.id, otherWallet.address)).toThrow(
      'already has a wallet',
    );
    expect(walletIdentity(player.id)).toMatchObject({ address: wallet.address.toLowerCase() });
  });

  it('limits browser wallet requests to the configured website origin', () => {
    expect(() => checkWalletOrigin('http://localhost:5173')).not.toThrow();
    expect(() => checkWalletOrigin(undefined)).not.toThrow();
    expect(() => checkWalletOrigin('https://different.example')).toThrow('configured game website');
  });
});
