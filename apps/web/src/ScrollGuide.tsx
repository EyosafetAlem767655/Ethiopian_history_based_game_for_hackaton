import React, { useEffect, useState } from 'react';
import { useUI } from './store';
import { audio } from './audio';
export function ScrollGuide({
  message,
  id,
  chapter,
}: {
  message: string;
  id: string;
  chapter: string;
}) {
  const reduced = useUI((s) => s.reducedMotion),
    [replay, setReplay] = useState(0),
    [history, setHistory] = useState<string[]>([]),
    [open, setOpen] = useState(false);
  useEffect(() => {
    setHistory((h) => (h.at(-1) === message ? h : [...h.slice(-9), message]));
    audio.play('scroll');
  }, [id, message]);
  return (
    <div className={'scroll-guide ' + (reduced ? 'reduced-motion' : '')}>
      <div className="scroll-paper" key={id + '-' + replay}>
        <div
          className="scroll-insignia guide-illustration"
          aria-hidden="true"
          style={{
            backgroundImage: `url(/assets/${/guardian|throne|crown/i.test(chapter) ? 'monsters' : /riding|wind/i.test(chapter) ? 'heads' : 'scenery'}.png)`,
            backgroundPosition: /guardian|throne|crown|riding|wind/i.test(chapter)
              ? '100% 100%'
              : '0% 0%',
          }}
        />
        <div className="scroll-copy">
          <span className="eyebrow">{chapter}</span>
          <p role="status" aria-live="polite">
            {message}
          </p>
        </div>
        <div className="scroll-embers" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} style={{ '--spark': i } as React.CSSProperties} />
          ))}
        </div>
      </div>
      <div className="scroll-tools">
        <button
          aria-label="Replay guide animation"
          onClick={() => {
            setReplay((r) => r + 1);
            audio.play('scroll');
          }}
        >
          ↻
        </button>
        <button aria-label="Guide history" onClick={() => setOpen((v) => !v)}>
          ☷
        </button>
      </div>
      {open && (
        <div className="scroll-history">
          <h3>The chronicler’s notes</h3>
          {history.map((h, i) => (
            <p key={i}>{h}</p>
          ))}
          <button className="outline-btn" onClick={() => setOpen(false)}>
            RETURN TO THE FIELD
          </button>
        </div>
      )}
    </div>
  );
}
