import React, { useEffect, useRef, useState } from 'react';

/** The header profile chip: opens a menu with profile, likeness, friends and identity verification. */
export function ProfileMenu({
  children,
  verified,
  onNavigate,
}: {
  children: React.ReactNode;
  verified: boolean;
  onNavigate: (page: string) => void;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const items: [string, string, string][] = [
    ['profile', '◈', 'Profile & legacy'],
    ['personalize', '◉', 'Your likeness & armor'],
    ['friends', '☺', 'Friends'],
    ['age', '◇', verified ? 'Identity verified ✓' : 'Verify your identity'],
    ['identity', '✉', 'Account sign-in'],
  ];
  return (
    <div className="profile-menu" ref={root}>
      <button
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
        <span className="profile-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="profile-dropdown" role="menu">
          {items.map(([id, icon, label]) => (
            <button
              key={id}
              role="menuitem"
              className={id === 'age' && !verified ? 'highlight' : ''}
              onClick={() => {
                setOpen(false);
                onNavigate(id);
              }}
            >
              <span aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
