import React, { useState } from 'react';
import { createPublicClient, getAddress, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  profileKey,
  registrationData,
  rewardsAbi,
  badgeTokenId,
} from '../../../packages/shared/src/web3';
import { resultChainId } from '../../../packages/shared/src/results';
import { api, useUI } from './store';

export function Web3Panel({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const me = useUI((s) => s.me);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [balances, setBalances] = useState<Record<string, string>>({});
  if (!me?.wallet?.address || !me.web3) return null;
  const simulated = me.web3.mode === 'simulated';
  const jobs: {
    id: string;
    kind: string;
    status: string;
    tx: string | null;
    error: string | null;
    badge?: string;
    tokenId?: number;
    contract: string | null;
  }[] = me.web3.jobs;
  const registration = jobs.find((job) => job.kind === 'profile');
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="wallet-panel web3-panel" aria-label="Blockchain profile and rewards">
      <h3>Blockchain profile and achievement tokens</h3>
      <p>
        {simulated
          ? 'Simulation mode: no blockchain transactions or tokens are created.'
          : 'Base Sepolia testnet: the game server pays the test transaction fee. These badges have no promised monetary value.'}
      </p>
      <p>
        Profile registration:{' '}
        <strong>{registration?.status.toUpperCase() ?? 'NOT REQUESTED'}</strong>
      </p>
      <p className="hash">Profile digest: {me.web3.profileHash}</p>
      <button
        className="outline-btn"
        disabled={
          busy ||
          registration?.status === 'confirmed' ||
          ['pending', 'processing'].includes(registration?.status ?? '')
        }
        onClick={() =>
          void action(async () => {
            if (simulated) {
              await api('/web3/profile/register', {});
              return;
            }
            const official = import.meta.env.VITE_RECORDS_ADDRESS;
            if (!official || !/^0x[0-9a-fA-F]{40}$/.test(official))
              throw Error('The official testnet contract is not configured in this website.');
            const provider = (window as any).ethereum;
            if (!provider) throw Error('Open your browser wallet to approve profile registration.');
            const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' });
            if (accounts[0]?.toLowerCase() !== me.wallet.address.toLowerCase())
              throw Error('Select your linked wallet account.');
            const challenge = await api('/web3/profile/challenge', {});
            if (
              challenge.mode !== 'testnet' ||
              challenge.chainId !== resultChainId ||
              challenge.contract?.toLowerCase() !== official.toLowerCase() ||
              challenge.owner?.toLowerCase() !== accounts[0].toLowerCase() ||
              challenge.profileHash !== profileKey(me.profile.id) ||
              !/^0x[0-9a-fA-F]{64}$/.test(challenge.nonce) ||
              !Number.isInteger(challenge.deadline) ||
              challenge.deadline * 1000 <= Date.now() ||
              challenge.deadline * 1000 > Date.now() + 660000
            )
              throw Error(
                'The registration request does not match this profile and the official contract.',
              );
            await provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x' + resultChainId.toString(16) }],
            });
            // Build the known typed message ourselves; never ask the wallet to sign arbitrary server-provided types.
            const data = registrationData(
              getAddress(official),
              getAddress(accounts[0]),
              challenge.profileHash,
              challenge.deadline,
              challenge.nonce,
            );
            const signature = await provider.request({
              method: 'eth_signTypedData_v4',
              params: [
                accounts[0],
                JSON.stringify(data, (_key, value) =>
                  typeof value === 'bigint' ? value.toString() : value,
                ),
              ],
            });
            await api('/web3/profile/register', { signature });
          })
        }
      >
        {busy
          ? 'WORKING…'
          : simulated
            ? 'SIMULATE PROFILE REGISTRATION'
            : 'AUTHORIZE PROFILE REGISTRATION'}
      </button>
      <p className="subtle">
        Wallet linking proves ownership. Registration is a separate request; the signature is
        limited to your profile, this deployment, and ten minutes.
      </p>
      <button className="outline-btn" disabled={busy} onClick={() => void action(onRefresh)}>
        REFRESH STATUS
      </button>
      {(me.badges ?? []).map((badge: { badge: string }) => {
        const tokenId = badgeTokenId(badge.badge);
        if (!tokenId || tokenId === 8) return null; // Gathering consent is not a match-result mint source.
        const job = jobs.find((item) => item.badge === badge.badge);
        return (
          <div className="badge" key={badge.badge}>
            <strong>{badge.badge}</strong>
            <p>
              {job ? job.status.toUpperCase() : 'EARNED OFF-CHAIN'} · Token type {tokenId}
            </p>
            <button
              className="outline-btn"
              disabled={
                busy ||
                !registration ||
                !['confirmed', 'simulated'].includes(registration.status) ||
                ['confirmed', 'pending', 'processing', 'simulated'].includes(job?.status ?? '')
              }
              onClick={() =>
                void action(async () => {
                  await api('/web3/badges', { badge: badge.badge });
                })
              }
            >
              {simulated
                ? 'SIMULATE TOKEN CLAIM'
                : job?.status === 'failed'
                  ? 'RETRY TOKEN CLAIM'
                  : 'CLAIM TESTNET TOKEN'}
            </button>
            {job?.error && <p role="alert">{job.error}</p>}
            {!simulated && job?.status === 'confirmed' && (
              <button
                className="outline-btn"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const official = import.meta.env.VITE_RECORDS_ADDRESS;
                    if (!official || official.toLowerCase() !== job.contract?.toLowerCase())
                      throw Error('The claim is not from the configured official contract.');
                    const balance = await createPublicClient({
                      chain: baseSepolia,
                      transport: http('https://sepolia.base.org', { timeout: 8000, retryCount: 0 }),
                    }).readContract({
                      address: official as Address,
                      abi: rewardsAbi,
                      functionName: 'balanceOf',
                      args: [me.wallet.address as Address, BigInt(tokenId)],
                    });
                    setBalances((old) => ({ ...old, [badge.badge]: balance.toString() }));
                  })
                }
              >
                CHECK WALLET OWNERSHIP
              </button>
            )}
            {balances[badge.badge] !== undefined && (
              <p>
                Current wallet balance: {balances[badge.badge]}. Tokens can be transferred; a claim
                receipt alone does not prove current ownership.
              </p>
            )}
          </div>
        );
      })}
      {jobs.map((job) => (
        <div key={job.id}>
          {job.tx && /^0x[0-9a-fA-F]{64}$/.test(job.tx) && (
            <a href={'https://sepolia.basescan.org/tx/' + job.tx} target="_blank" rel="noreferrer">
              {job.kind === 'profile' ? 'Profile' : job.badge} transaction ↗
            </a>
          )}
          {job.kind === 'profile' && job.error && <p role="alert">{job.error}</p>}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
