import React, { useEffect, useRef, useState } from 'react';
import { api, connection, useUI, wakeServer } from './store';
import { requestJSON } from './services/http';
import { hostedAuth } from './hostedAuth';
import { ageBand, birthISO } from '../../../packages/shared/src/customization';
/** Eligibility suggested by the date read from the ID, before any reviewer is involved. */
function eligibilityFor(birth: Birth) {
  try {
    const band = ageBand(birthISO(birth) ?? '');
    return band
      ? `Based on this date you are 18+ (age band ${band}) and eligible once a reviewer confirms it.`
      : 'Based on this date you are under 18: adult matchmaking and perks are not available.';
  } catch {
    return '';
  }
}
type Birth = { year: number; month: number; day: number; calendar: 'gregorian' | 'ethiopian' };
function DateFields({ value, onChange }: { value: Birth; onChange: (v: Birth) => void }) {
  return (
    <div className="birth-fields">
      <label>
        Calendar
        <select
          value={value.calendar}
          onChange={(e) => onChange({ ...value, calendar: e.target.value as Birth['calendar'] })}
        >
          <option value="gregorian">Gregorian</option>
          <option value="ethiopian">Ethiopian</option>
        </select>
      </label>
      {(['year', 'month', 'day'] as const).map((k) => (
        <label key={k}>
          {k}
          <input
            type="number"
            aria-label={'Birth ' + k}
            value={value[k]}
            onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })}
          />
        </label>
      ))}
    </div>
  );
}
export function AgePanel({ onSignIn }: { onSignIn?: () => void } = {}) {
  const canSubmit = useUI((s) => s.me?.identity === 'supabase' && !s.session?.profile.demo);
  const [status, setStatus] = useState<any>(null),
    [birth, setBirth] = useState<Birth>({ year: 2000, month: 1, day: 1, calendar: 'gregorian' }),
    [consent, setConsent] = useState(false),
    [file, setFile] = useState<Blob | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const worker = useRef<any>(null),
    alive = useRef(true),
    video = useRef<HTMLVideoElement>(null),
    live = useRef<MediaStream | null>(null);
  const refresh = async () => setStatus(await api('/age-review'));
  function stopCamera() {
    live.current?.getTracks().forEach((t) => t.stop());
    live.current = null;
    setStream(null);
  }
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
    return () => {
      alive.current = false;
      live.current?.getTracks().forEach((t) => t.stop());
      void worker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play();
    }
  }, [stream]);
  async function startCamera() {
    setMessage('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        // Prefer the rear camera on phones; ID text needs resolution.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      if (!alive.current) return s.getTracks().forEach((t) => t.stop());
      live.current = s;
      setStream(s);
    } catch {
      setMessage('Camera unavailable. Choose a photo of your ID instead.');
    }
  }
  async function captureId() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    stopCamera();
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    if (blob) await select(new File([blob], 'fayda-scan.jpg', { type: 'image/jpeg' }));
  }
  async function select(f: File | undefined) {
    if (!f) return;
    setMessage('');
    setFile(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type) || f.size > 5242880) {
      setMessage('Use JPEG, PNG or WebP, at most 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(f),
        scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bitmap.width * scale);
      c.height = Math.round(bitmap.height * scale);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      const clean = await new Promise<Blob>((resolve, reject) =>
        c.toBlob(
          (b) => (b ? resolve(b) : reject(Error('Image could not be read'))),
          'image/jpeg',
          0.9,
        ),
      );
      if (!alive.current) return;
      setFile(clean);
      setMessage('Reading date of birth locally…');
      const { createWorker } = await import('tesseract.js');
      const w = await createWorker('eng', 1, {
        workerPath: '/vision/ocr/worker.min.js',
        corePath: '/vision/ocr/core',
        langPath: '/vision/ocr',
        workerBlobURL: false,
      });
      worker.current = w;
      try {
        const { data } = await w.recognize(clean);
        const match = data.text.match(
          /(?:birth|d\.?o\.?b\.?)[^\n\d]*(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/i,
        );
        if (alive.current) {
          if (match && data.confidence >= 60) {
            const a = Number(match[1]),
              b = Number(match[2]),
              d = Number(match[3]);
            setBirth((v) => ({ ...v, year: a > 31 ? a : d, month: b, day: a > 31 ? d : a }));
            setMessage(
              'Suggested date filled. Confirm the complete date and calendar against your Fayda.',
            );
          } else
            setMessage(
              'The birth date was not clear enough. Enter the complete date and calendar manually.',
            );
        }
      } finally {
        await w.terminate();
        worker.current = null;
      }
    } catch {
      if (alive.current)
        setMessage(
          'OCR unavailable. The selected image can still be submitted with a manually entered date.',
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function submit() {
    if (!file || !consent) return;
    setBusy(true);
    try {
      const out = await api('/age-review', { document: 'fayda', consent: true, birth });
      await requestJSON(
        connection().api + '/api/age-review/' + out.id + '/evidence',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + useUI.getState().session?.token,
            'Content-Type': file.type,
            'X-Document-Consent': 'true',
          },
          body: file,
        },
        30000,
      );
      setFile(null);
      setConsent(false);
      await refresh();
      setMessage(
        'Submitted for manual review. Your document will expire after 24 hours if unreviewed.',
      );
    } catch (e) {
      setMessage((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function withdraw() {
    setBusy(true);
    try {
      await api('/age-review', undefined, 'DELETE');
      await refresh();
      setMessage('Submission withdrawn; evidence deletion requested.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="personal-panel">
      <span className="eyebrow">OPTIONAL · ADULT MATCHMAKING</span>
      <h2>Verify your identity</h2>
      <p>
        Guests already play other guests. Scanning your Fayda national ID lets a reviewer confirm
        your age so you can join adult matchmaking in your age band.
      </p>
      <p>
        {status?.label ?? 'Loading review status…'}{' '}
        {status?.band && (
          <>
            Age band: <strong>{status.band}</strong>.
          </>
        )}
      </p>
      <p>
        Fayda only. A designated reviewer checks your document manually. This does not authenticate
        it with the government or prove it belongs to you. Solo, bots and the demo require no ID.
      </p>
      <p>
        Status: <strong>{status?.status ?? 'loading'}</strong>
      </p>
      {status && !['approved', 'pending'].includes(status.status) && (
        <>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{' '}
            I consent to private document upload and manual review. Evidence is deleted after a
            decision or withdrawal; unreviewed requests expire after 24 hours. Only my approved
            birth date and review record are retained privately for age-band calculation.
          </label>
          <div className="panel-actions">
            <button disabled={!consent || busy || !!stream} onClick={() => void startCamera()}>
              Scan ID with camera
            </button>
            {stream && (
              <>
                <button className="gold-btn" onClick={() => void captureId()}>
                  Capture ID
                </button>
                <button onClick={stopCamera}>Cancel</button>
              </>
            )}
          </div>
          {stream && (
            <video
              ref={video}
              muted
              playsInline
              className="selfie-preview"
              aria-label="Camera preview: hold your Fayda card flat and fill the frame"
            />
          )}
          <label>
            Or choose a Fayda image (JPEG, PNG or WebP, maximum 5 MB)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!consent || busy}
              onChange={(e) => void select(e.target.files?.[0])}
            />
          </label>
          {file && <p>ID image ready. Check the date below, then submit.</p>}
          <DateFields value={birth} onChange={setBirth} />
          {file && <p className="eligibility-hint">{eligibilityFor(birth)}</p>}
          {!canSubmit ? (
            <p>
              To submit, sign in with your email account (Story Demo and local guest profiles cannot
              be reviewed). <button onClick={onSignIn}>Sign in to submit</button>
            </p>
          ) : !status.enabled ? (
            <p>
              Document review setup is pending on the server, so your ID cannot be sent yet. Your
              scan stays on this device.
            </p>
          ) : (
            <button disabled={!file || !consent || busy} onClick={() => void submit()}>
              Submit for manual review
            </button>
          )}
        </>
      )}
      {status && ['approved', 'pending'].includes(status.status) && (
        <button disabled={busy} onClick={() => void withdraw()}>
          Withdraw review and remove birth date
        </button>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
async function reviewerRequest(path = '', body?: unknown) {
  await wakeServer();
  const auth = await hostedAuth?.auth.getSession();
  return requestJSON(connection().api + '/api/admin/age-reviews' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer ' + useUI.getState().session?.token,
      'X-Review-Token': auth?.data.session?.access_token ?? '',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
export function ReviewPanel() {
  const [rows, setRows] = useState<any[]>([]),
    [message, setMessage] = useState(''),
    [factor, setFactor] = useState(''),
    [qr, setQR] = useState(''),
    [code, setCode] = useState(''),
    [dates, setDates] = useState<Record<string, Birth>>({}),
    [ack, setAck] = useState<Record<string, boolean>>({});
  async function load() {
    try {
      const rows = await reviewerRequest();
      setRows(rows);
      setDates(
        Object.fromEntries(
          rows.map((r: any) => {
            const [year, month, day] = r.birth.split('-').map(Number);
            return [r.id, { year, month, day, calendar: 'gregorian' }];
          }),
        ),
      );
      setMessage('Review access confirmed. Images expire after 60 seconds; refresh to view again.');
    } catch (e) {
      setRows([]);
      setMessage((e as Error).message);
    }
  }
  async function mfa() {
    try {
      if (!hostedAuth) throw Error('Supabase sign-in required');
      const list = await hostedAuth.auth.mfa.listFactors();
      const current = list.data?.totp.find((f) => f.status === 'verified');
      if (current) {
        setFactor(current.id);
        setMessage('Enter your authenticator code.');
        return;
      }
      const e = await hostedAuth.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Kibre Gugs reviewer',
      });
      if (e.error) throw e.error;
      setFactor(e.data.id);
      setQR(e.data.totp.qr_code);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function verify() {
    try {
      const out = await hostedAuth!.auth.mfa.challengeAndVerify({ factorId: factor, code });
      if (out.error) throw out.error;
      setQR('');
      setCode('');
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  async function decide(id: string, decision: string) {
    try {
      await reviewerRequest('/' + id, {
        decision,
        acknowledged: true,
        ...(decision === 'approved' ? { birth: dates[id] } : {}),
      });
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="personal-panel">
      <h2>Document reviewer</h2>
      <p>
        Restricted to server-designated reviewers with MFA. Verify the visible full date and
        calendar. Approval is a manual age check.
      </p>
      <button onClick={() => void mfa()}>Set up / unlock reviewer MFA</button>
      {qr && (
        <img
          src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qr)}
          alt="Scan with your authenticator"
          width="190"
        />
      )}
      {factor && (
        <>
          <input
            aria-label="Authenticator code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
          />
          <button onClick={() => void verify()}>Verify MFA</button>
        </>
      )}
      <button onClick={() => void load()}>Refresh review queue</button>
      <p role="status">{message}</p>
      {rows.map((row) => (
        <article key={row.id} className="review-item">
          {row.photoUrl ? (
            <img
              src={row.photoUrl}
              alt="Private Fayda evidence for manual review"
              referrerPolicy="no-referrer"
            />
          ) : (
            <p>Evidence unavailable; request resubmission.</p>
          )}
          {dates[row.id] && (
            <DateFields
              value={dates[row.id]}
              onChange={(v) => setDates({ ...dates, [row.id]: v })}
            />
          )}
          <label>
            <input
              type="checkbox"
              checked={!!ack[row.id]}
              onChange={(e) => setAck({ ...ack, [row.id]: e.target.checked })}
            />{' '}
            I inspected the document and confirmed the date/calendar above.
          </label>
          <div className="panel-actions">
            {['approved', 'rejected', 'resubmit'].map((d) => (
              <button key={d} disabled={!ack[row.id]} onClick={() => void decide(row.id, d)}>
                {d}
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
