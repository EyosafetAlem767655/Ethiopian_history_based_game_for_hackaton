import { randomBytes } from 'node:crypto';
import { getAddress, verifyMessage, type Address, type Hex } from 'viem';
import { createSiweMessage, parseSiweMessage } from 'viem/siwe';
import { db } from './store';
import { resultChainId, walletAccountId } from '../../../packages/shared/src/results';

export const walletChainId = resultChainId;
const site = new URL(
  process.env.WALLET_ORIGIN ?? process.env.CORS_ORIGINS?.split(',')[0] ?? 'http://localhost:5173',
);
if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password)
  throw Error('WALLET_ORIGIN must be an HTTP or HTTPS website origin');
export const walletOrigin = site.origin;

export class WalletLinkError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function checkWalletOrigin(origin?: string) {
  if (origin && origin !== walletOrigin)
    throw new WalletLinkError('Open the configured game website to link your wallet', 403);
}

// This verifies a database link; it does not register the profile on-chain.
export async function walletIdentity(playerId: string) {
  const row = (await db.prepare('SELECT address FROM wallets WHERE player_id=?').get(playerId)) as
    | { address: string }
    | undefined;
  return row
    ? {
        status: 'verified' as const,
        address: row.address,
        playerId: walletAccountId(row.address),
        chainId: walletChainId,
        registration: 'off-chain' as const,
      }
    : { status: 'pending' as const, label: 'Wallet not connected' };
}

async function checkBinding(playerId: string, address: string) {
  const current = (await db
    .prepare('SELECT address FROM wallets WHERE player_id=?')
    .get(playerId)) as { address: string } | undefined;
  if (current && current.address !== address)
    throw new WalletLinkError(
      'This profile already has a wallet. Select your linked account.',
      409,
    );
  const owner = (await db.prepare('SELECT player_id FROM wallets WHERE address=?').get(address)) as
    | { player_id: string }
    | undefined;
  if (owner && owner.player_id !== playerId)
    throw new WalletLinkError('This wallet is already linked to another player profile.', 409);
}

export async function issueWalletChallenge(playerId: string, address: Address) {
  const normalized = getAddress(address).toLowerCase();
  await checkBinding(playerId, normalized);
  const issuedAt = new Date(),
    expirationTime = new Date(issuedAt.getTime() + 5 * 60 * 1000);
  const message = createSiweMessage({
    scheme: site.protocol.slice(0, -1),
    domain: site.host,
    address: getAddress(address),
    statement: `Link this wallet to Ethiopian Knights player ${playerId}. This does not authorize transactions.`,
    uri: walletOrigin,
    version: '1',
    chainId: walletChainId,
    nonce: randomBytes(16).toString('hex'),
    issuedAt,
    expirationTime,
    requestId: playerId,
  });
  await db
    .prepare(
      `INSERT INTO wallet_nonces VALUES (?,?,?) ON CONFLICT(player_id)
     DO UPDATE SET nonce=excluded.nonce,expires=excluded.expires`,
    )
    .run(playerId, message, expirationTime.getTime());
  return { message, expiresAt: expirationTime.toISOString(), chainId: walletChainId };
}

export async function bindWallet(playerId: string, address: Address, signature: Hex) {
  const normalized = getAddress(address).toLowerCase();
  const row = (await db
    .prepare('SELECT nonce,expires FROM wallet_nonces WHERE player_id=?')
    .get(playerId)) as { nonce: string; expires: number } | undefined;
  if (!row || row.expires <= Date.now())
    throw new WalletLinkError('Request a fresh signing challenge');
  const message = parseSiweMessage(row.nonce);
  // Verify the server's stored message, never a message supplied by the browser.
  if (
    message.address?.toLowerCase() !== normalized ||
    message.domain !== site.host ||
    message.scheme !== site.protocol.slice(0, -1) ||
    message.uri !== walletOrigin ||
    message.chainId !== walletChainId ||
    message.version !== '1' ||
    message.requestId !== playerId ||
    message.expirationTime?.getTime() !== Number(row.expires)
  )
    throw new WalletLinkError(
      'Challenge does not match this wallet and player. Request a fresh one.',
    );
  if (!(await verifyMessage({ address, message: row.nonce, signature })))
    throw new WalletLinkError('Wallet signature invalid');

  // Verification yields to other requests. Consume the exact, still-valid challenge
  // and save the binding in one transaction so concurrent signatures cannot replay it.
  await db.transaction(async () => {
    const consumed = await db
      .prepare('DELETE FROM wallet_nonces WHERE player_id=? AND nonce=? AND expires>?')
      .run(playerId, row.nonce, Date.now());
    if (consumed.changes !== 1)
      throw new WalletLinkError(
        'Challenge expired or was already used or replaced. Request a fresh one.',
      );
    await checkBinding(playerId, normalized);
    await db
      .prepare('INSERT INTO wallets VALUES (?,?) ON CONFLICT(player_id) DO NOTHING')
      .run(playerId, normalized);
  })();
  return walletIdentity(playerId);
}
