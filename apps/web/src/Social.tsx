import React, { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Room } from 'colyseus.js';
import type { World } from '../../../packages/shared/src/game';
import { api, connection, useUI } from './store';
import './social.css';

interface Notice {
  id: string;
  kind: string;
  text: string;
  data: Record<string, any>;
  at: number;
  seen: boolean;
}
const socketBase = () => connection().ws.replace(/^ws/, 'http');
const ICONS: Record<string, string> = {
  'friend-request': '☺',
  'friend-accepted': '☺',
  'friend-online': '●',
  'squad-invite': '☏',
  tournament: '♛',
  result: '⚔',
  badge: '◈',
  armor: '♜',
};

/** Header bell with the notification feed, plus live toasts (suppressed during a match). */
export function NotificationCenter({
  inBattle,
  onOpen,
}: {
  inBattle: boolean;
  onOpen: (notice: Notice) => void;
}) {
  const session = useUI((s) => s.session);
  const [feed, setFeed] = useState<Notice[]>([]),
    [toasts, setToasts] = useState<Notice[]>([]),
    [open, setOpen] = useState(false);
  const battle = useRef(inBattle);
  battle.current = inBattle;
  useEffect(() => {
    if (!session) return;
    let socket: Socket | undefined;
    void api('/notifications')
      .then(setFeed)
      .catch(() => {});
    socket = io(socketBase() + '/notify', { auth: { token: session.token } });
    socket.on('notify', (n: Notice) => {
      if (!n.seen) setFeed((v) => [n, ...v.filter((o) => o.id !== n.id)].slice(0, 30));
      if (battle.current) return;
      setToasts((v) => [...v.slice(-2), n]);
      setTimeout(() => setToasts((v) => v.filter((t) => t.id !== n.id)), 6000);
    });
    return () => {
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [session?.token]);
  if (!session) return null;
  const unread = feed.filter((n) => !n.seen).length;
  return (
    <>
      {!inBattle && (
        <div className="notify-bell">
          <button
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
            aria-expanded={open}
            onClick={() => {
              setOpen((v) => !v);
              if (unread) {
                void api('/notifications/read', {}).catch(() => {});
                setFeed((v) => v.map((n) => ({ ...n, seen: true })));
              }
            }}
          >
            🔔{unread > 0 && <span>{unread}</span>}
          </button>
          {open && (
            <div className="notify-panel" role="dialog" aria-label="Notifications">
              <strong>Activity</strong>
              {!feed.length && <p className="notify-empty">No activity yet.</p>}
              {feed.map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    onOpen(n);
                  }}
                >
                  <i aria-hidden>{ICONS[n.kind] ?? '◆'}</i>
                  <span>
                    {n.text}
                    <small>
                      {new Date(n.at).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((n) => (
          <button
            key={n.id}
            className={'toast toast-' + n.kind}
            onClick={() => {
              setToasts((v) => v.filter((t) => t.id !== n.id));
              onOpen(n);
            }}
          >
            <i aria-hidden>{ICONS[n.kind] ?? '◆'}</i>
            {n.text}
          </button>
        ))}
      </div>
    </>
  );
}

export function FriendsPage({ onJoinTeam }: { onJoinTeam: (code: string) => void }) {
  const [data, setData] = useState<{ code: string; friends: any[] } | null>(null),
    [code, setCode] = useState(''),
    [message, setMessage] = useState('');
  async function run(fn: () => Promise<any>, ok?: string) {
    setMessage('');
    try {
      const out = await fn();
      if (out?.friends) setData((d) => ({ code: d?.code ?? '', ...out }));
      if (ok) setMessage(ok);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    void run(async () => setData(await api('/friends')));
    const timer = setInterval(
      () =>
        void api('/friends')
          .then(setData)
          .catch(() => {}),
      10000,
    );
    return () => clearInterval(timer);
  }, []);
  const list = (status: string) => data?.friends.filter((f) => f.status === status) ?? [];
  return (
    <section className="personal-panel social-page">
      <span className="eyebrow">FELLOW WARRIORS</span>
      <h2>Friends</h2>
      <p>
        Your friend code: <b className="friend-code">{data?.code ?? '…'}</b>. Share it so others can
        add you.
      </p>
      <form
        className="panel-actions"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => api('/friends/request', { code: code.trim() }), 'Friend request sent.');
          setCode('');
        }}
      >
        <input
          aria-label="Friend code"
          placeholder="Friend code, e.g. 3F9A12BC"
          value={code}
          maxLength={8}
          onChange={(e) => setCode(e.target.value)}
        />
        <button className="gold-btn" disabled={code.trim().length !== 8}>
          Add friend
        </button>
      </form>
      {list('incoming').length > 0 && <h3>Requests</h3>}
      {list('incoming').map((f) => (
        <div className="friend-row" key={f.id}>
          <span>{f.name}</span>
          <button
            onClick={() => void run(() => api(`/friends/${f.id}/accept`, {}), 'Friend added.')}
          >
            Accept
          </button>
          <button onClick={() => void run(() => api(`/friends/${f.id}`, undefined, 'DELETE'))}>
            Decline
          </button>
        </div>
      ))}
      <h3>Friends</h3>
      {!list('accepted').length && <p>No friends yet. Add someone with their friend code.</p>}
      {list('accepted').map((f) => (
        <div className="friend-row" key={f.id}>
          <span>
            <i className={'presence' + (f.online ? ' on' : '')} aria-hidden />
            {f.name} <small>{f.online ? 'online' : 'offline'}</small>
          </span>
          <button
            onClick={() =>
              void run(() => api(`/friends/${f.id}/invite`, {}), `Invitation sent to ${f.name}.`)
            }
          >
            Invite to my team
          </button>
          <button onClick={() => void run(() => api(`/friends/${f.id}`, undefined, 'DELETE'))}>
            Remove
          </button>
        </div>
      ))}
      {list('outgoing').length > 0 && <h3>Sent</h3>}
      {list('outgoing').map((f) => (
        <div className="friend-row" key={f.id}>
          <span>
            {f.name} <small>pending</small>
          </span>
        </div>
      ))}
      <p className="subtle">
        Invites arrive as notifications. Open one to join that friend’s team room.{' '}
        <button className="link-btn" onClick={() => onJoinTeam('')}>
          Open my team room
        </button>
      </p>
      <p role="status">{message}</p>
    </section>
  );
}

const ROUND: Record<string, string> = {
  semi1: 'Semifinal 1',
  semi2: 'Semifinal 2',
  final: 'Final',
};
export function TournamentPage({
  initialId,
  onPlay,
}: {
  initialId?: string;
  onPlay: (tournamentId: string, matchKey: string) => void;
}) {
  const me = useUI((s) => s.session?.profile.id);
  const [t, setT] = useState<any>(null),
    [code, setCode] = useState(''),
    [message, setMessage] = useState('');
  const id = initialId ?? t?.id ?? safeGet('kibre-tournament');
  async function run(fn: () => Promise<any>) {
    setMessage('');
    try {
      const out = await fn();
      setT(out);
      safeSet('kibre-tournament', out.id);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  useEffect(() => {
    if (!id) return;
    const load = () =>
      api('/tournament/' + id)
        .then(setT)
        .catch(() => {});
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [id]);
  const name = (entrant?: string) => t?.entrants.find((e: any) => e.id === entrant)?.name ?? 'TBD';
  const mine = t?.bracket.find((m: any) => !m.winner && m.a && m.b && [m.a, m.b].includes(me));
  return (
    <section className="personal-panel social-page">
      <span className="eyebrow">FOUR WARRIORS · ONE CROWN</span>
      <h2>Tournament</h2>
      <p>
        A four-warrior knockout of 1v1 duels. Empty seats are filled by AI champions. Each match win
        earns 50 activity points; the champion earns 150 more and the <b>Tournament Champion</b>{' '}
        badge.
      </p>
      <div className="panel-actions">
        <button className="gold-btn" onClick={() => void run(() => api('/tournament', {}))}>
          Create tournament
        </button>
        <input
          aria-label="Tournament code"
          placeholder="Join code"
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          disabled={code.trim().length < 6}
          onClick={() => void run(() => api('/tournament/join', { code }))}
        >
          Join
        </button>
      </div>
      {t && (
        <>
          <p>
            Code <b className="friend-code">{t.code}</b> · {t.entrants.length}/4 warriors ·{' '}
            <b>
              {t.status === 'open'
                ? 'Waiting to start'
                : t.status === 'running'
                  ? 'In progress'
                  : 'Finished'}
            </b>
          </p>
          {t.status === 'open' && (
            <>
              <p>{t.entrants.map((e: any) => e.name).join(' · ')}</p>
              {t.owner === me ? (
                <button
                  className="gold-btn"
                  onClick={() => void run(() => api(`/tournament/${t.id}/start`, {}))}
                >
                  Start (AI fills empty seats)
                </button>
              ) : (
                <p>Waiting for the organizer to start…</p>
              )}
            </>
          )}
          {t.status !== 'open' && (
            <div className="bracket">
              {t.bracket.map((m: any) => (
                <div key={m.key} className={'bracket-match' + (m.key === 'final' ? ' final' : '')}>
                  <small>{ROUND[m.key]}</small>
                  {[m.a, m.b].map((e: string | undefined, i: number) => (
                    <span
                      key={i}
                      className={
                        m.winner ? (m.winner === e ? 'won' : 'lost') : e === me ? 'me' : ''
                      }
                    >
                      {name(e)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
          {t.status === 'done' && <p className="champion">♛ Champion: {name(t.winner)}</p>}
          {mine && (
            <button className="gold-btn" onClick={() => onPlay(t.id, mine.key)}>
              Play my {ROUND[mine.key].toLowerCase()} →
            </button>
          )}
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}

export function LiveMatches({ onWatch }: { onWatch: (id: string, label: string) => void }) {
  const [matches, setMatches] = useState<any[] | null>(null);
  useEffect(() => {
    const load = () =>
      api('/live')
        .then(setMatches)
        .catch(() => setMatches([]));
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="live-matches">
      <span className="eyebrow">SPECTATOR MODE</span>
      <h3>Live matches</h3>
      {matches === null && <p>Looking for battles…</p>}
      {matches?.length === 0 && <p>No live matches right now. Start one and it appears here.</p>}
      {matches?.map((m) => (
        <div className="live-row" key={m.id}>
          <span className="live-dot" aria-hidden />
          <span>
            <b>{m.label}</b>
            <small>
              {m.players
                .filter((p: any) => !p.bot)
                .map((p: any) => p.name)
                .join(' · ')}{' '}
              · {m.players.filter((p: any) => p.bot).length} AI · 👁 {m.spectators}
            </small>
          </span>
          <button className="outline-btn" onClick={() => onWatch(m.id, m.label)}>
            WATCH
          </button>
        </div>
      ))}
    </section>
  );
}

/** Read-only view of a live match: snapshots arrive over Socket.IO, no fighter seat is used. */
export function SpectatorView({
  roomId,
  label,
  onLeave,
}: {
  roomId: string;
  label: string;
  onLeave: () => void;
}) {
  const session = useUI((s) => s.session)!,
    snapshot = useUI((s) => s.snapshot);
  const [ended, setEnded] = useState(''),
    [follow, setFollow] = useState('');
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    useUI.setState({ snapshot: null });
    const socket = io(socketBase() + '/spectate', { auth: { token: session.token, roomId } });
    socket.on('snapshot', (w: World) => useUI.setState({ snapshot: w }));
    socket.on('ended', () => setEnded('This match has ended.'));
    socket.on('connect_error', (e) => setEnded(e.message));
    let game: import('phaser').Game | undefined,
      cancelled = false;
    // The arena only reads snapshots; spectators never send input.
    const viewer = { send() {} } as unknown as Room;
    void import('./iso').then(({ mountGame }) => {
      if (!cancelled && el.current) game = mountGame(el.current, viewer, 'spectator');
    });
    return () => {
      cancelled = true;
      socket.disconnect();
      game?.destroy(true);
      useUI.setState({ snapshot: null });
    };
  }, [roomId]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('spectate-follow', { detail: follow }));
  }, [follow]);
  const fighters = snapshot?.players.filter((p) => !p.kind || p.kind === 'warrior') ?? [];
  return (
    <div className="spectator">
      <div className="spectator-bar">
        <span className="live-dot" aria-hidden /> SPECTATING · <b>{label}</b>
        {snapshot?.finished && <em> · Match finished</em>}
        <span className="spectator-follow">
          {fighters.map((p) => (
            <button
              key={p.id}
              className={follow === p.id ? 'active' : ''}
              onClick={() => setFollow(p.id)}
            >
              {p.name}
            </button>
          ))}
        </span>
        <button className="outline-btn" onClick={onLeave}>
          LEAVE
        </button>
      </div>
      {ended && <p className="spectator-ended">{ended}</p>}
      <div ref={el} className="spectator-arena" />
    </div>
  );
}

function safeGet(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private mode: the tournament simply is not remembered. */
  }
}
