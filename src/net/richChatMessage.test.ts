// ---------------------------------------------------------------------------
// Stage 38.0.16 Scope B — ONE message may carry text AND an animated sticker.
//
// The RED this replaces: the model always allowed `ChatMessage.text` + `.media` together,
// but no transport could ever produce both. `SEND_CHAT` carried text alone and
// `SEND_CHAT_MEDIA` hard-coded `text: ''`, so attaching a GIF to a typed line either sent
// the GIF as its own message or dropped the text. Asserted below by construction: the
// media-only handler still writes an empty text, and the combined path is what pairs them.
//
// The contract:
//   * text-only, media-only and text+media all produce exactly ONE broadcast, ONE id and
//     ONE history entry, and consume ONE rate-limit slot;
//   * media is resolved from the CATALOG by id — never a client-supplied src/url/markup;
//   * an unknown id blocks the whole message (the text is not posted without its sticker);
//   * a message with neither text nor media is refused;
//   * the profanity/URL filter and MAX_CHAT_LEN still apply to the text half;
//   * history (what a reconnecting client replays) keeps the combined shape.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import type { WebSocket } from 'ws';
import { RoomSocialStore, handleChat, handleChatMedia, type SocialIO } from '../../server/roomSocial';
import type { ServerRoom } from './serverCore';
import type { ServerMessage } from './messages';
import { CHAT_MEDIA } from './chatMediaCatalog';
import { MAX_CHAT_LEN } from './chatFilter';

const A = CHAT_MEDIA[0];
const B = CHAT_MEDIA[1];
const fakeSocket = {} as WebSocket;

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
function makeRoom(): ServerRoom {
  return {
    code: 'ROOM',
    members: new Map([['c1', { name: 'Alice', avatar: '🦊', seatIndex: 2 }]]),
  } as unknown as ServerRoom;
}
const chats = (bs: ServerMessage[]) => bs.filter((b) => b.t === 'CHAT') as Extract<ServerMessage, { t: 'CHAT' }>[];

describe('combined text + sticker is ONE message', () => {
  it('text + mediaId → one broadcast carrying both', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChat(store, io, fakeSocket, makeRoom(), 'c1', 'привіт', A.id);

    expect(errors).toHaveLength(0);
    expect(broadcasts).toHaveLength(1);
    const m = chats(broadcasts)[0].message;
    expect(m.text).toBe('привіт');
    expect(m.media).toEqual({ id: A.id, src: A.src, type: A.type, label: A.label });
    expect(m.seatIndex).toBe(2);          // the sender's SEAT rides along, as before
    expect(m.name).toBe('Alice');
  });

  it('one id, one history entry, one rate-limit slot — never two messages', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    const room = makeRoom();
    handleChat(store, io, fakeSocket, room, 'c1', 'one', A.id);
    expect(broadcasts).toHaveLength(1);
    const first = chats(broadcasts)[0].message;
    expect(first.id).toBe('m1');
    expect(store.for('ROOM').history).toHaveLength(1);
    expect(store.for('ROOM').history[0].id).toBe('m1');
    expect(store.for('ROOM').history[0].media?.id).toBe(A.id);
    // The combined send consumed the SAME single 3s slot a plain line would have.
    handleChat(store, io, fakeSocket, room, 'c1', 'too soon', A.id);
    expect(errors.at(-1)?.code).toBe('RATE_LIMITED');
    expect(broadcasts).toHaveLength(1);
  });

  it('text-only and media-only still behave exactly as before', () => {
    const store = new RoomSocialStore();
    const { io, broadcasts } = makeIO();
    handleChat(store, io, fakeSocket, makeRoom(), 'c1', 'just text');
    const textOnly = chats(broadcasts)[0].message;
    expect(textOnly.text).toBe('just text');
    expect(textOnly.media).toBeUndefined();

    const store2 = new RoomSocialStore();
    const io2 = makeIO();
    handleChatMedia(store2, io2.io, fakeSocket, makeRoom(), 'c1', B.id);
    const mediaOnly = chats(io2.broadcasts)[0].message;
    expect(mediaOnly.text).toBe('');
    expect(mediaOnly.media?.id).toBe(B.id);
  });
});

