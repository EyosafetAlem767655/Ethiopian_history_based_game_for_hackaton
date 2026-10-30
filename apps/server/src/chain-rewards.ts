import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { rewardsAbi } from '../../../packages/shared/src/web3';
import { recordsAbi, matchKey } from '../../../packages/shared/src/results';
import {
  RevertedWeb3Transaction,
  Web3Error,
  web3Contract,
  type Web3Adapter,
  type Web3Job,
  type ProfileRegistration,
  type BadgeClaim,
} from './web3';

export interface ChainRewardActions {
  profile(owner: Address): Promise<Hex>;
  awarded(owner: Address, tokenId: number): Promise<boolean>;
  record(matchId: string): Promise<readonly [Hex, Hex, bigint, Address]>;
  register(data: ProfileRegistration): Promise<Hex>;
  award(data: BadgeClaim): Promise<Hex>;
  receipt(hash: Hex): Promise<'success' | 'reverted'>;
}
const zeroHash = /^0x0{64}$/i;
export class ChainRewardsAdapter implements Web3Adapter {
  constructor(private actions: ChainRewardActions) {}
  async execute(job: Web3Job, saveTransaction: (hash: Hex) => Promise<void>) {
    const data: ProfileRegistration | BadgeClaim = JSON.parse(job.payload);
    // A durable transaction hash is always reconciled before any rebroadcast.
    if (job.tx) {
      if ((await this.actions.receipt(job.tx)) !== 'success')
        throw new RevertedWeb3Transaction('Transaction reverted. You can retry.');
    }
    const registered = await this.actions.profile(data.owner);
    if (job.kind === 'profile') {
      const registration = data as ProfileRegistration;
      if (!zeroHash.test(registered)) {
        if (registered !== registration.profileHash)
          throw new Web3Error('Wallet is registered to another profile');
        return;
      }
      if (job.tx)
        throw new Web3Error('Registration receipt succeeded but the profile does not match');
      if (!registration.signature || registration.deadline * 1000 <= Date.now())
        throw new Web3Error('Registration signature expired. Sign a fresh registration.');
      const tx = await this.actions.register(registration);
      await saveTransaction(tx);
      if ((await this.actions.receipt(tx)) !== 'success')
        throw new RevertedWeb3Transaction(
          'Registration transaction reverted. Sign a fresh registration.',
        );
      if ((await this.actions.profile(data.owner)) !== data.profileHash)
        throw new Web3Error('Registered profile could not be confirmed');
      return;
    }
    const badge = data as BadgeClaim;
    if (registered !== badge.profileHash)
      throw new Web3Error('Register this wallet and profile before minting');
    const [hash, winner, timestamp] = await this.actions.record(badge.matchId);
    if (!timestamp || hash !== badge.resultHash || winner !== badge.winner)
      throw new Web3Error('Achievement source does not match the official on-chain result');
    if (await this.actions.awarded(badge.owner, badge.tokenId)) return;
    if (job.tx) throw new Web3Error('Badge receipt succeeded but issuance could not be confirmed');
    const tx = await this.actions.award(badge);
    await saveTransaction(tx);
    if ((await this.actions.receipt(tx)) !== 'success')
      throw new RevertedWeb3Transaction('Badge transaction reverted. You can retry.');
    if (!(await this.actions.awarded(badge.owner, badge.tokenId)))
      throw new Web3Error('Badge issuance could not be confirmed');
  }
}
export function baseRewardsAdapter() {
  const contract = web3Contract();
  if (!contract) throw new Web3Error('Live blockchain writes are disabled');
  const account = privateKeyToAccount(process.env.ATTESTOR_PRIVATE_KEY as Hex);
  const transport = http(process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org', {
    timeout: 8000,
    retryCount: 0,
  });
  const pub = createPublicClient({ chain: baseSepolia, transport });
  const wallet = createWalletClient({ chain: baseSepolia, transport, account });
  return new ChainRewardsAdapter({
    profile: (owner) =>
      pub.readContract({
        address: contract,
        abi: rewardsAbi,
        functionName: 'profiles',
        args: [owner],
      }),
    awarded: (owner, tokenId) =>
      pub.readContract({
        address: contract,
        abi: rewardsAbi,
        functionName: 'awarded',
        args: [owner, BigInt(tokenId)],
      }),
    record: (id) =>
      pub.readContract({
        address: contract,
        abi: recordsAbi,
        functionName: 'records',
        args: [matchKey(id)],
      }),
    register: (data) =>
      wallet.writeContract({
        address: contract,
        abi: rewardsAbi,
        functionName: 'registerProfile',
        args: [data.owner, data.profileHash, BigInt(data.deadline), data.nonce, data.signature!],
      }),
    award: (data) =>
      wallet.writeContract({
        address: contract,
        abi: rewardsAbi,
        functionName: 'award',
        args: [data.owner, BigInt(data.tokenId)],
      }),
    receipt: async (hash) =>
      (
        await pub.waitForTransactionReceipt({
          hash,
          confirmations: 2,
          timeout: 30000,
          pollingInterval: 2000,
        })
      ).status,
  });
}
