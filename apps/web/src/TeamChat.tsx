import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { io, type Socket } from 'socket.io-client';
import { connection, useUI } from './store';
import './team-chat.css';
import type {
  ChatAck,
  ChatClientEvents,
  ChatServerEvents,
  TeamMember,
  TeamMessage,
} from '../../../packages/shared/src/chat';

export function TeamChat({
  squad,
  page,
  onRoster,
  onMembershipChanged,
}: {
  squad: { id: string; name: string; code: string };
  page: string;
  onRoster: (members: TeamMember[]) => void;
  onMembershipChanged: () => void;
}) {
  const session = useUI((s) => s.session)!;
  const [messages, setMessages] = useState<TeamMessage[]>([]),
    [online, setOnline] = useState<TeamMember[]>([]),
    [text, setText] = useState(''),
    [connected, setConnected] = useState(false),
    [pending, setPending] = useState(false),
    [open, setOpen] = useState(page === 'squad'),
    [unread, setUnread] = useState(0),
    [error, setError] = useState(''),
    [target, setTarget] = useState<HTMLElement | null>(null);
  const socket = useRef<Socket<ChatServerEvents, ChatClientEvents> | null>(null),
    log = useRef<HTMLDivElement>(null),
    draft = useRef<{ id: string; text: string } | null>(null),
    callbacks = useRef({ onRoster, onMembershipChanged }),
    isOpen = useRef(open);
  callbacks.current = { onRoster, onMembershipChanged };
  isOpen.current = open;
  useLayoutEffect(() => {
    setTarget(
      document.getElementById('team-chat-slot') ??
        document.querySelector<HTMLElement>('.battle-layout') ??
        document.body,
    );
    if (page === 'squad') {
      setOpen(true);
      setUnread(0);
    }
  }, [page]);
  useEffect(() => {
    let cancelled = false;
    const s = io(connection().ws.replace(/^ws/, 'http'), {
      auth: { token: session.token, squadId: squad.id },
      autoConnect: false,
    });
    socket.current = s;
    setConnected(false);
    setMessages([]);
    setOnline([]);
    setUnread(0);
    setError('');
    s.on('connect', () => {
      setConnected(true);
      setError('');
    });
    s.on('disconnect', () => {
      setConnected(false);
      setOnline([]);
    });
    s.on('connect_error', (e) => {
      setConnected(false);
      setError(e.message);
    });
    s.on('chat:history', setMessages);
    s.on('chat:members', (state) => {
      setOnline(state.online);
      callbacks.current.onRoster(state.members);
    });
    s.on('chat:message', (message) => {
      setMessages((old) =>
        old.some((m) => m.id === message.id) ? old : [...old.slice(-99), message],
      );
      if (!isOpen.current && message.playerId !== session.profile.id) setUnread((n) => n + 1);
    });
    s.on('chat:error', (message) => {
      setError(message);
      if (!cancelled) callbacks.current.onMembershipChanged();
    });
    s.connect();
    return () => {
      cancelled = true;
      s.removeAllListeners();
      s.disconnect();
      socket.current = null;
    };
  }, [squad.id, session.token]);
  useEffect(() => {
    if (log.current && open) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, open]);
  if (!target) return null;
  return createPortal(
    <aside
      className={
        'team-chat-panel ' + (page === 'squad' ? 'team-chat-inline' : 'team-chat-floating')
      }
      aria-label="Team text room"
      data-chat-controls
    >
      <button
        className="team-chat-heading"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setUnread(0);
        }}
      >
        <span>
          TEAM CHAT {unread > 0 ? `(${unread} NEW)` : ''}
          <small>{connected ? `${online.length} ONLINE` : 'DISCONNECTED / CONNECTING'}</small>
        </span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="team-chat-body">
          <p>
            <strong>{squad.name}</strong> · Room code <b>{squad.code}</b>
          </p>
          <p className="subtle">
            Only your team can read this room. Chat stays available during battle.
          </p>
          <p className="team-chat-presence">
            {online.length ? online.map((p) => p.name).join(' · ') : 'No teammates connected yet.'}
          </p>
          <div
            ref={log}
            className="team-chat-messages"
            role="log"
            aria-label="Team messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            {!messages.length && (
              <p className="subtle">No messages yet. Invite a teammate and say hello.</p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.playerId === session.profile.id ? 'my-message' : ''}
              >
                <p>
                  <strong>{message.name}</strong>{' '}
                  <time>
                    {new Date(message.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </p>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!connected || pending || !text.trim() || !socket.current) return;
              const content = text.trim();
              if (!draft.current || draft.current.text !== content)
                draft.current = { id: crypto.randomUUID(), text: content };
              setPending(true);
              setError('');
              socket.current
                .timeout(5000)
                .emit(
                  'chat:send',
                  { clientId: draft.current.id, text: content },
                  (failure: Error | null, reply: ChatAck) => {
                    setPending(false);
                    if (failure) {
                      setError(
                        'Message was not acknowledged. Reconnect and retry; your draft is kept.',
                      );
                      return;
                    }
                    if (!reply.ok) {
                      setError(reply.error);
                      return;
                    }
                    draft.current = null;
                    setText((current) => (current.trim() === content ? '' : current));
                  },
                );
            }}
          >
            <label htmlFor="team-message">Message your team</label>
            <div>
              <input
                id="team-message"
                value={text}
                maxLength={500}
                placeholder="Type a message…"
                autoComplete="off"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.currentTarget.blur();
                    e.stopPropagation();
                  }
                }}
              />
              <button className="outline-btn" disabled={!connected || pending || !text.trim()}>
                {pending ? 'SENDING…' : 'SEND'}
              </button>
            </div>
          </form>
          {error && <p role="alert">{error}</p>}
          {!connected && (
            <button className="outline-btn" onClick={() => socket.current?.connect()}>
              RECONNECT CHAT
            </button>
          )}
          {page === 'battle' && (
            <small>
              Controls stop while chat has focus. Click the arena to resume control; the match keeps
              running.
            </small>
          )}
        </div>
      )}
    </aside>,
    target,
  );
}
