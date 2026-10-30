import { keccak256, stringToHex, type Address, type Hex } from 'viem';
import { resultChainId } from './results';

// IDs match the existing 64-character ERC-1155 metadata filenames.
export const badgeTypes = [
  'First Blood',
  'Sword Master',
  'Spear Master',
  'Eagle Eye',
  'Royal Rider',
  'Ten Victories',
  'Four Banners Champion',
  'Proof of Fellowship',
  'Guardian Slayer',
  'Thronebreaker',
  'Crown Champion',
] as const;
export const badgeTokenId = (badge: string) => {
  const index = badgeTypes.findIndex((name) => name === badge);
  return index < 0 ? null : index + 1;
};
export const profileKey = (playerId: string) =>
  keccak256(stringToHex('kibre-gugs:profile:v1:' + playerId));
export const registrationTypes = {
  RegisterProfile: [
    { name: 'owner', type: 'address' },
    { name: 'profileId', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;
export function registrationData(
  contract: Address,
  owner: Address,
  profileId: Hex,
  deadline: number,
  nonce: Hex,
) {
  return {
    domain: {
      name: 'KibreGugsProfiles',
      version: '1',
      chainId: resultChainId,
      verifyingContract: contract,
    },
    types: registrationTypes,
    primaryType: 'RegisterProfile' as const,
    message: { owner, profileId, deadline: BigInt(deadline), nonce },
  };
}
export const rewardsAbi = [
  {
    type: 'function',
    name: 'profiles',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'registerProfile',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'profileId', type: 'bytes32' },
      { name: 'deadline', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'awarded',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'award',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;
