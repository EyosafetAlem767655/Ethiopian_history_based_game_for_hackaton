import React, { useEffect, useRef, useState } from 'react';
import {
  defaultAvatar,
  avatarSchema,
  type AvatarSpec,
} from '../../../packages/shared/src/customization';
import { avatarCanvas, heroHeadCanvas } from './avatar';
import { api, useUI } from './store';
export function AvatarEditor() {
  const me = useUI((s) => s.me),
    hero = useUI((s) => s.hero),
    [spec, setSpec] = useState<AvatarSpec>(me?.avatar ?? defaultAvatar),
    [message, setMessage] = useState(''),
    [stream, setStream] = useState<MediaStream | null>(null),
    [photo, setPhoto] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const preview = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    live = useRef<MediaStream | null>(null),
    worker = useRef<Worker | null>(null),
    alive = useRef(true);
  const changed = useRef(false);
  useEffect(() => {
    if (me?.avatar && !changed.current) setSpec(me.avatar);
  }, [me?.avatar]);
  function stop() {
    live.current?.getTracks().forEach((t) => t.stop());
    live.current = null;
    setStream(null);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      live.current?.getTracks().forEach((t) => t.stop());
      worker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    if (spec.face === 'custom') {
      preview.current?.replaceChildren(avatarCanvas(spec));
      return;
    }
    let current = true;
    heroHeadCanvas(hero)
      .then((c) => current && preview.current?.replaceChildren(c))
      .catch(() => current && preview.current?.replaceChildren(avatarCanvas(spec)));
    return () => {
      current = false;
    };
  }, [spec, hero]);
  useEffect(() => {
    if (video.current && stream) {
      video.current.srcObject = stream;
      void video.current.play();
    }
  }, [stream]);
  async function camera() {
    stop();
    setBusy(true);
    try {
      setPhoto(null);
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      });
      if (!alive.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      live.current = s;
      setStream(s);
    } catch {
      if (alive.current)
        setMessage('Camera unavailable. The manual editor works without camera access.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function capture() {
    changed.current = true;
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    setPhoto(c.toDataURL('image/jpeg', 0.7));
    stop();
    setBusy(true);
    setMessage('Suggesting face proportions on this device…');
    try {
      const image = await createImageBitmap(c);
      worker.current?.terminate();
      const w = new Worker(new URL('./face.worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      const finish = (m: string) => {
        setBusy(false);
        setMessage(m);
        w.terminate();
        worker.current = null;
      };
      const timer = setTimeout(() => {
        if (alive.current) finish('Suggestions timed out. Please use the manual editor.');
      }, 45000);
      w.onmessage = (e) => {
        clearTimeout(timer);
        if (!alive.current) return;
        if (e.data.shape) setSpec((s) => ({ ...s, shape: e.data.shape, face: 'custom' }));
        finish(e.data.error ?? 'Suggested face shape applied. Adjust the features to your liking.');
      };
      w.onerror = () => {
        clearTimeout(timer);
        if (alive.current) finish('Suggestions unavailable. Please use the manual editor.');
      };
      w.postMessage({ image, base: location.origin }, [image]);
    } catch {
      setBusy(false);
      setMessage('Please use the manual editor.');
    }
  }
  async function save() {
    setBusy(true);
    try {
      const out = await api('/avatar', spec, 'PUT');
      useUI.setState({ me: { ...useUI.getState().me, avatar: out.avatar } });
      setPhoto(null);
      stop();
      setMessage(
        out.avatar.face === 'custom'
          ? 'Avatar saved. Your next match will use this likeness.'
          : 'Avatar saved. Your next match will use your hero helm.',
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="personal-panel">
      <span className="eyebrow">YOUR CARTOON LIKENESS</span>
      <h2>A face for your legend</h2>
      <p>
        Optional camera capture suggests face proportions locally. No selfie or face landmarks are
        uploaded. Hair, colors and features are yours to choose.
      </p>
      <div className="avatar-editor">
        <div ref={preview} className="avatar-preview" />
        <div className="feature-grid">
          <label>
            In battle
            <select
              aria-label="Avatar face"
              value={spec.face}
              onChange={(e) => {
                changed.current = true;
                setSpec({ ...spec, face: e.target.value as AvatarSpec['face'] });
              }}
            >
              <option value="hero">Hero helm</option>
              <option value="custom">My custom face</option>
            </select>
          </label>
          {(['shape', 'skin', 'eyes', 'brows', 'hair', 'beard'] as const).map((key) => (
            <label key={key}>
              {key}
              <select
                aria-label={'Avatar ' + key}
                value={spec[key]}
                onChange={(e) => {
                  changed.current = true;
                  // Choosing a feature means the player wants their own face in battle.
                  setSpec({ ...spec, [key]: e.target.value, face: 'custom' });
                }}
              >
                {(avatarSchema.shape[key] as any).options.map((v: string) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
      {stream && <video ref={video} muted playsInline className="selfie-preview" />}
      {photo && (
        <img
          src={photo}
          className="selfie-preview"
          alt="Temporary selfie preview, kept only on this device"
        />
      )}
      <div className="panel-actions">
        <button onClick={() => void camera()} disabled={busy}>
          {' '}
          {photo ? 'Retake selfie' : 'Use camera (optional)'}
        </button>
        {stream && (
          <>
            <button onClick={() => void capture()}>Capture and suggest</button>
            <button onClick={stop}>Stop camera</button>
          </>
        )}
        <button className="gold-btn" disabled={busy} onClick={() => void save()}>
          Save avatar
        </button>
      </div>
      <ArmorPicker onMessage={setMessage} />
      <p role="status">{message}</p>
    </section>
  );
}
/** Cosmetic armor sets. Royal Feast unlocks from the lunch gathering perk. */
function ArmorPicker({ onMessage }: { onMessage: (m: string) => void }) {
  const progress = useUI((s) => s.me?.profile?.progress),
    owned: string[] = progress?.armor ?? [],
    reserved: string[] = progress?.armorPending ?? [],
    equipped = progress?.equipped ?? 'standard';
  async function equip(armor: string) {
    try {
      const out = await api('/armor', { armor }, 'PUT');
      const me = useUI.getState().me;
      useUI.setState({ me: { ...me, profile: { ...me.profile, progress: out.progress } } });
      onMessage(armor === 'standard' ? 'Standard armor equipped.' : 'Royal Feast armor equipped.');
    } catch (e) {
      onMessage((e as Error).message);
    }
  }
  const sets: [string, string, string][] = [
    ['standard', 'Warrior armor', 'Your hero’s battle-worn kit.'],
    [
      'royal-feast',
      'Royal Feast armor',
      'Gilded gold and emerald. Unlocked by the lunch gathering.',
    ],
  ];
  return (
    <div className="armor-picker">
      <h3>Armor</h3>
      <div>
        {sets.map(([id, name, note]) => {
          const locked = id !== 'standard' && !owned.includes(id);
          return (
            <button
              key={id}
              className={'armor-option armor-' + id + (equipped === id ? ' equipped' : '')}
              disabled={locked}
              aria-pressed={equipped === id}
              onClick={() => void equip(id)}
            >
              <b>{name}</b>
              <small>
                {!locked
                  ? note
                  : reserved.includes(id)
                    ? '🔒 Reserved for you: verify your identity to claim'
                    : '🔒 Join the Royal Lunch Perk (verified accounts) to unlock'}
              </small>
              {equipped === id && <em>EQUIPPED</em>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
