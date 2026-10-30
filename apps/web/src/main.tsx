import { AvatarEditor } from './AvatarEditor';
import { AgePanel, ReviewPanel } from './AgePanel';
import './personalization.css';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Client, type Room } from 'colyseus.js';
import QRCode from 'qrcode';
import { useUI, api, saveSession, API, connection, wakeServer } from './store';
import { requestJSON } from './services/http';
import { CampaignScreen } from './CampaignScreen';
import { MatchRecord } from './MatchRecord';
import { TeamChat } from './TeamChat';
import { ScrollGuide } from './ScrollGuide';
import { audio } from './audio';
import { MISSIONS } from '../../../packages/shared/src/missions';
import { PROTOCOL_VERSION } from '../../../packages/shared/src/presentation';
import type { Mode, World } from '../../../packages/shared/src/game';
import './style.css';
import './expansion.css';
import { hostedAuth, resumeHosted, signInEmail, signOutIdentity } from './hostedAuth';
const heroes = [
  {
    name: 'The Lion Guard',
    title: 'STEEL. HONOR. RESOLVE.',
    weapon: 'Sword & shield',
    symbol: '♜',
    color: '#d6a652',
    desc: 'An unbreakable spirit behind the shield. Stand your ground. Make every strike count.',
  },
  {
    name: 'The Highland Spear',
    title: 'GRACE WITH AN EDGE.',
    weapon: 'Highland warrior',
    symbol: '♝',
    color: '#7db39b',
    desc: 'Swift as the highland wind. A fearless guardian of the kingdom’s ancient promises.',
  },
  {
    name: 'The Rift Valley Archer',
    title: 'ONE SHOT. ONE DESTINY.',
    weapon: 'Rift Valley warrior',
    symbol: '♞',
    color: '#b7b966',
    desc: 'A watchful eye and a steady hand. From the valley rises a new legend.',
  },
  {
    name: 'The Royal Rider',
    title: 'RIDE INTO LEGEND.',
    weapon: 'Royal warrior',
    symbol: '♛',
    color: '#cd8266',
    desc: 'The royal standard rides again. Courage is the only crown worth wearing.',
  },
];
function Portrait({ hero = 0, className = '' }: { hero?: number; className?: string }) {
  return (
    <div
      className={'portrait portrait-' + hero + ' ' + className}
      role="img"
      aria-label={heroes[hero].name}
    />
  );
}
function App() {
  const { session, hero, snapshot, me, error, muted, warming, resultSaved, volume, musicVolume } =
    useUI();
  const [page, setPage] = useState(
      new URLSearchParams(location.search).has('review') ? 'review' : 'home',
    ),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [room, setRoom] = useState<Room | null>(null),
    [squad, setSquad] = useState<any>(null),
    [invite, setInvite] = useState(''),
    [qr, setQr] = useState(''),
    [waiting, setWaiting] = useState(0),
    [paused, setPaused] = useState(false),
    [board, setBoard] = useState(false),
    [leaders, setLeaders] = useState<any[]>([]),
    [messages, setMessages] = useState<any[]>([]),
    [chat, setChat] = useState('');
  const gameEl = useRef<HTMLDivElement>(null);
  const progress = me?.profile?.progress ?? session?.profile.progress;
  useEffect(() => {
    audio.setTheme(
      page !== 'battle'
        ? 'menu'
        : snapshot?.bossMax
          ? 'boss'
          : snapshot?.players.some((p) => p.team === 1 && p.hp > 0)
            ? 'combat'
            : 'exploration',
    );
  }, [
    page,
    snapshot?.phase,
    !!snapshot?.bossMax,
    snapshot?.players.some((p) => p.team === 1 && p.hp > 0),
  ]);
  async function refresh() {
    if (session) {
      try {
        useUI.setState({ me: await api('/me') });
      } catch (e) {
        useUI.setState({ error: (e as Error).message });
      }
    }
  }
  useEffect(() => {
    if (!session) setSquad(null);
    else if (me?.profile?.id === session.profile.id) setSquad(me.squad ?? null);
  }, [me, session?.profile.id]);
  useEffect(() => {
    void refresh();
    const pass = new URLSearchParams(location.search).get('pass');
    if (pass && session)
      void action(async () => {
        const s = await api('/pass/' + encodeURIComponent(pass));
        setSquad(s);
        setQr(await QRCode.toDataURL(location.href, { width: 160 }));
        setPage('squad');
      });
  }, [session?.token]);
  useEffect(() => {
    if (hostedAuth && (!session || location.hash.includes('access_token')))
      void resumeHosted().catch((e) => useUI.setState({ error: e.message }));
  }, []);
  useEffect(() => {
    const p = (e: Event) => setPaused((e as CustomEvent).detail),
      b = (e: Event) => setBoard((e as CustomEvent).detail);
    window.addEventListener('pause', p);
    window.addEventListener('scoreboard', b);
    return () => {
      window.removeEventListener('pause', p);
      window.removeEventListener('scoreboard', b);
    };
  }, []);
  useEffect(() => {
    if (!room || !session || !gameEl.current || page !== 'battle') return;
    let cancelled = false,
      game: import('phaser').Game | undefined;
    const el = gameEl.current;
    void import('./iso').then(({ mountGame }) => {
      if (!cancelled) game = mountGame(el, room, session.profile.id);
    });
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, [room, page]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    useUI.setState({ error: '' });
    try {
      await fn();
    } catch (e) {
      useUI.setState({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function login(demo: boolean) {
    audio.unlock();
    await action(async () => {
      const s = await api('/session', { name: name.trim() || 'Wanderer', demo });
      saveSession(s);
      setPage('heroes');
    });
  }
  async function start(mode: Mode) {
    audio.unlock();
    await action(async () => {
      if (!session) return;
      await wakeServer();
      await room?.leave();
      useUI.setState({ snapshot: null, resultSaved: false });
      setWaiting(mode === 'tutorial' ? 0 : 5);
      setMessages([]);
      setPaused(false);
      const endpoint = connection().ws;
      const c = new Client(endpoint);
      const match = mode === 'tutorial' ? c.create.bind(c) : c.joinOrCreate.bind(c);
      const r = await match(mode === 'squad' ? 'conquest' : mode === 'quest' ? 'quest' : 'battle', {
        mode,
        protocol: PROTOCOL_VERSION,
        ageBand: useUI.getState().me?.age?.band ?? 'solo',
        demo: !!session.profile.demo,
        squadId: mode === 'squad' || mode === 'quest' ? (squad?.id ?? '') : '',
        token: session.token,
        hero,
      });
      wireRoom(r, c);
      setRoom(r);
      setPage('battle');
    });
  }
  async function startCampaign(missionId: number) {
    audio.unlock();
    await action(async () => {
      if (!session) return;
      await wakeServer();
      await room?.leave();
      let current = squad;
      if (MISSIONS[missionId - 1].chapter > 1 && !current) {
        current = await api('/squad', {});
        setSquad(current);
        const url = location.origin + '/?pass=' + encodeURIComponent(current.id);
        setQr(await QRCode.toDataURL(url, { width: 160 }));
      }
      useUI.setState({ snapshot: null, resultSaved: false });
      setWaiting(2);
      setPaused(false);
      const c = new Client(connection().ws);
      const options = {
        missionId,
        protocol: PROTOCOL_VERSION,
        ageBand: useUI.getState().me?.age?.band ?? 'solo',
        demo: !!session.profile.demo,
        token: session.token,
        hero,
        squadId: current?.id ?? '',
      };
      const r = await (current
        ? c.joinOrCreate('campaign', options)
        : c.create('campaign', options));
      wireRoom(r, c);
      setRoom(r);
      setPage('battle');
    });
  }

  function wireRoom(r: Room, c: Client) {
    r.onMessage('snapshot', (w: World) => {
      if (w.protocol !== PROTOCOL_VERSION) {
        useUI.setState({ error: 'Your game version is outdated. Refresh this page.' });
        void r.leave();
        return;
      }
      useUI.setState({ snapshot: w });
      if (w.tick > 0) setWaiting(0);
    });
    r.onMessage('waiting', (m: { seconds: number }) => setWaiting(m.seconds));
    r.onMessage('identity', () => {});
    r.onMessage('chat', (m: any) => setMessages((v) => [...v.slice(-15), m]));
    r.onMessage('saving', () => useUI.setState({ resultSaved: false }));
    r.onMessage('result', () => {
      useUI.setState({ resultSaved: true });
      void refresh();
    });
    r.onError((_code, message) => useUI.setState({ error: message ?? 'Connection error' }));
    r.onLeave(async (code) => {
      setWaiting(0);
      if (code !== 1006 && code !== 1001) return;
      if (useUI.getState().snapshot?.finished) return;
      useUI.setState({ error: 'Connection interrupted. Rejoining your arena...' });
      const deadline = Date.now() + 28000;
      while (Date.now() < deadline) {
        try {
          const next = await c.reconnect(r.reconnectionToken);
          wireRoom(next, c);
          setRoom(next);
          useUI.setState({ error: '' });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      useUI.setState({
        error: 'Reconnection window expired. Your warrior is now server-controlled.',
      });
    });
  }
  async function exit() {
    await room?.leave();
    setRoom(null);
    useUI.setState({ snapshot: null, resultSaved: false });
    await refresh();
    setPage('journey');
  }
  async function getSquad(code?: string) {
    await action(async () => {
      const s = await api('/squad', code ? { code } : {});
      setSquad(s);
      setPage('squad');
      const url = location.origin + '/?pass=' + encodeURIComponent(s.id);
      setQr(
        await QRCode.toDataURL(url, { color: { dark: '#101e23', light: '#f2dfad' }, width: 160 }),
      );
    });
  }
  const mine = snapshot?.players.find((p) => p.id === session?.profile.id),
    isDemo = !!session?.profile.demo;
  const finalVictory =
    snapshot?.winner === mine?.team &&
    (snapshot?.mode === 'quest' || snapshot?.campaign?.missionId === 15);
  const nav = [
    ['home', '⌂', 'The kingdom'],
    ['journey', '◇', 'Your journey'],
    ['arena', '⚔', 'Battle arena'],
    ['squad', '☏', 'Team room'],
    ['heroes', '♜', 'Warriors'],
    ['leaderboard', '♛', 'Hall of legends'],
    ['profile', '◈', 'Your legacy'],
    ['personalize', '◉', 'Your likeness'],
    ['age', '◇', 'Adult matchmaking'],
  ];
  function navigate(id: string) {
    if (id === 'squad') {
      if (session) void getSquad();
      else setPage('identity');
      return;
    }
    if (['personalize', 'age', 'review'].includes(id) && !session) {
      setPage('identity');
      return;
    }
    if (id === 'leaderboard' && session)
      void action(async () => {
        setLeaders(await api('/leaderboard'));
        setPage(id);
      });
    else setPage(id);
  }
  const tutorialText: Record<string, string> = {
    movement: 'Move with W A S D or the arrow keys. Explore the training grounds.',
    attack: 'Approach the training warrior. Aim and click to land two sword strikes.',
    defend: 'Hold the right mouse button to raise your shield.',
    dodge: 'Press SPACE to dodge. Watch your stamina.',
  };
  const questText: Record<string, string> = {
    artifacts: 'Find three royal seals. Stand close and hold E to collect.',
    puzzle: 'The inscription reads: Moon → Sun → Star → Diamond. Activate the pillars with E.',
    guardian: 'The Lion Guardian awakens. Dodge the red shockwave; strike during its recovery.',
    challenge: 'The Royal Challenge. Your strongest warrior faces the King.',
    eclipse: 'The Eclipse Crown breaks free. Fight together. Claim the throne.',
    victory: 'The kingdom is free. Your legend begins.',
  };
  return (
    <div className={'app ' + (page === 'battle' ? 'in-battle' : '')}>
      {page !== 'battle' && (
        <>
          <aside className="sidebar">
            <a className="brand" onClick={() => setPage('home')}>
              <span className="brand-mark">♛</span>
              <span>
                <b className="amharic-title" lang="am">
                  ክብረ ጉግስ
                </b>
                <span className="brand-latin">KIBRE GUGS</span>
                <small>THE BATTLE FOR THE THRONE</small>
              </span>
            </a>
            <div className="side-label">THE KINGDOM OF AKSUMARA</div>
            <nav>
              {nav.map(([id, icon, label]) => (
                <button
                  key={id}
                  disabled={busy}
                  onClick={() => navigate(id)}
                  className={page === id ? 'active' : ''}
                >
                  <span>{icon}</span>
                  {label}
                  {id === 'journey' && <i>03</i>}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="realm-dot" />{' '}
              {warming ? 'WAKING REALM' : me?.profile ? 'REALM CONNECTED' : 'REALM PENDING'}{' '}
              <span>30 Hz</span>
            </div>
            <div className="side-foot">FOUR WARRIORS. ONE CROWN.</div>
          </aside>
          <header>
            <div className="breadcrumb">
              AKSUMARA <span>/</span> {page === 'home' ? 'THE ROYAL TRIALS' : page.toUpperCase()}
            </div>
            <div className="top-right">
              <span className="network">
                <i /> PROFILE{' '}
                <em>{me?.wallet?.status === 'verified' ? 'WALLET LINKED' : 'WALLET NOT LINKED'}</em>
              </span>
              <button
                className="sound"
                aria-label="Toggle sound"
                onClick={() => {
                  audio.unlock();
                  useUI.setState({ muted: !muted });
                }}
              >
                {muted ? '♪̸' : '♪'}
              </button>
              {session ? (
                <button className="user-chip" onClick={() => setPage('profile')}>
                  <Portrait hero={hero} />
                  <span>
                    {session.profile.name}
                    <small>
                      {isDemo
                        ? 'DEMO WARRIOR'
                        : me?.identity === 'supabase'
                          ? 'AUTHENTICATED WARRIOR'
                          : 'GUEST WARRIOR'}
                    </small>
                  </span>
                </button>
              ) : (
                <span className="guest">A legend awaits</span>
              )}
            </div>
          </header>
        </>
      )}
      <main>
        {warming && (
          <div className="warming-message" role="status">
            Waking game server… Free hosting can take about a minute.
          </div>
        )}
        {page === 'personalize' && session && <AvatarEditor />}
        {page === 'age' && session && <AgePanel onSignIn={() => setPage('identity')} />}
        {page === 'review' && session && <ReviewPanel />}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => useUI.setState({ error: '' })}>×</button>
          </div>
        )}
        {page === 'home' && (
          <>
            <section className="hero">
              <div className="hero-art" />
              <div className="hero-shade" />
              <div className="hero-copy">
                <div className="eyebrow">
                  <span /> THE ROYAL TRIALS HAVE BEGUN
                </div>
                <span className="amharic-hero" lang="am">
                  ክብረ ጉግስ
                </span>
                <h1>
                  A kingdom fallen.
                  <br />A <em>legend</em> rising.
                </h1>
                <p>
                  Train as a warrior. Unite under four banners.
                  <br />
                  Challenge the enchanted King. Claim the throne.
                </p>
                <div className="hero-actions">
                  <button
                    className="gold-btn"
                    disabled={busy}
                    onClick={() => (session ? setPage('journey') : setPage('identity'))}
                  >
                    ENTER THE KINGDOM <span>↗</span>
                  </button>
                  <button
                    className="trailer-btn"
                    onClick={() => {
                      document.getElementById('path')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    EXPLORE THE JOURNEY <span>↓</span>
                  </button>
                </div>
                <div className="hero-meta">
                  <span>⚔ REAL-TIME COMBAT</span>
                  <b>·</b>
                  <span>♝ FOUR-PLAYER SQUADS</span>
                  <b>·</b>
                  <span>◈ VERIFIED GLORY</span>
                </div>
              </div>
              <div className="chapter">
                <span>CHAPTER I</span>
                <strong>The call of the crown</strong>
                <small>A new age begins with you.</small>
              </div>
              <div className="image-credit">THE FICTIONAL KINGDOM OF AKSUMARA</div>
            </section>
            <section className="path-section" id="path">
              <div className="section-title">
                <div>
                  <span className="eyebrow">FROM WARRIOR TO LEGEND</span>
                  <h2>One throne. Three trials.</h2>
                </div>
                <span className="subtle">Your crown must be earned.</span>
              </div>
              <div className="stage-grid">
                {[
                  {
                    n: '01',
                    name: 'The Warrior’s Trial',
                    desc: 'Master the blade. Prove your strength in the arena.',
                    tag: 'INDIVIDUAL GLORY',
                    icon: '⚔',
                    class: 'trial',
                  },
                  {
                    n: '02',
                    name: 'The Four Banners',
                    desc: 'Four warriors. One purpose. Conquer together.',
                    tag: 'SQUAD WARFARE',
                    icon: '⚑',
                    class: 'banners',
                  },
                  {
                    n: '03',
                    name: 'The Lost Crown',
                    desc: 'Unlock the citadel. Break the King’s enchantment.',
                    tag: 'COOPERATIVE FINALE',
                    icon: '♛',
                    class: 'crown',
                  },
                ].map((s, i) => (
                  <button
                    className={'stage-card ' + s.class}
                    key={s.n}
                    onClick={() => (session ? setPage('journey') : setPage('identity'))}
                  >
                    <div className="stage-top">
                      <span>STAGE {s.n}</span>
                      <span>{i === 0 ? '↗' : '⌑'}</span>
                    </div>
                    <div className="stage-art">{s.icon}</div>
                    <div className="stage-content">
                      <span className="eyebrow">{s.tag}</span>
                      <h3>{s.name}</h3>
                      <p>{s.desc}</p>
                      <div className="stage-line">
                        <span>{i === 0 ? 'YOUR JOURNEY STARTS HERE' : 'EARN YOUR PLACE'}</span>
                        <span>→</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section className="fellowship-strip">
              <div className="fellowship-icon">♝</div>
              <div>
                <span className="eyebrow">BEYOND THE BATTLEFIELD</span>
                <h3>Real warriors. Real fellowship.</h3>
                <p>Meet your squad in the real world. Forge a bond worthy of the crown.</p>
              </div>
              <div className="fellowship-badge">
                ◈
                <span>
                  PROOF OF
                  <br />
                  <b>FELLOWSHIP</b>
                </span>
              </div>
            </section>
            <footer>
              <span>© 2026 ክብረ ጉግስ · KIBRE GUGS</span>
              <span>INSPIRED BY HERITAGE. BUILT FOR LEGENDS.</span>
              <span>
                HACKATHON PROTOTYPE <i>◆</i>
              </span>
            </footer>
          </>
        )}
        {page === 'identity' && (
          <section className="center-page identity">
            <span className="crest">♛</span>
            <span className="eyebrow">EVERY LEGEND HAS A NAME</span>
            <h1>Answer the call.</h1>
            <p>
              Enter Aksumara with a server-issued guest identity.
              <br />
              Your victories and journey are saved on this server.
            </p>
            <label htmlFor="nickname">WARRIOR NAME</label>
            <input
              id="nickname"
              maxLength={20}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What shall the bards call you?"
            />
            <button disabled={busy} className="gold-btn" onClick={() => login(true)}>
              {busy ? 'OPENING THE GATES…' : 'PLAY THE STORY DEMO'} <span>→</span>
            </button>
            <button disabled={busy} className="outline-btn" onClick={() => login(false)}>
              BEGIN NORMAL PROGRESSION
            </button>
            <small>
              Demo: approximately 8–12 minutes · Separate records · No real token rewards
            </small>
          </section>
        )}
        {page === 'heroes' && (
          <section className="content-page">
            <div className="section-title">
              <div>
                <span className="eyebrow">FOUR SPIRITS. ONE DESTINY.</span>
                <h1>Choose your warrior.</h1>
              </div>
              <span className="subtle">Appearance is cosmetic. Courage is yours.</span>
            </div>
            <div className="hero-grid">
              {heroes.map((h, i) => (
                <button
                  key={h.name}
                  className={'hero-card ' + (hero === i ? 'selected' : '')}
                  onClick={() => useUI.setState({ hero: i })}
                >
                  <Portrait hero={i} />
                  <div>
                    <span className="eyebrow">{h.title}</span>
                    <h2>{h.name}</h2>
                    <p>{h.desc}</p>
                    <span className="select-state">
                      {hero === i ? '✓ YOUR CHOSEN WARRIOR' : 'SELECT WARRIOR'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="bottom-actions">
              <span className="subtle">Every warrior begins with the same sword and shield.</span>
              <button
                className="gold-btn"
                disabled={busy}
                onClick={() => (session ? setPage('journey') : setPage('identity'))}
              >
                MY JOURNEY <span>→</span>
              </button>
            </div>
          </section>
        )}
        {page === 'journey' && (
          <CampaignScreen
            onMission={startCampaign}
            onTraining={() => start('tutorial')}
            onSquad={() => getSquad()}
            busy={busy}
          />
        )}
        {page === 'arena' && (
          <section className="content-page">
            {!session ? (
              <Gate onPlay={() => setPage('identity')} />
            ) : (
              <>
                <div className="section-title">
                  <div>
                    <span className="eyebrow">WELCOME, {session.profile.name.toUpperCase()}</span>
                    <h1>Battle Arena</h1>
                    <p className="subtle">
                      {me?.age?.band
                        ? `Human matchmaking · reviewed adults ${me.age.band}`
                        : 'Solo and AI play · Fayda review enables human matchmaking.'}
                    </p>
                  </div>
                  <span className="demo-tag">
                    {isDemo ? 'ISOLATED STORY DEMO' : 'NORMAL PROGRESSION'}
                  </span>
                </div>
                <div className="journey-intro">
                  <Portrait hero={hero} />
                  <div>
                    <h2>{heroes[hero].name}</h2>
                    <p>
                      Fight a 1v1 duel or gather a team for 4v4 Banner Conquest. Story missions are
                      under Your journey.
                    </p>
                    <span className="eyebrow">
                      {progress?.xp ?? 0} LIFETIME XP <span className="divider">/</span>{' '}
                      {progress?.rating ?? 1000} INDIVIDUAL RATING
                    </span>
                  </div>
                  <span className="big-crest">♜</span>
                </div>
                <div className="journey-rows">
                  <article>
                    <div className="step-number">00</div>
                    <div>
                      <span className="eyebrow">LEARN THE BLADE</span>
                      <h2>The training grounds</h2>
                      <p>Movement, striking, blocking and dodging. A warrior’s foundations.</p>
                    </div>
                    <button
                      className="outline-btn"
                      disabled={busy}
                      onClick={() => start('tutorial')}
                    >
                      {progress?.tutorial ? 'REPLAY TRAINING' : 'BEGIN TRAINING'} →
                    </button>
                  </article>
                  <article>
                    <div className="step-number">01</div>
                    <div>
                      <span className="eyebrow">
                        {progress?.qualifying ?? 0} / {isDemo ? 1 : 10} QUALIFYING VICTORIES
                      </span>
                      <h2>1v1 Duel Arena</h2>
                      <p>
                        A 75-second duel. A human rival, or a worthy AI opponent after five seconds.
                      </p>
                    </div>
                    <button
                      disabled={busy || !progress?.tutorial}
                      className="gold-btn"
                      onClick={() => start('duel')}
                    >
                      ENTER ARENA ⚔
                    </button>
                    {!progress?.tutorial && <small>Complete training above to unlock duels.</small>}
                  </article>
                  <article>
                    <div className="step-number">02</div>
                    <div>
                      <span className="eyebrow">{progress?.squadRating ?? 1000} SQUAD RATING</span>
                      <h2>4v4 Team Arena</h2>
                      <p>Gather your squad. Capture the banners. Earn your Royal Lunch Pass.</p>
                    </div>
                    <button className="outline-btn" disabled={busy} onClick={() => getSquad()}>
                      OPEN TEAM ROOM →
                    </button>
                  </article>
                  <article className={(progress?.stage ?? 1) < 3 ? 'locked' : ''}>
                    <div className="step-number">03</div>
                    <div>
                      <span className="eyebrow">THE FINAL CHAPTER</span>
                      <h2>The Lost Crown</h2>
                      <p>Three seals, an ancient puzzle, a guardian, and the King who waits.</p>
                    </div>
                    <button
                      className="outline-btn"
                      disabled={busy || (progress?.stage ?? 1) < 3}
                      onClick={() => setPage('journey')}
                    >
                      OPEN THE CAMPAIGN →
                    </button>
                  </article>
                </div>
              </>
            )}
          </section>
        )}
        {page === 'squad' && (
          <section className="content-page">
            <div className="section-title">
              <div>
                <span className="eyebrow">TEAM ROOM · CHAT, INVITE, READY UP</span>
                <h1>{squad?.name ?? 'The Four Banners'}</h1>
              </div>
              <span className="invite-code">
                INVITE CODE <b>{squad?.code}</b>
              </span>
            </div>
            <div className="team-room-guide">
              <p>
                Share the six-character code with a teammate. They can open Team room and join using
                it. Invited members must meet the reviewed-adult team rules. Chat does not require
                training or a wallet; battle qualification is separate.
              </p>
              <button className="outline-btn" onClick={() => setPage('arena')}>
                GO TO BATTLE ARENA →
              </button>
            </div>
            <div id="team-chat-slot" />
            <div className="squad-slots">
              {[0, 1, 2, 3].map((n) => (
                <div className="squad-slot" key={n}>
                  <Portrait hero={n === 0 ? hero : n} />
                  <h3>{squad?.members[n]?.name ?? ['', 'Selam', 'Dawit', 'Makeda'][n]}</h3>
                  <span>{squad?.members[n] ? 'HUMAN WARRIOR' : 'SERVER AI · FILLER'}</span>
                  <small>
                    {['Lion Guardian', 'Spear Vanguard', 'Royal Archer', 'Cavalry Raider'][n]}
                  </small>
                </div>
              ))}
            </div>
            <div className="bottom-actions">
              <div>
                <input
                  aria-label="Invite code"
                  placeholder="Enter an invite code"
                  value={invite}
                  maxLength={6}
                  onChange={(e) => setInvite(e.target.value)}
                />
                <button
                  className="outline-btn"
                  disabled={busy || invite.length < 6}
                  onClick={() => getSquad(invite)}
                >
                  JOIN
                </button>
              </div>
              <button
                className="gold-btn"
                disabled={busy || (progress?.stage ?? 1) < 2}
                onClick={() => window.dispatchEvent(new Event('knights-ready'))}
              >
                READY · BANNER CONQUEST <span>⚑</span>
              </button>
            </div>
            <SquadReadiness squad={squad} onStart={() => start('squad')} />
            {(progress?.stage ?? 1) < 2 && (
              <p className="subtle">
                Team chat is open. To unlock 4v4 battles, complete training and earn{' '}
                {isDemo ? 'one qualifying duel win' : 'ten qualifying duel wins'}. Your team members
                must each qualify.
              </p>
            )}
            <div className="lunch-pass">
              <div>
                <span className="eyebrow">THE ROYAL GATHERING</span>
                <h2>A seat at the royal table.</h2>
                <p>
                  Complete Chapter II to unlock your pass. Legacy arena qualification also remains
                  valid: {isDemo ? 'one squad victory' : 'two squad victories with 1100 rating'}.
                </p>
                <small>
                  Prototype Royal Lunch Pass — demonstration only.
                  <br />
                  Not redeemable at Burger King. No commercial partnership.
                </small>
              </div>
              <div className="pass-ticket">
                <span>ROYAL LUNCH PASS</span>
                <h3>Proof of Fellowship</h3>
                {qr && <img src={qr} alt="Royal Lunch Pass verification QR" />}
                <small>
                  {squad?.code} · {squad?.id?.slice(0, 8)}
                </small>
                <button
                  className="gold-btn"
                  disabled={
                    busy ||
                    (!me?.campaign?.completed?.includes(isDemo ? 8 : 10) &&
                      ((progress?.squadWins ?? 0) < (isDemo ? 1 : 2) ||
                        (!isDemo && (progress?.squadRating ?? 0) < 1100)))
                  }
                  onClick={() => setPage('gathering')}
                >
                  VIEW PASS →
                </button>
              </div>
            </div>
          </section>
        )}
        {page === 'gathering' && (
          <section className="center-page">
            <span className="crest">♝</span>
            <span className="eyebrow">PROOF OF FELLOWSHIP</span>
            <h1>Beyond the screen.</h1>
            <p>
              {isDemo
                ? 'Your squad gathers at the royal table. This demonstration uses simulated approvals from AI teammates.'
                : 'Genuine verification requires four authenticated humans and a consented private image upload. Use the private gathering workflow below after all four members sign in through Supabase.'}
            </p>
            {qr && <img className="qr" src={qr} alt="Lunch Pass QR" />}
            {isDemo && (
              <div className="approval-row">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i}>
                    {i === 0 ? session?.profile.name : 'AI teammate ' + i}
                    <b>{i === 0 ? 'YOU' : 'SIMULATED'}</b>
                  </span>
                ))}
              </div>
            )}
            {!isDemo && <GatheringPanel squad={squad} onVerified={refresh} />}{' '}
            {isDemo && (
              <button
                disabled={busy}
                className="gold-btn"
                onClick={() =>
                  action(async () => {
                    await api('/gathering/demo', { squadId: squad.id });
                    await refresh();
                    setPage('journey');
                  })
                }
              >
                SIMULATE GATHERING · UNLOCK CITADEL →
              </button>
            )}
            {isDemo && (
              <small>Demonstration only. No photo is uploaded. No real rewards issued.</small>
            )}
          </section>
        )}
        {page === 'leaderboard' && (
          <section className="content-page">
            <div className="section-title">
              <div>
                <span className="eyebrow">HONOR, WRITTEN IN STONE</span>
                <h1>The hall of legends.</h1>
              </div>
              <span className="demo-tag">{isDemo ? 'DEMO RECORDS' : 'LOCAL GUEST RECORDS'}</span>
            </div>
            {!session ? (
              <Gate onPlay={() => setPage('identity')} />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>RANK</th>
                      <th>WARRIOR</th>
                      <th>RATING</th>
                      <th>VICTORIES</th>
                      <th>XP</th>
                      <th>STAGE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaders.map((p, i) => (
                      <tr key={p.id}>
                        <td className="rank">{String(i + 1).padStart(2, '0')}</td>
                        <td>
                          {p.name}
                          {p.id === session.profile.id && <small> YOU</small>}
                        </td>
                        <td className="gold-text">{p.progress.rating}</td>
                        <td>{p.progress.wins}</td>
                        <td>{p.progress.xp}</td>
                        <td>{p.progress.stage}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {leaders.length === 0 && (
                  <p className="empty">The first legend is yet to be written.</p>
                )}
              </div>
            )}
          </section>
        )}
        {page === 'profile' && (
          <div className="personal-panel audio-settings">
            <label>
              Music{' '}
              <input
                aria-label="Menu music volume"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={musicVolume}
                onChange={(e) => {
                  audio.unlock();
                  useUI.setState({ musicVolume: Number(e.target.value) });
                }}
              />
            </label>
            <label>
              Sound effects{' '}
              <input
                aria-label="Menu sound effects volume"
                type="range"
                min="0"
                max="1"
                step=".05"
                value={volume}
                onChange={(e) => useUI.setState({ volume: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        {page === 'profile' && (
          <section className="content-page">
            {!session ? (
              <Gate onPlay={() => setPage('identity')} />
            ) : (
              <>
                <div className="section-title">
                  <div>
                    <span className="eyebrow">YOUR STORY, VERIFIED</span>
                    <h1>{session.profile.name}’s legacy.</h1>
                  </div>
                  <span className="demo-tag">
                    {me?.wallet?.status === 'verified' ? 'WALLET VERIFIED' : 'WALLET PENDING'} ·{' '}
                    {me?.identity === 'supabase' ? 'SUPABASE' : 'GUEST'} IDENTITY
                  </span>
                </div>
                <WalletPanel onLinked={refresh} />
                <p className="profile-identity">
                  Game profile ID: <code>{session.profile.id}</code>
                  <br />
                  Wallet link:{' '}
                  {me?.wallet?.status === 'verified'
                    ? 'Verified signature · saved in the game database'
                    : 'Not linked'}{' '}
                  · On-chain profile registration: not implemented.
                </p>
                <div className="stats-row">
                  {[
                    ['LIFETIME XP', progress?.xp],
                    ['RATING', progress?.rating],
                    ['VICTORIES', progress?.wins],
                    ['REWARD POINTS', progress?.points],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
                <h2 className="spaced">
                  Your achievements <small>OFF-CHAIN {isDemo ? '· DEMO' : ''}</small>
                </h2>
                <div className="badge-grid">
                  {me?.badges?.length ? (
                    me.badges.map((b: any) => (
                      <div className="badge" key={b.badge}>
                        <span>◈</span>
                        <h3>{b.badge}</h3>
                        <small>SERVER-VALIDATED {isDemo ? 'DEMO' : 'LOCAL'}</small>
                      </div>
                    ))
                  ) : (
                    <p className="subtle">Your first achievement awaits in the arena.</p>
                  )}
                </div>
                <h2 className="spaced">Battle chronicles</h2>
                <div className="history-list">
                  {me?.history?.map((r: any) => (
                    <MatchRecord key={r.id} record={r} />
                  ))}
                </div>
                {isDemo && (
                  <button
                    className="outline-btn danger"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        saveSession(await api('/demo/reset', {}));
                        useUI.setState({ me: null });
                        setSquad(null);
                        setPage('journey');
                      })
                    }
                  >
                    RESET DEMO
                  </button>
                )}
                <button
                  className="outline-btn"
                  style={{ marginTop: 25, marginLeft: 12 }}
                  onClick={() => action(async () => {
                    await signOutIdentity();
                    setSquad(null);
                    setPage('identity');
                  })}
                >
                  CHANGE IDENTITY / SIGN OUT
                </button>
              </>
            )}
          </section>
        )}
        {page === 'battle' && (
          <div className="battle-layout">
            <div className="battle-top">
              <button className="outline-btn" onClick={exit}>
                ← LEAVE ARENA
              </button>
              <div>
                <span className="eyebrow">
                  {snapshot?.campaign
                    ? ['THE WARRIOR’S TRIAL', 'THE FOUR BANNERS', 'THE LOST CROWN'][
                        MISSIONS[snapshot.campaign.missionId - 1].chapter - 1
                      ]
                    : snapshot?.mode === 'quest'
                      ? 'THE LOST CROWN'
                      : snapshot?.mode === 'squad'
                        ? 'THE FOUR BANNERS'
                        : snapshot?.mode === 'tutorial'
                          ? 'TRAINING GROUNDS'
                          : 'THE WARRIOR’S TRIAL'}
                </span>
                <h3>
                  {snapshot?.campaign
                    ? MISSIONS[snapshot.campaign.missionId - 1].name
                    : snapshot?.mode === 'squad'
                      ? 'Banner Conquest'
                      : snapshot?.mode === 'quest'
                        ? 'The citadel of Aksumara'
                        : 'The sunstone arena'}
                </h3>
              </div>
              <div className="timer">
                {snapshot
                  ? `${Math.max(0, Math.floor(snapshot.time / 60))}:${String(Math.max(0, Math.floor(snapshot.time % 60))).padStart(2, '0')}`
                  : 'CONNECTING'}
              </div>
              <span className="demo-tag">{isDemo ? 'STORY DEMO' : 'LIVE ARENA'}</span>
            </div>
            <div className="arena-room-banner" role="status">
              <strong>
                {snapshot?.campaign
                  ? 'STORY MISSION'
                  : snapshot?.mode === 'squad'
                    ? '4V4 TEAM ARENA'
                    : snapshot?.mode === 'duel'
                      ? '1V1 DUEL ARENA'
                      : 'TRAINING ARENA'}
              </strong>
              <span>
                {waiting > 0
                  ? 'MATCHMAKING · WAITING FOR PLAYERS'
                  : snapshot?.finished
                    ? 'MATCH FINISHED'
                    : 'CONNECTED TO ARENA'}
              </span>
              <span>Room: {room?.roomId ?? 'Connecting…'}</span>
              <span>
                {snapshot?.players.filter((p) => p.kind === 'warrior' && !p.bot).length ?? 0}{' '}
                human-controlled ·{' '}
                {snapshot?.players.filter((p) => p.kind === 'warrior' && p.bot).length ?? 0}{' '}
                AI-controlled
              </span>
            </div>
            <ScrollGuide
              id={
                snapshot?.campaign
                  ? `${snapshot.campaign.missionId}-${snapshot.campaign.messageId}`
                  : `${snapshot?.mode}-${snapshot?.phase}`
              }
              chapter={
                snapshot?.campaign
                  ? MISSIONS[snapshot.campaign.missionId - 1].name
                  : 'THE ROYAL CHRONICLER'
              }
              message={
                snapshot?.campaign?.objective ??
                (snapshot?.mode === 'tutorial'
                  ? tutorialText[snapshot.phase]
                  : snapshot?.mode === 'quest'
                    ? questText[snapshot.phase]
                    : snapshot?.mode === 'squad'
                      ? `Capture and hold the three banners · EMERALD ${Math.floor(snapshot.scores[0])} : ${Math.floor(snapshot.scores[1])} CRIMSON`
                      : 'Defeat your rival. Aim with the mouse. Every strike matters.')
              }
            />
            <div className="arena-toolbar">
              <label>
                MUSIC{' '}
                <input
                  aria-label="Music volume"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={musicVolume}
                  onChange={(e) => {
                    audio.unlock();
                    useUI.setState({ musicVolume: Number(e.target.value) });
                  }}
                />
              </label>
              <span>WASD / ARROWS · WHEEL TO ZOOM · F FULLSCREEN</span>
              <button
                onClick={() => {
                  const el = document.querySelector('.battle-layout');
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void el?.requestFullscreen();
                }}
              >
                ⛶ FULLSCREEN
              </button>
              <label>
                SFX{' '}
                <input
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  aria-label="Sound volume"
                  value={volume}
                  onChange={(e) => useUI.setState({ volume: Number(e.target.value) })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={useUI.getState().reducedMotion}
                  onChange={(e) => useUI.setState({ reducedMotion: e.target.checked })}
                />{' '}
                REDUCED MOTION
              </label>
            </div>
            <div className="game-wrap">
              <div ref={gameEl} className="phaser-host" />
              {(!snapshot || waiting > 0) && (
                <div className="waiting">
                  <span className="crest">⚔</span>
                  <h2>Assembling the arena…</h2>
                  <p>
                    {snapshot?.campaign
                      ? 'Preparing your expedition and AI companions.'
                      : me?.age?.band
                        ? 'Searching for a rival in your age band · AI joins after five seconds'
                        : 'Solo practice · AI rival joins after five seconds'}
                  </p>
                  <span>{waiting}s</span>
                </div>
              )}
              {snapshot?.bossMax! > 0 && !snapshot?.finished && (
                <div className="boss-bar">
                  <span>
                    {snapshot?.phase === 'guardian' ? 'THE LION GUARDIAN' : 'THE ENCHANTED KING'}
                  </span>
                  <div>
                    <i
                      style={{
                        width: (100 * (snapshot?.bossHp ?? 0)) / (snapshot?.bossMax ?? 1) + '%',
                      }}
                    />
                  </div>
                </div>
              )}
              {paused && !snapshot?.finished && (
                <div className="modal-overlay">
                  <div className="result-card">
                    <span className="eyebrow">CONTROLS RELEASED</span>
                    <h2>Take a breath.</h2>
                    <p>The live battle continues. Press ESC to return.</p>
                    <button className="outline-btn" onClick={exit}>
                      LEAVE ARENA
                    </button>
                  </div>
                </div>
              )}
              {board && snapshot && (
                <div className="scoreboard">
                  <h2>Battle contributions</h2>
                  {snapshot.players.map((p) => (
                    <div key={p.id}>
                      <span>{p.name}</span>
                      <b>
                        {Math.round(p.contribution)} · {p.kills} K
                      </b>
                    </div>
                  ))}
                </div>
              )}
              {snapshot?.finished && (
                <div className="modal-overlay">
                  <div className="result-card">
                    <span className="crest">{snapshot.winner === mine?.team ? '♛' : '⚔'}</span>
                    <span className="eyebrow">
                      {finalVictory ? 'THE ENCHANTMENT IS BROKEN' : 'THE ARENA HAS SPOKEN'}
                    </span>
                    <h1>
                      {snapshot.mode === 'tutorial'
                        ? 'A warrior awakens.'
                        : snapshot.winner === mine?.team
                          ? 'Glory is yours.'
                          : 'Rise. Fight again.'}
                    </h1>
                    <p>
                      {finalVictory
                        ? 'Aksumara is free. Every warrior has earned their place in its story.'
                        : snapshot.mode === 'tutorial'
                          ? 'Your training is complete. The Royal Trials await.'
                          : 'Your journey continues once the server confirms this result.'}
                    </p>
                    {finalVictory && (
                      <span className="eyebrow">
                        CROWN CHAMPION ·{' '}
                        {snapshot.players.find((p) => p.id === snapshot.champion)?.name ??
                          'The royal squad'}
                      </span>
                    )}
                    <div className="result-stats">
                      <span>
                        <b>{Math.round(mine?.damage ?? 0)}</b>DAMAGE
                      </span>
                      <span>
                        <b>{mine?.kills ?? 0}</b>TAKEDOWNS
                      </span>
                      <span>
                        <b>{Math.round(mine?.contribution ?? 0)}</b>CONTRIBUTION
                      </span>
                    </div>
                    <span className="verification">
                      {resultSaved
                        ? '◈ SERVER RESULT SAVED · VERIFY IN YOUR LEGACY'
                        : 'SAVING RESULT… PLEASE STAY CONNECTED'}
                    </span>
                    <button className="gold-btn" disabled={!resultSaved} onClick={exit}>
                      CONTINUE THE JOURNEY →
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="battle-bottom">
              <div className="player-hud">
                <Portrait hero={hero} />
                <div>
                  <strong>
                    {session?.profile.name} <small>· {mine?.role.toUpperCase()}</small>
                  </strong>
                  <div className="meter health">
                    <i style={{ width: (100 * (mine?.hp ?? 100)) / (mine?.maxHp ?? 100) + '%' }} />
                    <span>
                      {Math.ceil(mine?.hp ?? 100)} / {mine?.maxHp ?? 100} HP
                    </span>
                  </div>
                  <div className="meter stamina">
                    <i style={{ width: (mine?.stamina ?? 100) + '%' }} />
                  </div>
                </div>
              </div>
              <div className="control">
                <kbd>WASD / ↑←↓→</kbd>
                <span>MOVE</span>
              </div>
              <div className="control">
                <kbd>LMB</kbd>
                <span>STRIKE</span>
              </div>
              <div className="control">
                <kbd>RMB</kbd>
                <span>BLOCK</span>
              </div>
              <div className="control">
                <kbd>SPACE</kbd>
                <span>DODGE</span>
              </div>
              <div className="control">
                <kbd>Q</kbd>
                <span>ABILITY</span>
              </div>
              <div className="control">
                <kbd>E</kbd>
                <span>INTERACT</span>
              </div>
              <button
                className="sound"
                onClick={() => {
                  audio.unlock();
                  useUI.setState({ muted: !muted });
                }}
              >
                {muted ? '♪̸' : '♪'}
              </button>
            </div>
            {waiting > 0 && !snapshot && (
              <form
                className="lobby-chat"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (chat.trim()) {
                    room?.send('chat', chat.trim());
                    setChat('');
                  }
                }}
              >
                {messages.map((m, i) => (
                  <p key={i}>
                    {m.name}: {m.text}
                  </p>
                ))}
                <input
                  aria-label="Lobby chat"
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                  maxLength={200}
                  placeholder="Lobby message…"
                />
              </form>
            )}
          </div>
        )}
      </main>
      {session && squad && (
        <TeamChat
          key={session.profile.id + ':' + squad.id}
          squad={squad}
          page={page}
          onRoster={(members) =>
            setSquad((current: any) =>
              current?.id === squad.id ? { ...current, members } : current,
            )
          }
          onMembershipChanged={() => void refresh()}
        />
      )}
      {busy && (
        <div className="busy-indicator">
          CONNECTING TO AKSUMARA <span>◆</span>
        </div>
      )}
    </div>
  );
}
function Gate({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="center-page">
      <span className="crest">♛</span>
      <h1>Your legend awaits.</h1>
      <p>Choose a name and enter the kingdom.</p>
      <button className="gold-btn" onClick={onPlay}>
        BEGIN YOUR JOURNEY →
      </button>
    </div>
  );
}
function SquadReadiness({ squad, onStart }: { squad: any; onStart: () => Promise<void> }) {
  const [members, setMembers] = useState<any[]>([]),
    [connected, setConnected] = useState(false);
  const lobby = useRef<Room | null>(null);
  const session = useUI((s) => s.session);
  useEffect(() => {
    let cancelled = false,
      pending = false;
    const ready = () => {
      if (lobby.current) lobby.current.send('ready', true);
      else pending = true;
    };
    window.addEventListener('knights-ready', ready);
    const endpoint = connection().ws;
    void new Client(endpoint)
      .joinOrCreate('squad-lobby', {
        squadId: squad.id,
        ageBand: useUI.getState().me?.age?.band ?? 'solo',
        token: session!.token,
      })
      .then((r) => {
        if (cancelled) {
          void r.leave();
          return;
        }
        lobby.current = r;
        setConnected(true);
        r.onMessage('members', setMembers);
        r.onMessage('chat', () => {});
        r.onMessage('start', () => {
          void onStart();
        });
        if (pending) r.send('ready', true);
      })
      .catch((e) => useUI.setState({ error: e.message }));
    return () => {
      cancelled = true;
      window.removeEventListener('knights-ready', ready);
      void lobby.current?.leave();
      lobby.current = null;
    };
  }, [squad.id]);
  return (
    <div className="squad-chat">
      <div>
        <span className="eyebrow">BATTLE READINESS · {connected ? 'CONNECTED' : 'CONNECTING'}</span>
        <p>
          {members.length
            ? members.map((m) => m.name + (m.ready ? ' ✓ READY' : ' · NOT READY')).join(' / ')
            : 'Gathering your warriors…'}
        </p>
        <small>
          All connected human members must ready up. Empty battlefield slots use labeled server AI.
        </small>
      </div>
    </div>
  );
}
function HostedLogin({ nickname }: { nickname: string }) {
  const [email, setEmail] = useState(''),
    [sent, setSent] = useState(false),
    [loading, setLoading] = useState(false);
  if (!hostedAuth) return null;
  return (
    <div className="hosted-login">
      <span className="eyebrow">OR SIGN IN THROUGH SUPABASE</span>
      <input
        type="email"
        aria-label="Email address"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        className="outline-btn"
        disabled={loading || !email.includes('@')}
        onClick={async () => {
          setLoading(true);
          try {
            localStorage.setItem('knights-hosted-name', nickname || 'Warrior');
            await signInEmail(email);
            setSent(true);
          } catch (e) {
            useUI.setState({ error: (e as Error).message });
          } finally {
            setLoading(false);
          }
        }}
      >
        SEND SIGN-IN LINK
      </button>
      {sent && <p>Check your email for the sign-in link.</p>}
    </div>
  );
}
function GatheringPanel({ squad, onVerified }: { squad: any; onVerified: () => Promise<void> }) {
  const [record, setRecord] = useState<any>(null),
    [consent, setConsent] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [loading, setLoading] = useState(false);
  const { me, session } = useUI();
  const leader = squad?.members[0]?.id === session?.profile.id;
  async function refresh() {
    const current = await api('/gathering-squad/' + squad.id);
    if (current.id) {
      const latest = await api('/gathering/' + current.id);
      setRecord(latest);
      if (latest.verified) await onVerified();
    }
  }
  async function run(fn: () => Promise<void>) {
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      useUI.setState({ error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (squad) void run(refresh);
  }, [squad?.id]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  if (me?.identity !== 'supabase')
    return (
      <p>
        Sign in through configured Supabase authentication to verify a genuine gathering. Local
        guests cannot approve human fellowship.
      </p>
    );
  return (
    <div className="gathering-panel">
      {!record ? (
        <>
          <p>
            {leader
              ? 'Create a gathering when all four qualified squad members are ready.'
              : 'Your squad leader must create the gathering.'}
          </p>
          {leader && (
            <button
              disabled={loading}
              className="gold-btn"
              onClick={() =>
                run(async () => {
                  setRecord(await api('/gathering', { squadId: squad.id }));
                })
              }
            >
              CREATE GATHERING
            </button>
          )}
        </>
      ) : (
        <>
          <span className="eyebrow">
            {record.verified ? 'FELLOWSHIP VERIFIED' : 'GATHERING ' + record.id.slice(0, 8)}
          </span>
          {record.photoUrl && (
            <img
              className="group-photo"
              src={record.photoUrl}
              alt="Private squad gathering photo"
            />
          )}
          {!record.verified && (
            <>
              <label className="upload-label">
                CHOOSE A SQUAD PHOTO
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && f.size > 5 * 1024 * 1024) {
                      useUI.setState({ error: 'Choose an image smaller than 5 MB' });
                      return;
                    }
                    setFile(f ?? null);
                    setPreview(f ? URL.createObjectURL(f) : '');
                  }}
                />
              </label>
              {preview && (
                <img className="group-photo" src={preview} alt="Selected photo preview" />
              )}
              <label className="consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />{' '}
                I consent to the private photo upload and confirm that I participated in this
                gathering. Every pictured person has agreed to sharing this photo.
              </label>
              {file && (
                <button
                  disabled={!consent || loading}
                  className="outline-btn"
                  onClick={() =>
                    run(async () => {
                      await requestJSON(
                        API + '/api/gathering/' + record.id + '/photo',
                        {
                          method: 'POST',
                          headers: {
                            Authorization: 'Bearer ' + session!.token,
                            'Content-Type': file.type,
                            'X-Photo-Consent': 'true',
                          },
                          body: file,
                        },
                        45000,
                      );
                      setFile(null);
                      setPreview('');
                      await refresh();
                    })
                  }
                >
                  UPLOAD PRIVATE PHOTO
                </button>
              )}
              {record.photoUrl && (
                <button
                  disabled={!consent || loading}
                  className="gold-btn"
                  onClick={() =>
                    run(async () => {
                      await api('/gathering/' + record.id + '/approve', { consent, revision: record.revision });
                      await refresh();
                      await onVerified();
                    })
                  }
                >
                  CONFIRM MY PARTICIPATION
                </button>
              )}
            </>
          )}
          <div className="approval-row">
            {squad.members.map((m: any) => (
              <span key={m.id}>
                {m.name}
                <b>{record.approvals?.includes(m.id) ? 'APPROVED' : 'PENDING'}</b>
              </span>
            ))}
          </div>
          {record.photoUrl && (
            <button
              disabled={loading}
              className="outline-btn"
              onClick={() =>
                run(async () => {
                  await requestJSON(API + '/api/gathering/' + record.id + '/photo', {
                    method: 'DELETE',
                    headers: { Authorization: 'Bearer ' + session!.token },
                  });
                  await refresh();
                })
              }
            >
              DELETE PHOTO
            </button>
          )}
        </>
      )}
      <button disabled={loading} className="outline-btn" onClick={() => run(refresh)}>
        REFRESH GATHERING
      </button>
      <small>
        Private images are never put on-chain. Participation approval is an account attestation; no
        facial recognition is performed.
      </small>
    </div>
  );
}
function WalletPanel({ onLinked }: { onLinked: () => Promise<void> }) {
  const { me } = useUI(),
    [loading, setLoading] = useState(false);
  return (
    <div className="wallet-panel">
      <div>
        <span className="eyebrow">CRYPTOGRAPHIC WALLET IDENTITY</span>
        <p>{me?.wallet?.address ?? 'Wallet pending. Guest identity is stored independently.'}</p>
        {me?.wallet?.playerId && <p>Wallet player ID: {me.wallet.playerId}</p>}
        <p>
          {me?.wallet?.address
            ? 'Wallet ownership verified. Your profile link is stored off-chain.'
            : 'Sign a message to prove wallet ownership. Linking does not spend funds or send a blockchain transaction.'}
        </p>
        {me?.wallet?.address && (
          <a
            target="_blank"
            rel="noreferrer"
            href={'https://sepolia.basescan.org/address/' + me.wallet.address}
          >
            View wallet on Base Sepolia ↗
          </a>
        )}
      </div>
      <button
        disabled={loading}
        className="outline-btn"
        onClick={async () => {
          setLoading(true);
          try {
            const eth = (window as any).ethereum;
            if (!eth)
              throw Error(
                'Install a compatible browser wallet to link an address. Embedded-wallet onboarding is not configured.',
              );
            const accounts = await eth.request({ method: 'eth_requestAccounts' });
            const address = accounts?.[0];
            if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address))
              throw Error('Select a wallet account before linking.');
            const challenge = await api('/wallet/nonce', { address });
            const bytes = new TextEncoder().encode(challenge.message);
            const message =
              '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
            const signature = await eth.request({
              method: 'personal_sign',
              params: [message, address],
            });
            await api('/wallet/bind', { address, signature });
            await onLinked();
          } catch (e) {
            useUI.setState({ error: (e as Error).message });
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading
          ? 'AWAITING SIGNATURE...'
          : me?.wallet?.address
            ? 'VERIFY LINKED WALLET'
            : 'LINK YOUR WALLET'}
      </button>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
