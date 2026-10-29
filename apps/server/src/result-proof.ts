import { getAddress, isAddress } from 'viem';
import { db } from './store';
import { resultChainId, type ResultProof } from '../../../packages/shared/src/results';

export function resultProof(matchId: string, playerId: string): ResultProof | undefined {
  // Use the recorded participation, rather than current squad membership.
  const row = db
    .prepare(
      `
    SELECT r.id,r.payload,r.hash,r.demo,o.status,o.tx FROM results r
    JOIN participants p ON p.match_id=r.id JOIN outbox o ON o.match_id=r.id
    WHERE r.id=? AND p.player_id=?
  `,
    )
    .get(matchId, playerId) as
    | {
        id: string;
        payload: string;
        hash: ResultProof['hash'];
        demo: number;
        status: ResultProof['status'];
        tx: ResultProof['tx'];
      }
    | undefined;
  if (!row) return;
  const simulated = !!row.demo || row.status === 'simulated';
  const address = process.env.RECORDS_ADDRESS;
  return {
    matchId: row.id,
    payload: row.payload,
    hash: row.hash,
    status: simulated ? 'simulated' : row.status,
    tx: simulated ? null : row.tx,
    simulated,
    chain:
      !simulated && address && isAddress(address) && !/^0x0{40}$/i.test(address)
        ? { chainId: resultChainId, contract: getAddress(address) }
        : null,
  };
}
