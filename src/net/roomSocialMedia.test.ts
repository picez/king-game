// Server-side chat-media handler (Stage 11.0). Verifies the whitelist gate: a
// client sends only a `mediaId`; the server resolves it against chatMediaCatalog
// and broadcasts the SERVER-approved media — never a client-supplied src/url.
import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { RoomSocialStore, handleChatMedia, type SocialIO } from '../../server/roomSocial';
import type { ServerRoom } from './serverCore';
import type { ServerMessage } from './messages';
import { CHAT_MEDIA } from './chatMediaCatalog';

const VALID_ID = CHAT_MEDIA[0].id;
const VALID = CHAT_MEDIA[0];

function makeIO() {
  const errors: Array<{ code: string; message: string }> = [];
  const broadcasts: ServerMessage[] = [];
  let n = 0;
  const io: SocialIO = {
    sendError: (_s, code, message) => { errors.push({ code, message }); },
    broadcastToRoom: (_r, msg) => { broadcasts.push(msg); },
    newId: () => `m${++n}`,
  };
  return { io, errors, broadcasts };
}

const fakeSocket = {} as WebSocket;

function makeRoom(): ServerRoom {
  return {
    code: 'ROOM',
    members: new Map([['c1', { name: 'Alice', avatar: '🦊', seatIndex: 0 }]]),
  } as unknown as ServerRoom;
}

describe('handleChatMedia — whitelist sticker chat', () => {
  it('broadcasts a CHAT with the server-approved media for a valid id (empty text)', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'c1', VALID_ID);

    expect(errors).toHaveLength(0);
    expect(broadcasts).toHaveLength(1);
    const b = broadcasts[0];
    expect(b.t).toBe('CHAT');
    if (b.t !== 'CHAT') return;
    expect(b.message.text).toBe('');
    expect(b.message.media).toEqual(VALID);            // exactly the catalog entry
    expect(b.message.media!.src.startsWith('/chat-media/')).toBe(true);
    expect(b.message.name).toBe('Alice');
  });

  it('rejects an unknown media id (MESSAGE_BLOCKED, no broadcast)', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'c1', 'not-a-real-id');
    expect(broadcasts).toHaveLength(0);
    expect(errors[0]?.code).toBe('MESSAGE_BLOCKED');
  });

  it('ignores a client-supplied src/url object — only a whitelisted string id is honoured', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    // A malicious client trying to inject an arbitrary src is not a valid mediaId.
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'c1', { src: 'https://evil.example/x.gif' } as unknown);
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'c1', 'https://evil.example/x.gif');
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'c1', 'javascript:alert(1)');
    expect(broadcasts).toHaveLength(0);
    expect(errors.every((e) => e.code === 'MESSAGE_BLOCKED')).toBe(true);
  });

  it('applies the 3s chat rate limit (second sticker rejected)', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    const room = makeRoom();
    handleChatMedia(store, io, fakeSocket, room, 'c1', VALID_ID); // accepted, sets chatAt
    handleChatMedia(store, io, fakeSocket, room, 'c1', VALID_ID); // within 3s → rate limited
    expect(broadcasts).toHaveLength(1);
    expect(errors[0]?.code).toBe('RATE_LIMITED');
  });

  it('appends the media message to the room chat history (ring buffer)', () => {
    const store = new RoomSocialStore();
    const { io } = makeIO();
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'c1', VALID_ID);
    const history = store.history('ROOM');
    expect(history).toHaveLength(1);
    expect(history[0].media).toEqual(VALID);
    expect(history[0].text).toBe('');
  });

  it('never leaks a userId/token in the broadcast payload', () => {
    const store = new RoomSocialStore();
    const { io, broadcasts } = makeIO();
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'c1', VALID_ID);
    const json = JSON.stringify(broadcasts[0]);
    expect(json).not.toMatch(/userId|reconnectToken|token|password/i);
  });

  it('refuses a sender not in the room', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChatMedia(store, io, fakeSocket, makeRoom(), 'ghost', VALID_ID);
    expect(broadcasts).toHaveLength(0);
    expect(errors[0]?.code).toBe('BAD_MESSAGE');
  });
});
