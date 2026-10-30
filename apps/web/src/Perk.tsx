import React from 'react';
import { useUI } from './store';

export const CHANOLY_LOGO = '/assets/chanoly-logo.png';

/** Asks an unverified player to scan their Fayda ID. Shown on forming a squad and after a duel. */
export function VerifyPrompt({
  reason,
  onVerify,
  onClose,
}: {
  reason: 'squad' | 'duel';
  onVerify: () => void;
  onClose: () => void;
}) {
  const demo = useUI((s) => !!s.session?.profile.demo);
  return (
    <div className="modal-overlay verify-overlay" role="dialog" aria-label="Verify your identity">
      <div className="verify-card">
        <span className="crest" aria-hidden>
          ◇
        </span>
        <span className="eyebrow">
          {reason === 'squad' ? 'YOUR SQUAD IS FORMING' : 'DUEL COMPLETE'}
        </span>
        <h2>Verify your identity</h2>
        <p>
          Scan or upload your Fayda national ID. A reviewer confirms your age and you are notified
          of your eligibility. Verified warriors unlock adult matchmaking, the{' '}
          <b>Chanoly lunch perk</b> and reward armor. Until then you keep playing as a guest.
        </p>
        {demo && (
          <p className="subtle">
            Story Demo warriors cannot verify. Enter the kingdom with a normal account to submit
            your ID.
          </p>
        )}
        <div className="panel-actions">
          <button className="gold-btn" onClick={onVerify}>
            VERIFY MY IDENTITY <span>→</span>
          </button>
          <button className="outline-btn" onClick={onClose}>
            LATER
          </button>
        </div>
      </div>
    </div>
  );
}

/** The selfie step of the lunch perk; the upload itself is the squad gathering panel. */
export function LunchSelfie({
  verified,
  demo,
  onVerify,
  onDemo,
  children,
}: {
  verified: boolean;
  demo: boolean;
  onVerify: () => void;
  onDemo: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="lunch-selfie" aria-label="Submit your lunch selfie">
      <div className="lunch-selfie-head">
        <img src={CHANOLY_LOGO} alt="Chanoly Noodle" className="chanoly-logo" />
        <div>
          <span className="eyebrow">SUBMIT YOUR LUNCH SELFIE</span>
          <p>
            Take one group photo of all four squadmates eating together. Each member confirms their
            participation; then the perk and Royal Feast armor are unlocked.
          </p>
        </div>
      </div>
      {demo ? (
        <div className="lunch-selfie-locked">
          <p>Story Demo: the gathering is simulated and the perk is not paid out.</p>
          <button className="outline-btn" onClick={onDemo}>
            OPEN DEMO GATHERING →
          </button>
        </div>
      ) : verified ? (
        children
      ) : (
        <div className="lunch-selfie-locked">
          <p>🔒 Perks are only given to verified accounts. Verify your identity to submit.</p>
          <button className="gold-btn" onClick={onVerify}>
            VERIFY MY IDENTITY <span>→</span>
          </button>
        </div>
      )}
    </section>
  );
}
