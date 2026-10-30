import React, { useEffect, useRef, useState } from 'react';
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
    // Starts closed as a bubble so it never covers page buttons; the player opens it.
    [open, setOpen] = useState(false),
    [unread, setUnread] = useState(0),
    [error, setError] = useState('');
  const socket = useRef<Socket<ChatServerEvents, ChatClientEvents> | null>(null),
    log = useRef<HTMLDivElement>(null),
    draft = useRef<{ id: string; text: string } | null>(null),
    callbacks = useRef({ onRoster, onMembershipChanged }),
    isOpen = useRef(open);
  callbacks.current = { onRoster, onMembershipChanged };
  // The chat is hidden while a match is running; messages that arrive then count as unread.
  const inBattle = page === 'battle';
  isOpen.current = open && !inBattle;
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
  if (inBattle) return null;
  function send(e: React.FormEvent) {
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
            setError('Message was not acknowledged. Reconnect and retry; your draft is kept.');
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
  }
  return createPortal(
    <div className="team-chat" data-chat-controls>
      {open && (
        <section className="team-chat-window" role="dialog" aria-label="Team chat">
          <div className="team-chat-head">
            <span className="team-chat-avatar" aria-hidden>
              ⚔
            </span>
            <div>
              <strong>{squad.name}</strong>
              <small className={connected ? 'online' : ''}>
                {connected
                  ? online.length
                    ? online.map((p) => p.name).join(' · ')
                    : 'Online'
                  : 'Connecting…'}
              </small>
            </div>
            <button aria-label="Close team chat" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div
            ref={log}
            className="team-chat-log"
            role="log"
            aria-label="Team messages"
            aria-live="polite"
            aria-relevant="additions"
          >
            <p className="team-chat-hint">
              Private to your team · invite code <b>{squad.code}</b>
            </p>
            {!messages.length && (
              <p className="team-chat-hint">No messages yet. Invite a teammate and say hello.</p>
            )}
            {messages.map((message) => {
              const mine = message.playerId === session.profile.id;
              return (
                <div key={message.id} className={'team-chat-bubble' + (mine ? ' mine' : '')}>
                  {!mine && <strong>{message.name}</strong>}
                  <p>{message.text}</p>
                  <time>
                    {new Date(message.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              );
            })}
          </div>
          {error && (
            <p className="team-chat-error" role="alert">
              {error}{' '}
              {!connected && <button onClick={() => socket.current?.connect()}>Reconnect</button>}
            </p>
          )}
          <form onSubmit={send}>
            <input
              aria-label="Message your team"
              value={text}
              maxLength={500}
              placeholder={connected ? 'Message your team…' : 'Connecting…'}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.currentTarget.blur();
                  e.stopPropagation();
                }
              }}
            />
            <button aria-label="Send" disabled={!connected || pending || !text.trim()}>
              {pending ? '…' : '➤'}
            </button>
          </form>
        </section>
      )}
      <button
        className={'team-chat-launcher' + (open ? ' open' : '')}
        aria-label={open ? 'Close team chat' : 'Open team chat'}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setUnread(0);
        }}
      >
        {open ? (
          '×'
        ) : (
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
            <path
              fill="currentColor"
              d="M12 3C6.5 3 2 6.6 2 11c0 2.4 1.3 4.5 3.4 6L4.6 21l4.3-2.3c1 .2 2 .3 3.1.3 5.5 0 10-3.6 10-8S17.5 3 12 3Z"
            />
          </svg>
        )}
        {!open && unread > 0 && <span className="team-chat-unread">{unread}</span>}
      </button>
    </div>,
    document.body,
  );
}
