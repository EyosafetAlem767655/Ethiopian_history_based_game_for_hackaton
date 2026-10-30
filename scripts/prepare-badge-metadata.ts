import { readFileSync, writeFileSync } from 'node:fs';
import { badgeTypes } from '../packages/shared/src/web3';

const origin = new URL(process.argv.find((arg) => arg.startsWith('--origin='))?.slice(9) ?? '');
if (
  origin.protocol !== 'https:' ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw Error('Pass --origin=https://YOUR-ACTUAL-GAME-DOMAIN with no path or credentials');
const entries = badgeTypes.map((name, index) => {
  const file =
    'apps/web/public/achievements/' + (index + 1).toString(16).padStart(64, '0') + '.json';
  const metadata = JSON.parse(readFileSync(file, 'utf8'));
  if (metadata.name !== name) throw Error('Badge metadata catalog does not match: ' + file);
  return { file, metadata: { ...metadata, image: new URL('/assets/portraits.png', origin).href } };
});
for (const { file, metadata } of entries)
  writeFileSync(file, JSON.stringify(metadata, null, 2) + '\n');
console.log('Prepared', entries.length, 'badge metadata files for', origin.origin);
