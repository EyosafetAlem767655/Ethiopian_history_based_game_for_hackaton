import React from 'react';
import {
  MISSIONS,
  DEMO_MISSIONS,
  freshCampaign,
  nextMission,
  missionEligibility,
  rankFor,
} from '../../../packages/shared/src/missions';
import { useUI } from './store';
import { CHANOLY_LOGO } from './Perk';
const PERK_KEY = 'kibre-lunch-perk-dismissed';
/** Lunch gathering perk shown on the levels screen. Declining just hides it; play continues. */
function LunchPerk({ onJoin }: { onJoin: () => void }) {
  const [hidden, setHidden] = React.useState(() => {
    try {
      return localStorage.getItem(PERK_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  return (
    <aside className="lunch-perk" role="complementary" aria-label="Royal Lunch Perk">
      <div className="lunch-perk-badge" aria-hidden>
        <b>40%</b>
        <small>LUNCH</small>
      </div>
      <div>
        <img src={CHANOLY_LOGO} alt="Chanoly Noodle" className="chanoly-logo" />
        <span className="eyebrow">ROYAL LUNCH PERK · CHANOLY NOODLES</span>
        <h2>Feast with your squad, fight in gold.</h2>
        <p>
          Meet your three squadmates for lunch and submit a group selfie while you eat.{' '}
          <b>40% of the lunch is covered</b> (Chanoly noodles for now) and every member unlocks the
          free <b>Royal Feast armor</b>.
        </p>
        <small className="lunch-perk-terms">
          Prototype offer, terms apply. Verified accounts only. The selfie stays private to your
          squad and needs everyone’s consent.
        </small>
      </div>
      <div className="lunch-perk-actions">
        <button className="gold-btn" onClick={onJoin}>
          JOIN THE FEAST <span>→</span>
        </button>
        <button
          className="outline-btn"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(PERK_KEY, '1');
            } catch {
              /* Hidden for this visit only. */
            }
          }}
        >
          NOT NOW
        </button>
      </div>
    </aside>
  );
}
export function CampaignScreen({
  onMission,
  onTraining,
  onSquad,
  busy,
}: {
  onMission: (id: number) => void;
  onTraining: () => void;
  onSquad: () => void;
  busy: boolean;
}) {
  const { session, me } = useUI();
  if (!session)
    return (
      <div className="center-page">
        <h1>Your legend awaits.</h1>
        <p>Enter the kingdom to begin your campaign.</p>
      </div>
    );
  const demo = !!session.profile.demo,
    p = me?.campaign ?? freshCampaign(),
    next = nextMission(p, demo),
    order = demo ? DEMO_MISSIONS : MISSIONS.map((m) => m.id),
    completed = p.completed.length,
    needsGathering =
      order.filter((id) => id < 11).every((id) => p.completed.includes(id)) && !p.fellowship;
  return (
    <section className="content-page campaign-page">
      <div className="section-title">
        <div>
          <span className="eyebrow">
            THE ROYAL CHRONICLES ·{' '}
            {demo ? 'STORY DEMO · ~8–12 MIN' : '15 STORY TRIALS · ~45–60 MIN'}
          </span>
          <h1>The road to the Eclipse Crown.</h1>
        </div>
        <span className="demo-tag">
          {rankFor(completed)} · {completed}/{order.length} TRIALS
        </span>
      </div>
      <div className="campaign-intro">
        <div>
          <h2>Honor is more than victory.</h2>
          <p>
            Ride the highlands. Protect the vulnerable. Read the old inscriptions. Stand together
            when the crown awakens.
          </p>
          <span className="eyebrow">{p.honor} HONOR · PROGRESS SAVED AFTER EACH MISSION</span>
        </div>
        <div className="campaign-tools">
          <button className="outline-btn" disabled={busy} onClick={onTraining}>
            {me?.profile?.progress.tutorial ? 'REVISIT TRAINING' : 'BEGIN TRAINING'}
          </button>
          <button className="outline-btn" disabled={busy} onClick={onSquad}>
            SQUAD & ROYAL GATHERING →
          </button>
        </div>
      </div>
      {!p.fellowship && <LunchPerk onJoin={onSquad} />}
      {needsGathering && (
        <div className="gathering-callout">
          <span>♧</span>
          <div>
            <h2>The royal table awaits.</h2>
            <p>
              {demo
                ? 'Demonstrate fellowship with clearly labeled simulated squad approvals.'
                : 'Four qualified, authenticated teammates must approve the Royal Gathering before entering the citadel.'}
            </p>
          </div>
          <button className="gold-btn" onClick={onSquad}>
            OPEN THE LUNCH PASS →
          </button>
        </div>
      )}
      {[1, 2, 3].map((chapter) => (
        <section className="campaign-chapter" key={chapter}>
          <div className="chapter-heading">
            <span>0{chapter}</span>
            <div>
              <h2>{['The Warrior’s Trial', 'The Four Banners', 'The Lost Crown'][chapter - 1]}</h2>
              <p>
                {
                  [
                    'Skill, horsemanship, and the first oath.',
                    'Protection, teamwork, and fellowship.',
                    'Mysteries, monsters, and the final crown.',
                  ][chapter - 1]
                }
              </p>
            </div>
          </div>
          <div className="mission-grid">
            {MISSIONS.filter((m) => m.chapter === chapter && order.includes(m.id)).map((m) => {
              const done = p.completed.includes(m.id),
                blocked = missionEligibility(p, m.id, demo),
                current = next === m.id;
              return (
                <article
                  key={m.id}
                  className={
                    'mission-card biome-' +
                    m.biome +
                    (done ? ' cleared' : '') +
                    (current ? ' current' : '')
                  }
                >
                  <div className="mission-illustration">
                    <span>
                      {m.mounted
                        ? '♞'
                        : ['symbols', 'mirrors', 'landmarks', 'beacons'].includes(m.kind)
                          ? '✧'
                          : ['guardian', 'throne'].includes(m.kind)
                            ? '♛'
                            : m.kind === 'rescue' || m.kind === 'outpost'
                              ? '♧'
                              : '⚑'}
                    </span>
                    <b>{String(m.id).padStart(2, '0')}</b>
                  </div>
                  <div className="mission-info">
                    <span className="eyebrow">
                      {done
                        ? '✓ OATH FULFILLED'
                        : m.mounted
                          ? 'MOUNTED TRIAL'
                          : m.kind.toUpperCase()}{' '}
                      · {demo ? 'DEMO' : `~${m.minutes} MIN`}
                    </span>
                    <h3>{m.name}</h3>
                    <p>{m.guide}</p>
                    <button
                      className={current && !blocked ? 'gold-btn' : 'outline-btn'}
                      disabled={busy || !!blocked}
                      title={blocked ?? ''}
                      onClick={() => onMission(m.id)}
                    >
                      {done ? 'REPLAY TRIAL' : blocked ? 'LOCKED' : 'BEGIN TRIAL'} <span>→</span>
                    </button>
                    {blocked && current && <small>{blocked}</small>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      <p className="campaign-note">
        Aksumara is fictional. Regional settings and military titles draw inspiration from Ethiopian
        heritage. Campaign victories are separate from competitive arena ratings.
      </p>
    </section>
  );
}
