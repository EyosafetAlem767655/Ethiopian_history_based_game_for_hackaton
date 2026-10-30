import 'dotenv/config';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { compile } from './contracts';
if (process.env.ALLOW_CHAIN_BROADCAST !== 'true' || !process.env.ATTESTOR_PRIVATE_KEY)
  throw Error('Configure ATTESTOR_PRIVATE_KEY and explicitly authorize ALLOW_CHAIN_BROADCAST=true');
const account = privateKeyToAccount(process.env.ATTESTOR_PRIVATE_KEY as `0x${string}`),
  transport = http(process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org');
const c = compile();
const metadata = process.env.BADGE_METADATA_URI;
if (
  !metadata ||
  !metadata.includes('{id}') ||
  !/^(https:\/\/|ipfs:\/\/)/.test(metadata) ||
  metadata.includes('example.invalid')
)
  throw Error(
    'Set BADGE_METADATA_URI to a real HTTPS/IPFS ERC-1155 metadata endpoint containing {id} before deploying',
  );
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
const tx = await wallet.deployContract({
  abi: c.abi,
  bytecode: ('0x' + c.evm.bytecode.object) as `0x${string}`,
  args: [account.address, metadata],
});
console.log('Deployment submitted:', tx);
const receipt = await createPublicClient({
  chain: baseSepolia,
  transport,
}).waitForTransactionReceipt({ hash: tx });
console.log('RECORDS_ADDRESS=' + receipt.contractAddress);
