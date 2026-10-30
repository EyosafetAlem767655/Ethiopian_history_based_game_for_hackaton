import React, { useState } from 'react';
import { api } from './store';
import { parseResult, proofSchema, type ResultPayload } from '../../../packages/shared/src/results';
import { verifyProof, type ProofVerification } from './services/proofs';

interface HistoryRecord {
  id: string;
  payload: string;
  hash: string;
  created: string;
  status: string;
  tx: string | null;
}
const chainMessages: Record<ProofVerification['chain'], string> = {
  'not-checked': 'Blockchain check skipped because the result could not be validated.',
  simulated: 'Simulated result. There is no on-chain proof.',
  unconfigured: 'Blockchain check unavailable: no contract is configured.',
  untrusted:
    'The proof points to a different contract than the official game deployment. Verification failed.',
  'not-found': 'No on-chain record found yet. You can check again later.',
  match: 'The result hash and winners match the on-chain record.',
  mismatch: 'The on-chain record differs from this result. Verification failed.',
  unavailable: 'Could not read Base Sepolia. The blockchain check is incomplete; try again.',
};

export function MatchRecord({ record }: { record: HistoryRecord }) {
  const [checking, setChecking] = useState(false),
    [retrying, setRetrying] = useState(false),
    [queued, setQueued] = useState(false),
    [verification, setVerification] = useState<ProofVerification | null>(null),
    [contract, setContract] = useState(''),
    [error, setError] = useState('');
  let payload: ResultPayload | undefined;
  try {
    payload = parseResult(record.payload);
  } catch {
    /* Keep damaged history inspectable. */
  }
  const winners = payload?.participants.filter((p) => p.team === payload!.winner) ?? [];
  const winnerLabel =
    payload?.winner === -1
      ? 'Draw'
      : winners
          .map(
            (p) =>
              `${p.name ?? p.id}${p.bot ? (p.identity && p.identity.kind !== 'bot' ? ' (AI substitute)' : ' (AI)') : ''}`,
          )
          .join(', ') || 'No winner recorded';
  return (
    <details>
      <summary>
        <span>
          {payload?.mode.toUpperCase() ?? 'RECORDED MATCH'}{' '}
          <small>{new Date(record.created).toLocaleString()}</small>
        </span>
        <span className="status">{record.status.toUpperCase()}</span>
      </summary>
      <dl className="result-facts">
        <dt>Match ID</dt>
        <dd>{record.id}</dd>
        <dt>Winner</dt>
        <dd>{winnerLabel}</dd>
        <dt>Score</dt>
        <dd>{payload?.scoreline.join(' : ') ?? 'Unreadable'}</dd>
        <dt>Finished</dt>
        <dd>{payload ? new Date(payload.endedAt).toLocaleString() : 'Unreadable'}</dd>
      </dl>
      {record.tx && /^0x[0-9a-fA-F]{64}$/.test(record.tx) && (
        <a
          className="explorer-link"
          href={'https://sepolia.basescan.org/tx/' + record.tx}
          target="_blank"
          rel="noreferrer"
        >
          View transaction ↗
        </a>
      )}
      <p className="hash">
        KECCAK-256
        <br />
        {record.hash}
      </p>
      {record.status === 'failed' && !payload?.demo && (
        <button
          className="outline-btn"
          disabled={retrying || queued}
          onClick={async () => {
            setRetrying(true);
            setError('');
            try {
              await api('/results/' + encodeURIComponent(record.id) + '/retry', {});
              setQueued(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setRetrying(false);
            }
          }}
        >
          {queued ? 'SUBMISSION QUEUED · CHECK AGAIN LATER' : 'RETRY TESTNET SUBMISSION'}
        </button>
      )}
      <div className="result-identities">
        <h3>Players at match finish</h3>
        {payload?.participants.map((p) => (
          <p key={p.id}>
            <strong>{p.name ?? p.id}</strong>
            {' · '}
            {p.identity?.kind === 'bot' || (!p.identity && p.bot)
              ? 'AI player'
              : p.identity?.kind === 'wallet'
                ? p.identity.accountId
                : p.identity
                  ? 'Game profile · wallet not linked at finish'
                  : 'Wallet identity not recorded in this older result'}
            {p.bot && p.identity && p.identity.kind !== 'bot' && ' · AI substitute'}
          </p>
        ))}
      </div>
      <button
        className="outline-btn"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          setError('');
          setVerification(null);
          setContract('');
          try {
            const response = await api('/results/' + encodeURIComponent(record.id) + '/proof');
            const envelope = proofSchema.safeParse(response);
            if (!envelope.success)
              throw Error('The server returned invalid proof data. Please retry.');
            const proof = envelope.data;
            if (proof.matchId !== record.id)
              throw Error('The server returned a different match. Please retry.');
            if (
              proof.payload !== record.payload ||
              proof.hash.toLowerCase() !== record.hash.toLowerCase()
            )
              throw Error(
                'This result changed since history loaded. Refresh your profile before verifying.',
              );
            const checked = await verifyProof(proof);
            setContract(proof.chain?.contract ?? '');
            setVerification(checked);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Unable to check this result. Please retry.');
          } finally {
            setChecking(false);
          }
        }}
      >
        {checking ? 'CHECKING RESULT…' : verification ? 'VERIFY AGAIN' : 'VERIFY RESULT'}
      </button>
      <div className="result-verification" aria-live="polite">
        {verification && (
          <>
            <p>
              <strong>
                {verification.local.status === 'match'
                  ? 'Saved result fingerprint matches.'
                  : verification.local.status === 'mismatch'
                    ? 'Saved result fingerprint does not match.'
                    : 'Result data is invalid or uses an unsupported format.'}
              </strong>
            </p>
            <p>{chainMessages[verification.chain]}</p>
            {verification.local.computedHash && (
              <p className="hash">
                Recomputed hash
                <br />
                {verification.local.computedHash}
              </p>
            )}
            {contract && (
              <p>
                Base Sepolia contract:{' '}
                <a
                  href={'https://sepolia.basescan.org/address/' + contract}
                  target="_blank"
                  rel="noreferrer"
                >
                  {contract} ↗
                </a>
              </p>
            )}
            {verification.recordedAt && (
              <p>Recorded on-chain: {new Date(verification.recordedAt).toLocaleString()}</p>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <p className="subtle">
        A matching fingerprint detects changes against the saved hash. An on-chain match adds a
        public record. The game server is still responsible for judging gameplay fairly.
      </p>
      <div className="timeline">
        {Array.isArray(payload?.events) &&
          payload.events
            .filter(
              (e: any) =>
                e && Number.isFinite(e.tick) && ['defeat', 'artifact', 'pillar'].includes(e.kind),
            )
            .map((e: any, i: number) => (
              <div key={i}>
                <b>{(e.tick / 30).toFixed(1)}s</b> {e.kind}{' '}
                {typeof e.text === 'string' ? e.text : ''}
              </div>
            ))}
      </div>
    </details>
  );
}
