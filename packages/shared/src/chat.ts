export interface TeamMember {
  id: string;
  name: string;
}
export interface TeamMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  at: number;
}
export interface TeamPresence {
  members: TeamMember[];
  online: TeamMember[];
}
export type ChatAck = { ok: true; message: TeamMessage } | { ok: false; error: string };
export interface ChatServerEvents {
  'chat:history': (messages: TeamMessage[]) => void;
  'chat:message': (message: TeamMessage) => void;
  'chat:members': (presence: TeamPresence) => void;
  'chat:error': (message: string) => void;
}
export interface ChatClientEvents {
  'chat:send': (data: { clientId: string; text: string }, ack: (reply: ChatAck) => void) => void;
}