describe('the combined path is still whitelist-only and still filtered', () => {
  it('an unknown media id blocks the WHOLE message — the text is not posted alone', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChat(store, io, fakeSocket, makeRoom(), 'c1', 'ship it', 'not-a-real-id');
    expect(broadcasts).toHaveLength(0);
    expect(errors[0]?.code).toBe('MESSAGE_BLOCKED');
    expect(store.for('ROOM').history).toHaveLength(0);
  });

  it('a client-supplied src/url object is never honoured', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChat(store, io, fakeSocket, makeRoom(), 'c1', 'hi',
      { id: A.id, src: 'https://evil.example/x.gif' } as unknown as string);
    expect(broadcasts).toHaveLength(0);
    expect(errors[0]?.code).toBe('MESSAGE_BLOCKED');
  });

  it('the text half of a combined message goes through the filter and the length cap', () => {
    const store = new RoomSocialStore();
    const { io, broadcasts } = makeIO();
    handleChat(store, io, fakeSocket, makeRoom(), 'c1', 'x'.repeat(MAX_CHAT_LEN + 50), A.id);
    const m = chats(broadcasts)[0].message;
    expect(m.text.length).toBeLessThanOrEqual(MAX_CHAT_LEN);
    expect(m.media?.id).toBe(A.id);

    // The URL rule is unchanged by this stage: a link is CENSORED in place, not blocked,
    // and the attached sticker rides along with the censored line — still one message.
    const store2 = new RoomSocialStore();
    const io2 = makeIO();
    handleChat(store2, io2.io, fakeSocket, makeRoom(), 'c1', 'visit http://spam.example', A.id);
    expect(io2.broadcasts).toHaveLength(1);
    const censored = chats(io2.broadcasts)[0].message;
    expect(censored.text).toContain('[link]');
    expect(censored.text).not.toContain('spam.example');
    expect(censored.media?.id).toBe(A.id);
  });

  it('a message with neither text nor media is refused', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChat(store, io, fakeSocket, makeRoom(), 'c1', '   ');
    expect(broadcasts).toHaveLength(0);
    expect(errors[0]?.code).toBe('BAD_MESSAGE');
  });

  it('a sticker with an empty line is allowed — the sticker IS the message', () => {
    const store = new RoomSocialStore();
    const { io, errors, broadcasts } = makeIO();
    handleChat(store, io, fakeSocket, makeRoom(), 'c1', '', A.id);
    expect(errors).toHaveLength(0);
    const m = chats(broadcasts)[0].message;
    expect(m.text).toBe('');
    expect(m.media?.id).toBe(A.id);
  });
});

describe('the composer and the bubble', () => {
  const src = readSource('src/ui/online/RoomSocial.tsx');

  it('a sticker ATTACHES to a draft instead of sending, and replaces the previous one', () => {
    expect(src).toContain('const [attachment, setAttachment] = useState<ChatMediaItem | null>(null);');
    // Draft present (typing OR text already written) → attach; otherwise the old one-tap send.
    expect(src).toMatch(/if \(intentRef\.current \?\? \(isTyping\(\) \|\| text\.trim\(\)\.length > 0\)\) \{[^]*?setAttachment\(item\);/);
    expect(src).toMatch(/setAttachment\(item\);[^]*?return;/);
    expect(src).toMatch(/onChatMedia\(item\.id\);/);
  });

  it('ONE submit sends ONE message and clears both halves', () => {
    expect(src).toMatch(/onChat\(v, attachment\?\.id\);\s*setText\(''\);\s*setAttachment\(null\);/);
    expect(src).toMatch(/if \(!v && !attachment\) return;/);
    // Send is live when EITHER half is present.
    expect(src).toMatch(/disabled=\{!text\.trim\(\) && !attachment\}/);
  });

  it('the pending attachment is previewed with a remove control', () => {
    expect(src).toContain('chat-attach__img');
    expect(src).toMatch(/onClick=\{\(\) => \{ setAttachment\(null\); inputRef\.current\?\.focus\(\); \}\}/);
    expect(src).toContain("t('chat.removeAttachment')");
    for (const lang of ['en', 'uk', 'de', 'ar']) {
      const dict = readSource(`src/i18n/dictionaries/${lang}.ts`);
      expect(dict, lang).toContain("'chat.attached'");
      expect(dict, lang).toContain("'chat.removeAttachment'");
    }
  });

  it('one bubble renders whatever the message has — text, media, or both', () => {
    expect(src).toMatch(/\{m\.text \? <span className="chat-msg__text">\{m\.text\}<\/span> : null\}/);
    expect(src).toMatch(/\{m\.media \? \([^]*?chat-msg__media/);
    const css = readSource('src/styles/social.css');
    expect(css).toMatch(/\.chat-msg__text \+ \.chat-msg__media \{/);
    expect(css).toMatch(/object-fit: contain/);        // never cropped, never stretched
  });

  it('the sticker catalog is untouched', () => {
    expect(CHAT_MEDIA).toHaveLength(253);
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:fs').readFileSync(require('node:path').join(process.cwd(), rel), 'utf8');
}
