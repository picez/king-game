import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight wiring guard (no jsdom in this project): assert at the source level
// that the room-social overlay is mounted at the ONLINE level for every in-room
// state and is NEVER mounted in local pass-and-play. This catches a regression
// where chat/reactions silently stop appearing during the actual game.
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('room-social wiring', () => {
  const online = read('./OnlineGame.tsx');
  const local = read('../LocalGame.tsx');

  it('OnlineGame imports + renders the RoomSocial overlay', () => {
    expect(online).toContain("import RoomSocial from './RoomSocial'");
    expect(online).toMatch(/renderSocial\s*=\s*\(/); // a single overlay factory
  });

  it('renders social in EVERY in-room branch (lobby, dealing, game)', () => {
    // Three render sites: lobby, the "dealing" wait, and the in-game view.
    const calls = online.match(/renderSocial\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('lifts the controls above the hand on the playing screen', () => {
    expect(online).toContain("renderSocial(status === 'playing'");
  });

  it('LocalGame does NOT render the room-social overlay (online-only)', () => {
    expect(local).not.toContain('RoomSocial');
  });
});

describe('active-game "Leave game" wiring', () => {
  const online = read('./OnlineGame.tsx');
  const social = read('./RoomSocial.tsx');

  it('uses backToMenu (keeps Resume), NOT leave (removes member)', () => {
    expect(online).toMatch(/leaveGameToMenu\s*=\s*\(\)\s*=>\s*\{\s*net\.backToMenu\(\);\s*onExit\(\);/);
  });

  it('passes Leave game to the overlay during the game + dealing, but NOT the lobby', () => {
    expect(online).toContain('renderSocial(false, leaveGameToMenu)');               // dealing
    expect(online).toContain("renderSocial(status === 'playing', leaveGameToMenu)"); // in-game
    expect(online).toMatch(/renderSocial\(false\)\}/);                               // lobby: no leave arg
  });

  it('RoomSocial shows the Leave game action only when onLeaveGame is provided', () => {
    expect(social).toContain('onLeaveGame');
    expect(social).toContain('social-leave');
    expect(social).toContain("t('online.leaveGame')");
    expect(social).toMatch(/\{onLeaveGame && \(/);  // gated on the prop (active game only)
  });
});

describe('chat media stickers wiring (Stage 11.0)', () => {
  const online = read('./OnlineGame.tsx');
  const social = read('./RoomSocial.tsx');

  it('OnlineGame passes the sendChatMedia sender into the overlay', () => {
    expect(online).toContain('onChatMedia={net.sendChatMedia}');
  });

  it('RoomSocial renders a whitelist picker from the catalog (no raw user URL)', () => {
    // Sticker sources come ONLY from the generated catalog, never client input.
    expect(social).toContain("from '../../net/chatMediaCatalog'");
    expect(social).toContain('CHAT_MEDIA');
    expect(social).toContain('chat-media-picker');
    // A click sends by catalog id (mediaId), not a URL.
    expect(social).toContain('onChatMedia(item.id)');
    // Sticker <img> src is bound to the catalog item, not a free-text field.
    expect(social).toContain('src={item.src}');
    expect(social).toContain('src={m.media.src}');
    // No arbitrary-URL/data:/http input path in the overlay source.
    expect(social).not.toMatch(/src=\{[^}]*text[^}]*\}/);
  });

  it('media message is rendered as an <img>, not injected as HTML', () => {
    expect(social).not.toContain('dangerouslySetInnerHTML');
    expect(social).toContain('alt={m.media.label}');
  });

  it('the smiley/reaction picker also offers the whitelist stickers (Stage 11.1)', () => {
    // The 😀 reaction picker gets a sticker grid alongside the emoji reactions.
    expect(social).toContain('reaction-bar__emojis');
    expect(social).toContain('reaction-bar__stickers');
    // Stickers in the reaction picker send via the same whitelist id path.
    expect(social).toMatch(/reaction-bar__stickers[^]*CHAT_MEDIA\.map/);
    expect(social).toMatch(/reaction-bar__stickers[^]*onClick=\{\(\) => sendMedia\(item\)\}/);
    // sendMedia goes through onChatMedia (id), never a raw URL.
    expect(social).toMatch(/function sendMedia[^]*onChatMedia\(item\.id\)/);
  });

  it('a media chat message can float transiently on the table (no new protocol)', () => {
    expect(social).toContain('reaction-chip--sticker');
    expect(social).toContain('src={f.media.src}');
    // The float is derived from the existing CHAT payload, not a new send.
    expect(social).toContain('setFloats');
  });

  it('the reaction picker labels its Emoji and Stickers sections (Stage 11.2)', () => {
    expect(social).toContain('reaction-bar__heading');
    expect(social).toContain("t('social.emoji')");
    expect(social).toContain("t('chat.mediaPicker')");  // stickers section heading
    expect(social).toContain('reaction-bar__emojis');
    expect(social).toContain('reaction-bar__stickers');
  });
});
