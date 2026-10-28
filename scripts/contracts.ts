import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import solc from 'solc';
const require = createRequire(import.meta.url);
export function compile() {
  const name = 'RoyalRecords.sol',
    source = readFileSync('packages/contracts/contracts/' + name, 'utf8');
  const output = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: 'Solidity',
        sources: { [name]: { content: source } },
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'shanghai',
          outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } },
        },
      }),
      {
        import: (path: string) => {
          try {
            return { contents: readFileSync(require.resolve(path), 'utf8') };
          } catch {
            return { error: 'Missing import ' + path };
          }
        },
      },
    ),
  );
  const errors = output.errors?.filter((e: any) => e.severity === 'error');
  if (errors?.length) throw Error(errors.map((e: any) => e.formattedMessage).join('\n'));
  return output.contracts[name].RoyalRecords;
}
if (process.argv[1]?.endsWith('contracts.ts')) {
  const contract = compile();
  mkdirSync('packages/contracts/artifacts', { recursive: true });
  writeFileSync(
    'packages/contracts/artifacts/RoyalRecords.json',
    JSON.stringify(contract, null, 2),
  );
  console.log('RoyalRecords compiled successfully');
}
