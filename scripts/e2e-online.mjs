// ---------------------------------------------------------------------------
// End-to-end online QA — drives a REAL server over WebSocket as 3 players.
//
//   npm run e2e
//
// Covers: protected room create/join, lobby, start, dealer mode choice (Trump),
// kitty exchange, trump select, a valid play, illegal/out-of-turn rejection,
// sanitized redaction, reconnect, and server-restart restore.
//
// Run with tsx so it can import the shared TS core helpers. Spawns its own
// server on a throwaway port + temp storage file, and tears everything down.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { get } from 'node:http';
import WebSocket from 'ws';
import { getValidCards } from '../src/core/rules';
import { getActingPlayerId } from '../src/core/gameEngine';
import { seatToPlayerId, humanError } from '../src/net/online';
import { getValidBids, getValidPlayableCards } from '../src/games/tarneeb/rules';
import { preferansBotAction } from '../src/games/preferans/ai';
import { CHAT_MEDIA } from '../src/net/chatMediaCatalog';

const PORT = 3990;
const URL = `ws://127.0.0.1:${PORT}/ws`;   // WS route (same as the client default)
const DATA = '.data-e2e';
const STORE = `${DATA}/rooms.json`;

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ ${msg}`); failures++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Server process management ───────────────────────────────────────────────
function startServer() {
  const child = spawn('npx tsx server/index.ts', {
    shell: true,
    // Fast bot delay + a SHORT disconnected-substitute delay so the substitute
    // scenario resolves quickly (still longer than the reconnect windows above,
    // so other tests' brief disconnects never trigger a substitute).
    env: { ...process.env, PORT: String(PORT), ROOM_STORAGE_FILE: STORE, BOT_DELAY_MS: '40', DISCONNECTED_SUBSTITUTE_DELAY_MS: '800' },
    stdio: 'ignore',
  });
  return child;
}
function killServer(child) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('exit', () => resolve());
    } else {
      child.kill('SIGTERM');
      resolve();
    }
  });
}
function waitForHealth(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      get(`http://127.0.0.1:${PORT}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      }).on('error', retry);
    };
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error('server not healthy')) : setTimeout(tick, 150));
    tick();
  });
}

// ── Tracked client ──────────────────────────────────────────────────────────
function connect() {
  const ws = new WebSocket(URL);
  const c = { ws, clientId: null, token: null, seat: null, room: null, state: null, lastError: null, reactions: [], chats: [] };
  ws.on('message', (m) => {
    const o = JSON.parse(m.toString());
    if (o.t === 'WELCOME') { c.clientId = o.clientId; c.token = o.reconnectToken; c.room = o.room; }
    if (o.t === 'ROOM_UPDATE') c.room = o.room;
    if (o.t === 'STATE_UPDATE') c.state = o.state;
    if (o.t === 'ROOMS_LIST') c.roomsList = o.rooms;
    if (o.t === 'KICKED') c.kicked = o;
    if (o.t === 'REACTION') c.reactions.push(o);
    if (o.t === 'CHAT') c.chats.push(o.message);
    if (o.t === 'CHAT_HISTORY') c.chatHistory = o.messages;
    if (o.t === 'ERROR') c.lastError = o;
    if (c.room && c.clientId) {
      const me = c.room.members.find((x) => x.clientId === c.clientId);
      if (me) c.seat = me.seatIndex;
    }
  });
  return new Promise((resolve) => ws.on('open', () => resolve(c)));
}
const sendMsg = (c, msg) => c.ws.send(JSON.stringify(msg));

let server = null; // module-scoped so the crash handler can tear it down

async function main() {
  rmSync(DATA, { recursive: true, force: true });
  server = startServer();
  await waitForHealth();
  console.log('server up');

  // 1) Host creates a protected room (3p, dealer's choice)
  console.log('\n[1] create protected room + joiners');
  const host = await connect();
  sendMsg(host, { t: 'CREATE_ROOM', name: 'Host', playerCount: 3, modeSelectionType: 'dealer_choice', password: 'secret' });
  await sleep(200);
  const code = host.room.code;
  check(!!code, `room created (code ${code})`);
  check(host.room.hasPassword === true, 'room reports hasPassword');
  check(!JSON.stringify(host.room).includes('secret'), 'snapshot has no plaintext password');

  // 1b) Room discovery list — public summary only, no private data
  console.log('\n[1b] room discovery (LIST_ROOMS)');
  const lister = await connect();
  sendMsg(lister, { t: 'LIST_ROOMS' });
  await sleep(200);
  const listed = (lister.roomsList ?? []).find((r) => r.code === code);
  check(!!listed, 'created room appears in the public list');
  check(listed?.hasPassword === true, 'listed room reports hasPassword');
  check(listed?.status === 'lobby', 'listed room status is lobby');
  check(listed?.hostName === 'Host', 'listed room shows host name');
  check(!JSON.stringify(lister.roomsList).match(/secret|passwordHash|reconnectToken|gameState|dealLog/i),
    'room list leaks no private data');
  lister.ws.close();

  // 2) Joiners — wrong password rejected, correct accepted
  const bad = await connect();
  sendMsg(bad, { t: 'JOIN_ROOM', code, name: 'X', password: 'nope' });
  await sleep(150);
  check(bad.lastError?.code === 'BAD_PASSWORD', 'wrong password rejected');
  bad.ws.close();

  const j1 = await connect();
  sendMsg(j1, { t: 'JOIN_ROOM', code, name: 'Bob', password: 'secret' });
  const j2 = await connect();
  sendMsg(j2, { t: 'JOIN_ROOM', code, name: 'Cara', password: 'secret' });
  await sleep(250);
  check(host.room.members.filter((m) => m.role === 'player').length === 3, 'lobby shows 3 players');

  // 2b) Full room (capacity = catalog max 4) rejects an extra joiner. Uses a
  // SEPARATE room so the main room above stays at 3 for the King gameplay test.
  const fullHost = await connect();
  sendMsg(fullHost, { t: 'CREATE_ROOM', name: 'FullHost', modeSelectionType: 'fixed' });
  await sleep(150);
  const fullCode = fullHost.room.code;
  sendMsg(fullHost, { t: 'ADD_BOT' });
  sendMsg(fullHost, { t: 'ADD_BOT' });
  sendMsg(fullHost, { t: 'ADD_BOT' }); // host + 3 bots = 4/4
  await sleep(250);
  check(fullHost.room.members.filter((m) => m.role === 'player').length === 4, 'King room fills to the catalog max (4)');
  // Stage 13.6: bots get varied " AI" identities, not faceless "Bot N".
  const fullBots = fullHost.room.members.filter((m) => m.type === 'ai');
  check(fullBots.length === 3, 'King room has 3 bots');
  check(fullBots.every((m) => / AI$/.test(m.name) && !/^Bot \d+$/.test(m.name)), 'bots have varied " AI" names (not "Bot N")');
  check(new Set(fullBots.map((m) => m.name)).size === 3, 'bot names are distinct');
  check(new Set(fullBots.map((m) => m.avatar)).size === 3, 'bot avatars are distinct');
  const extra = await connect();
  sendMsg(extra, { t: 'JOIN_ROOM', code: fullCode, name: 'Late' });
  await sleep(150);
  check(extra.lastError?.code === 'ROOM_FULL', `full room → ROOM_FULL ("${humanError(extra.lastError?.code)}")`);
  extra.ws.close();
  fullHost.ws.close();

  // 2k) Host kick in the lobby (self-contained room, before any start)
  console.log('\n[2k] host kicks a lobby member before start');
  const kHost = await connect();
  sendMsg(kHost, { t: 'CREATE_ROOM', name: 'KHost', playerCount: 4, modeSelectionType: 'fixed' });
  await sleep(150);
  const kCode = kHost.room.code;
  const kJoin = await connect();
  sendMsg(kJoin, { t: 'JOIN_ROOM', code: kCode, name: 'Victim' });
  await sleep(200);
  check(kHost.room.members.length === 2, 'kick room has 2 members before kick');
  const victimToken = kJoin.token;
  const victimClientId = kJoin.clientId;

  // non-host cannot kick
  sendMsg(kJoin, { t: 'KICK_MEMBER', clientId: kHost.clientId });
  await sleep(150);
  check(kJoin.lastError?.code === 'NOT_HOST', 'non-host kick rejected (NOT_HOST)');

  // host removes the joiner
  sendMsg(kHost, { t: 'KICK_MEMBER', clientId: victimClientId });
  await sleep(250);
  check(kJoin.kicked?.reason === 'HOST_REMOVED', 'kicked client received KICKED (HOST_REMOVED)');
  check(kHost.room.members.length === 1, 'host lobby updated: victim removed');

  // the kicked client cannot reconnect with the old token
  const kBack = await connect();
  sendMsg(kBack, { t: 'RECONNECT', code: kCode, reconnectToken: victimToken });
  await sleep(200);
  check(kBack.lastError?.code === 'ROOM_NOT_FOUND', 'old reconnect token no longer works after kick');
  kBack.ws.close(); kJoin.ws.close(); kHost.ws.close();

  // 2d) Lobby robustness: NAME_TAKEN, host-leave promotion, room-list joinability
  console.log('\n[2d] lobby robustness (join diagnostics)');
  const dHost = await connect();
  sendMsg(dHost, { t: 'CREATE_ROOM', name: 'DHost', playerCount: 4, modeSelectionType: 'fixed' });
  await sleep(150);
  const dCode = dHost.room.code;

  // duplicate name → NAME_TAKEN
  const dup = await connect();
  sendMsg(dup, { t: 'JOIN_ROOM', code: dCode, name: 'DHost' });
  await sleep(150);
  check(dup.lastError?.code === 'NAME_TAKEN', 'duplicate name → NAME_TAKEN');
  dup.ws.close();

  const dJoin = await connect();
  sendMsg(dJoin, { t: 'JOIN_ROOM', code: dCode, name: 'DJoin' });
  await sleep(200);
  check(dHost.room.members.length === 2, 'joiner present (2 members)');

  // room list summary matches actual joinability
  const dlist = await connect();
  sendMsg(dlist, { t: 'LIST_ROOMS' });
  await sleep(150);
  const drow = (dlist.roomsList ?? []).find((r) => r.code === dCode);
  check(drow?.status === 'lobby', 'room list status=lobby (joinable)');
  check(drow?.occupiedSeats === 2 && drow?.playerCount === 4, 'room list shows seats 2/4');
  dlist.ws.close();

  // host leaves before start → a remaining member is promoted; room stays valid
  sendMsg(dHost, { t: 'LEAVE_ROOM' });
  await sleep(200);
  check(dJoin.room.members.length === 1, 'after host leaves, room remains (1 member)');
  check(dJoin.room.members.some((m) => m.isHost), 'host promotion: a remaining member is now host');

  // a new player can still join the promoted-host room (not blocked / not full)
  const dJoin2 = await connect();
  sendMsg(dJoin2, { t: 'JOIN_ROOM', code: dCode, name: 'DJoin2' });
  await sleep(200);
  check(!dJoin2.lastError, 'new player can join after host promotion');
  dJoin.ws.close(); dJoin2.ws.close(); dHost.ws.close();

  // 2e) Online bot: 2 humans + 1 server-side bot can start and the bot plays
  console.log('\n[2e] online bot (2 humans + 1 bot)');
  const bHost = await connect();
  sendMsg(bHost, { t: 'CREATE_ROOM', name: 'BHost', playerCount: 3, modeSelectionType: 'dealer_choice' });
  await sleep(150);
  const bCode = bHost.room.code;
  const bJoin = await connect();
  sendMsg(bJoin, { t: 'JOIN_ROOM', code: bCode, name: 'BJoin' });
  await sleep(200);

  // non-host cannot add a bot
  sendMsg(bJoin, { t: 'ADD_BOT' });
  await sleep(150);
  check(bJoin.lastError?.code === 'NOT_HOST', 'non-host ADD_BOT rejected (NOT_HOST)');

  // host adds a bot → 3 seats filled (2 human + 1 ai)
  sendMsg(bHost, { t: 'ADD_BOT' });
  await sleep(200);
  const botMember = bHost.room.members.find((m) => m.type === 'ai');
  check(!!botMember, 'bot member present with type ai');
  check(bHost.room.members.filter((m) => m.role === 'player').length === 3, '3 player seats (2 human + 1 bot)');
  const botSeat = botMember?.seatIndex;
  const botSeatId = `player-${botSeat}`;

  // start the game
  sendMsg(bHost, { t: 'START_GAME' });
  await sleep(300);
  check(bHost.state != null, 'game started with a bot seat');
  check(bHost.state.players[botSeat].type === 'ai', 'bot seat is type ai in GameState');
  check(bHost.state.players[botSeat].hand.every((c) => c.rank === '?'), 'bot hand is redacted for humans');

  // drive the humans through their turns; the bot acts server-side. Detect a bot play.
  const humansBySeat = {};
  humansBySeat[bHost.seat] = bHost; humansBySeat[bJoin.seat] = bJoin;
  let botPlayed = false;
  const botHasPlayed = () => [
    ...(bHost.state?.currentRound?.tricks ?? []).flatMap((t) => t.plays),
    ...(bHost.state?.currentTrick?.plays ?? []),
  ].some((p) => p.playerId === botSeatId);
  for (let step = 0; step < 80 && !botPlayed; step++) {
    // Detect a bot play every iteration — the bot may act between polls.
    if (botHasPlayed()) { botPlayed = true; break; }
    const ref = bHost.state;
    if (!ref || ref.status === 'round_scoring' || ref.status === 'game_finished') break;
    const actingId = getActingPlayerId(ref);
    if (!actingId) { await sleep(100); continue; } // trick_complete → server timer
    const seat = Number(actingId.split('-')[1]);
    const human = humansBySeat[seat];
    if (!human) { await sleep(100); continue; } // bot's turn → let the server act
    const st = human.state;
    if (st.status === 'mode_selection') sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'CHOOSE_MODE', modeId: 'no_tricks' } });
    else if (st.status === 'select_trump') sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'SELECT_TRUMP', suit: null } });
    else if (st.status === 'kitty_exchange') sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'EXCHANGE_KITTY', discards: st.players[seat].hand.slice(0, 2) } });
    else if (st.status === 'playing') {
      const led = st.currentTrick?.ledSuit ?? null;
      const valid = getValidCards(st.players[seat].hand, led, st.currentRound.mode.id, st.trumpSuit);
      sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'PLAY_CARD', playerId: `player-${seat}`, card: valid[0] } });
    }
    await sleep(110);
  }
  check(botPlayed, 'server-side bot played a card on its turn');
  bHost.ws.close(); bJoin.ws.close();

  // 2f) Reconnect after a drop + NAME_TAKEN guidance (lobby, pre-start)
  console.log('\n[2f] reconnect after drop + NAME_TAKEN');
  const rHost = await connect();
  sendMsg(rHost, { t: 'CREATE_ROOM', name: 'RHost', playerCount: 4, modeSelectionType: 'fixed' });
  await sleep(150);
  const rCode = rHost.room.code;
  const rJoin = await connect();
  sendMsg(rJoin, { t: 'JOIN_ROOM', code: rCode, name: 'Dropper' });
  await sleep(200);
  const dropperToken = rJoin.token;
  const dropperClientId = rJoin.clientId;
  check(rHost.room.members.length === 2, 'joiner present before the drop');

  // Simulate a network drop: close the socket WITHOUT leaving the room.
  rJoin.ws.close();
  await sleep(250);

  // The reconnect token still re-attaches the held seat.
  const rBack = await connect();
  sendMsg(rBack, { t: 'RECONNECT', code: rCode, reconnectToken: dropperToken });
  await sleep(250);
  check(!rBack.lastError && rBack.room?.members?.some((m) => m.name === 'Dropper'),
    'reconnect with the saved token restores the seat');
  rBack.ws.close();
  await sleep(250);

  // A NEW client joining with the same name as the (offline) member → NAME_TAKEN.
  const rDup = await connect();
  sendMsg(rDup, { t: 'JOIN_ROOM', code: rCode, name: 'Dropper' });
  await sleep(150);
  check(rDup.lastError?.code === 'NAME_TAKEN', 'join with an offline member name → NAME_TAKEN');
  rDup.ws.close();

  // Host removes the stale disconnected seat → the name frees up → join works.
  sendMsg(rHost, { t: 'KICK_MEMBER', clientId: dropperClientId });
  await sleep(200);
  const rNew = await connect();
  sendMsg(rNew, { t: 'JOIN_ROOM', code: rCode, name: 'Dropper' });
  await sleep(200);
  check(!rNew.lastError, 'after the host removes the old seat, the name can join');
  rNew.ws.close(); rHost.ws.close();

  // 2g) Avatar + turn timer (host-only setting)
  console.log('\n[2g] avatar + turn timer');
  const gHost = await connect();
  sendMsg(gHost, { t: 'CREATE_ROOM', name: 'GHost', playerCount: 3, modeSelectionType: 'fixed', avatar: '🦊' });
  await sleep(150);
  const gCode = gHost.room.code;
  check(gHost.room.members[0].avatar === '🦊', 'host avatar appears in the snapshot');
  const gJoin = await connect();
  sendMsg(gJoin, { t: 'JOIN_ROOM', code: gCode, name: 'GJoin', avatar: '🐼' });
  await sleep(150);
  check(gHost.room.members.some((m) => m.avatar === '🐼'), 'joiner avatar appears in the snapshot');

  sendMsg(gJoin, { t: 'SET_TIMER', turnTimerSec: 60 });
  await sleep(120);
  check(gJoin.lastError?.code === 'NOT_HOST', 'non-host SET_TIMER rejected (NOT_HOST)');

  sendMsg(gHost, { t: 'SET_TIMER', turnTimerSec: 60 });
  await sleep(150);
  check(gHost.room.turnTimerSec === 60, 'host set the turn timer to 60s (in snapshot)');
  gHost.ws.close(); gJoin.ws.close();

  // 2h) Room social: reactions (30s cooldown) + chat (filtered + rate-limited)
  console.log('\n[2h] room social: reactions + chat');
  const sHost = await connect();
  sendMsg(sHost, { t: 'CREATE_ROOM', name: 'SHost', playerCount: 3, modeSelectionType: 'fixed' });
  await sleep(150);
  const sCode = sHost.room.code;
  const sJoin = await connect();
  sendMsg(sJoin, { t: 'JOIN_ROOM', code: sCode, name: 'SJoin' });
  await sleep(200);

  // a whitelisted reaction broadcasts to everyone in the room
  sendMsg(sHost, { t: 'SEND_REACTION', emoji: '👍' });
  await sleep(150);
  check(sJoin.reactions.some((r) => r.emoji === '👍' && r.name === 'SHost'), 'reaction broadcast to other member');
  check(sHost.reactions.some((r) => r.emoji === '👍'), 'reaction echoed to sender');
  check(!sHost.reactions.some((r) => 'userId' in r), 'reaction payload has no userId');

  // a second reaction immediately → 30s cooldown enforced server-side
  sHost.lastError = null;
  sendMsg(sHost, { t: 'SEND_REACTION', emoji: '😂' });
  await sleep(150);
  check(sHost.lastError?.code === 'RATE_LIMITED', 'second reaction blocked by the 30s cooldown (server-side)');

  // a non-whitelisted emoji is rejected
  sJoin.lastError = null;
  sendMsg(sJoin, { t: 'SEND_REACTION', emoji: '🤬' });
  await sleep(150);
  check(sJoin.lastError?.code === 'BAD_MESSAGE', 'non-whitelisted reaction rejected');

  // chat: profanity censored to *** before broadcast
  sendMsg(sJoin, { t: 'SEND_CHAT', text: 'you are shit haha' });
  await sleep(150);
  const cmsg = sHost.chats.find((m) => m.name === 'SJoin');
  check(!!cmsg && cmsg.text.includes('***') && !/shit/i.test(cmsg.text), 'chat profanity censored before broadcast');
  check(!!cmsg && !('userId' in cmsg) && cmsg.text !== undefined, 'chat payload carries no userId/token');

  // chat rate limit (3s) enforced server-side
  sJoin.lastError = null;
  sendMsg(sJoin, { t: 'SEND_CHAT', text: 'second message too soon' });
  await sleep(150);
  check(sJoin.lastError?.code === 'RATE_LIMITED', 'second chat blocked by the 3s rate limit (server-side)');

  // Reactions + chat keep working AFTER the game starts (any state, any turn).
  sendMsg(sHost, { t: 'ADD_BOT' });
  await sleep(200);
  sendMsg(sHost, { t: 'START_GAME' });
  await sleep(500);
  check(!!sHost.state, 'social room: game started');
  const reactsBefore = sJoin.reactions.length;       // sJoin has not reacted yet (no cooldown)
  sendMsg(sJoin, { t: 'SEND_REACTION', emoji: '👏' });
  await sleep(200);
  check(sJoin.reactions.length > reactsBefore && sJoin.reactions.some((r) => r.emoji === '👏'),
    'reaction works DURING the game, regardless of whose turn it is');
  sHost.lastError = null;                              // sHost has not chatted yet (no rate limit)
  sendMsg(sHost, { t: 'SEND_CHAT', text: 'gg during play' });
  await sleep(200);
  check(sJoin.chats.some((m) => m.text === 'gg during play'), 'chat works DURING the game');

  // Chat media stickers (Stage 11.0): a whitelisted sticker sent by id works
  // DURING the active game; invalid/arbitrary ids are rejected (whitelist only).
  const stickerId = CHAT_MEDIA[0].id;
  await sleep(3100);                                   // clear sHost's 3s chat rate limit
  sHost.lastError = null;
  sendMsg(sHost, { t: 'SEND_CHAT_MEDIA', mediaId: stickerId });
  await sleep(200);
  const mmsg = sJoin.chats.find((m) => m.media && m.media.id === stickerId);
  check(!!mmsg, 'chat sticker (media) reaches the other human during play');
  check(!!mmsg && mmsg.media.src.startsWith('/chat-media/') && mmsg.text === '',
    'media message carries a server-approved /chat-media src and empty text');
  check(!!mmsg && !/userId|reconnectToken|token|password/i.test(JSON.stringify(mmsg)),
    'media chat payload carries no userId/token');
  // Unknown id → MESSAGE_BLOCKED (checked before the rate limit).
  sHost.lastError = null;
  sendMsg(sHost, { t: 'SEND_CHAT_MEDIA', mediaId: 'totally-not-a-real-id' });
  await sleep(150);
  check(sHost.lastError?.code === 'MESSAGE_BLOCKED', 'unknown mediaId rejected (whitelist only)');
  // An arbitrary URL as the id is not in the whitelist → rejected too.
  sHost.lastError = null;
  sendMsg(sHost, { t: 'SEND_CHAT_MEDIA', mediaId: 'https://evil.example/x.gif' });
  await sleep(150);
  check(sHost.lastError?.code === 'MESSAGE_BLOCKED', 'arbitrary URL as mediaId rejected');

  sHost.ws.close(); sJoin.ws.close();

  // 2j) Explicit "Leave lobby" (LEAVE_ROOM) removes the member (vs a silent
  // disconnect, which keeps the seat) → the same name can rejoin immediately.
  console.log('\n[2j] explicit leave lobby + rejoin same name');
  const lHost = await connect();
  sendMsg(lHost, { t: 'CREATE_ROOM', name: 'LHost', playerCount: 4, modeSelectionType: 'fixed' });
  await sleep(150);
  const lCode = lHost.room.code;
  const lJoin = await connect();
  sendMsg(lJoin, { t: 'JOIN_ROOM', code: lCode, name: 'Leaver' });
  await sleep(200);
  check(lHost.room.members.length === 2, 'joiner present before leaving the lobby');

  sendMsg(lJoin, { t: 'LEAVE_ROOM' });
  await sleep(250);
  check(lHost.room.members.length === 1, 'explicit leave frees the seat (member removed)');
  check(lHost.room.members[0].isHost, 'host unchanged when a non-host leaves');

  const lRejoin = await connect();
  sendMsg(lRejoin, { t: 'JOIN_ROOM', code: lCode, name: 'Leaver' });
  await sleep(200);
  check(!lRejoin.lastError, 'same name rejoins after an explicit leave (no NAME_TAKEN)');
  check(lHost.room.members.length === 2, 'rejoined member is back in the lobby');
  lHost.ws.close(); lJoin.ws.close(); lRejoin.ws.close();

  // 2k) Active-game "Leave game" = a socket DROP (NOT LEAVE_ROOM): the member is
  // kept reconnectable (vs the lobby "Leave lobby", which removes the seat).
  console.log('\n[2l] active-game leave keeps the seat reconnectable');
  const qHost = await connect();
  sendMsg(qHost, { t: 'CREATE_ROOM', name: 'QHost', playerCount: 3, modeSelectionType: 'fixed' });
  await sleep(150);
  const qCode = qHost.room.code;
  const qJoin = await connect();
  sendMsg(qJoin, { t: 'JOIN_ROOM', code: qCode, name: 'Quitter' });
  await sleep(200);
  sendMsg(qHost, { t: 'ADD_BOT' });
  await sleep(200);
  sendMsg(qHost, { t: 'START_GAME' });
  await sleep(400);
  check(!!qJoin.state, 'joiner is in the active game');
  const qToken = qJoin.token, qSeat = qJoin.seat;

  // "Leave game": drop the socket WITHOUT sending LEAVE_ROOM.
  qJoin.ws.close();
  await sleep(300);
  const stillThere = qHost.room.members.find((m) => m.name === 'Quitter');
  check(!!stillThere, 'after leave game the member is NOT removed (still in room)');
  check(stillThere && stillThere.connected === false, 'member marked offline (reconnectable), not gone');

  // The saved reconnect token restores the seat + the player's own hand → Resume.
  const qBack = await connect();
  sendMsg(qBack, { t: 'RECONNECT', code: qCode, reconnectToken: qToken });
  await sleep(300);
  check(!qBack.lastError && qBack.state != null, 'reconnect after leave game restores the game');
  check(qBack.state?.players[qSeat]?.hand.every((c) => c.rank !== '?'), 'reconnected player sees their own hand');
  qHost.ws.close(); qBack.ws.close();

  // 2m) Disconnected human → AI SUBSTITUTE plays for them after the (test-short)
  // delay, so the table never stalls; the member stays human (not a bot).
  console.log('\n[2m] disconnected human gets an AI substitute');
  const obs = await connect();
  sendMsg(obs, { t: 'CREATE_ROOM', name: 'Observer', playerCount: 3, modeSelectionType: 'dealer_choice' });
  await sleep(150);
  const mCode = obs.room.code;
  const drop = await connect();
  sendMsg(drop, { t: 'JOIN_ROOM', code: mCode, name: 'Dropper' });
  await sleep(200);
  sendMsg(obs, { t: 'ADD_BOT' });
  await sleep(200);
  sendMsg(obs, { t: 'START_GAME' });
  await sleep(300);
  const dropSeatId = `player-${drop.seat}`;

  // Dropper disconnects — does NOT leave the room.
  drop.ws.close();
  await sleep(250);
  const dm = obs.room.members.find((m) => m.name === 'Dropper');
  check(!!dm && dm.connected === false, 'disconnected human stays in the room (offline)');

  // Drive only the observer's own turns; the bot + the AI substitute (for the
  // disconnected Dropper) handle the rest. Detect a play made for Dropper's seat
  // → proves the substitute acted (a disconnected seat cannot play for itself).
  const obsBySeat = {};
  obsBySeat[obs.seat] = obs;
  const dropperPlayed = () => [
    ...(obs.state?.currentRound?.tricks ?? []).flatMap((t) => t.plays),
    ...(obs.state?.currentTrick?.plays ?? []),
  ].some((p) => p.playerId === dropSeatId);
  let subbed = false;
  for (let step = 0; step < 140 && !subbed; step++) {
    if (dropperPlayed()) { subbed = true; break; }
    const ref = obs.state;
    if (!ref || ref.status === 'game_finished') break;
    const actingId = getActingPlayerId(ref);
    if (!actingId) { await sleep(120); continue; }
    const seat = Number(actingId.split('-')[1]);
    const human = obsBySeat[seat];
    if (!human) { await sleep(120); continue; } // bot or disconnected Dropper → server acts
    const st = human.state;
    if (st.status === 'mode_selection') sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'CHOOSE_MODE', modeId: 'no_tricks' } });
    else if (st.status === 'select_trump') sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'SELECT_TRUMP', suit: null } });
    else if (st.status === 'kitty_exchange') sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'EXCHANGE_KITTY', discards: st.players[seat].hand.slice(0, 2) } });
    else if (st.status === 'playing') {
      const led = st.currentTrick?.ledSuit ?? null;
      const valid = getValidCards(st.players[seat].hand, led, st.currentRound.mode.id, st.trumpSuit);
      sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'PLAY_CARD', playerId: `player-${seat}`, card: valid[0] } });
    }
    await sleep(140);
  }
  check(subbed, 'AI substituted a legal move for the disconnected human (a Dropper play occurred)');
  const dm2 = obs.room.members.find((m) => m.name === 'Dropper');
  check(dm2 && dm2.type === 'human', 'substituted player remained a HUMAN member (not converted to a bot)');
  obs.ws.close();

  // 2n) ONLINE Durak (released, Stage 9.6): host a Durak room, bots fill it,
  // start, redaction hides opponents, a human acts, chat + reconnect work.
  console.log('\n[2n] online Durak room');
  // Unknown gameType is rejected.
  const badGame = await connect();
  sendMsg(badGame, { t: 'CREATE_ROOM', name: 'X', playerCount: 2, modeSelectionType: 'fixed', gameType: 'chess' });
  await sleep(150);
  check(badGame.lastError?.code === 'BAD_MESSAGE', 'unknown gameType rejected (BAD_MESSAGE)');
  badGame.ws.close();

  const dkHost = await connect();
  sendMsg(dkHost, { t: 'CREATE_ROOM', name: 'DurakHost', playerCount: 2, modeSelectionType: 'fixed', gameType: 'durak', variant: 'transfer' });
  await sleep(200);
  check(dkHost.room?.gameType === 'durak', 'CREATE_ROOM durak → room.gameType durak');
  check(dkHost.room?.variant === 'transfer', 'durak room carries the transfer variant');
  const dkCode = dkHost.room.code;
  sendMsg(dkHost, { t: 'ADD_BOT' });
  await sleep(200);
  sendMsg(dkHost, { t: 'START_GAME' });
  await sleep(400);
  check(dkHost.state?.gameType === 'durak', 'online Durak start → DurakState over WS');
  check(dkHost.state?.players?.length === 2, 'Durak state has 2 players');
  check(Array.isArray(dkHost.state?.drawPile), 'Durak state has a draw pile');
  // Redaction: the host sees its OWN hand, the bot's hand is hidden.
  const dkSeat = dkHost.seat;
  const dkMyHand = dkHost.state.players[dkSeat].hand;
  const dkBotHand = dkHost.state.players[dkSeat === 0 ? 1 : 0].hand;
  check(dkMyHand.every((c) => c.rank !== '?'), 'host sees its own Durak hand');
  // Count kept (5 or 6 — the bot may already have opened) and every card hidden.
  check(dkBotHand.length >= 5 && dkBotHand.every((c) => c.rank === '?'), 'opponent Durak hand is redacted (hidden, count kept)');

  // Drive a few turns; when it is the host's turn, make a legal move.
  let dkActed = false;
  for (let dkStep = 0; dkStep < 60 && !dkActed; dkStep++) {
    const ds = dkHost.state;
    if (!ds || ds.status === 'finished') break;
    const dkThrow = ds.status === 'attack' || ds.status === 'taking';
    const dkActing = ds.status === 'defense' ? ds.defenderIndex : ds.throwerIndex;
    if (dkActing !== dkSeat) { await sleep(150); continue; } // bot's turn → server drives it
    const dkBefore = JSON.stringify(ds);
    if (dkThrow) {
      if (ds.status === 'attack' && ds.table.length === 0) sendMsg(dkHost, { t: 'ACTION_REQUEST', action: { type: 'ATTACK_CARD', card: ds.players[dkSeat].hand[0] } });
      else sendMsg(dkHost, { t: 'ACTION_REQUEST', action: { type: 'PASS_ATTACK' } });
    } else {
      sendMsg(dkHost, { t: 'ACTION_REQUEST', action: { type: 'TAKE_CARDS' } });
    }
    await sleep(250);
    if (JSON.stringify(dkHost.state) !== dkBefore) dkActed = true;
  }
  check(dkActed, 'a human Durak action was accepted + advanced the state online');

  // Chat works in the Durak room (broadcast back to the sender).
  sendMsg(dkHost, { t: 'SEND_CHAT', text: 'gg durak' });
  await sleep(200);
  check(dkHost.chats.some((m) => m.text.includes('gg durak')), 'chat works in an online Durak room');

  // Reconnect restores the Durak game with the own hand.
  const dkToken = dkHost.token;
  dkHost.ws.close();
  await sleep(200);
  const dkBack = await connect();
  sendMsg(dkBack, { t: 'RECONNECT', code: dkCode, reconnectToken: dkToken });
  await sleep(300);
  check(!dkBack.lastError && dkBack.state?.gameType === 'durak', 'reconnect restores the online Durak game');
  check(dkBack.state.players[dkBack.seat].hand.every((c) => c.rank !== '?'), 'reconnected Durak player sees their own hand');
  dkBack.ws.close();

  // 2o) Full online Durak game (human + bot) driven to FINISHED, with a redaction
  // check on every observed state (opponents must always be hidden).
  console.log('\n[2o] online Durak: full game to finished + no redaction leak');
  const fHost = await connect();
  sendMsg(fHost, { t: 'CREATE_ROOM', name: 'Finisher', playerCount: 2, modeSelectionType: 'fixed', gameType: 'durak', variant: 'simple' });
  await sleep(180);
  sendMsg(fHost, { t: 'ADD_BOT' });
  await sleep(180);
  sendMsg(fHost, { t: 'START_GAME' });
  await sleep(350);
  const fSeat = fHost.seat;
  let leakSeen = false;
  let takingSeen = false;
  let finished = false;
  for (let step = 0; step < 500 && !finished; step++) {
    const s = fHost.state;
    if (!s) { await sleep(120); continue; }
    // Redaction invariant: the bot's hand is never revealed to the human.
    const oppHand = s.players[fSeat === 0 ? 1 : 0].hand;
    if (oppHand.some((c) => c.rank !== '?')) leakSeen = true;
    if (s.status === 'finished') { finished = true; break; }
    if (s.status === 'taking') takingSeen = true; // exercised the take-phase throw-in flow
    const isThrow = s.status === 'attack' || s.status === 'taking';
    const acting = s.status === 'defense' ? s.defenderIndex : s.throwerIndex;
    if (acting !== fSeat) { await sleep(160); continue; }
    if (isThrow) {
      if (s.status === 'attack' && s.table.length === 0) {
        sendMsg(fHost, { t: 'ACTION_REQUEST', action: { type: 'ATTACK_CARD', card: s.players[fSeat].hand[0] } });
      } else {
        // Throw in a card whose rank is on the table (also during the defender's
        // take — exercises take-phase throw-ins); otherwise pass.
        const ranks = new Set(s.table.flatMap((p) => [p.attack.rank, p.defense?.rank].filter(Boolean)));
        const throwIn = s.players[fSeat].hand.find((c) => c.rank !== '?' && ranks.has(c.rank));
        if (throwIn && s.table.length < s.boutLimit) sendMsg(fHost, { t: 'ACTION_REQUEST', action: { type: 'ATTACK_CARD', card: throwIn } });
        else sendMsg(fHost, { t: 'ACTION_REQUEST', action: { type: 'PASS_ATTACK' } });
      }
    } else {
      sendMsg(fHost, { t: 'ACTION_REQUEST', action: { type: 'TAKE_CARDS' } });
      // Catch the take-phase window before the bot's scheduled throw-in resolves it.
      await sleep(25);
      if (fHost.state?.status === 'taking') takingSeen = true;
    }
    await sleep(180);
  }
  check(finished, 'online Durak game reached finished');
  check(takingSeen, 'take-phase reached online: a TAKE opened a throw-in window (status \'taking\')');
  check(!leakSeen, 'no redaction leak: the opponent hand stayed hidden all game');
  check(fHost.state?.foolId != null || fHost.state?.isDraw === true, 'finished state has a fool or a draw');
  console.log(`  · take-phase (status 'taking') observed during the game: ${takingSeen}`);
  fHost.ws.close();

  // 2p) Two humans + bot: join, redaction per human, chat between humans, one human
  // disconnects (host sees offline), then reconnects with hand intact.
  console.log('\n[2p] online Durak with two humans (join, chat, offline, reconnect)');
  const tHost = await connect();
  sendMsg(tHost, { t: 'CREATE_ROOM', name: 'THost', playerCount: 3, modeSelectionType: 'fixed', gameType: 'durak', variant: 'simple' });
  await sleep(180);
  const tCode = tHost.room.code;
  const tJoin = await connect();
  sendMsg(tJoin, { t: 'JOIN_ROOM', code: tCode, name: 'TJoin' });
  await sleep(180);
  check(!tJoin.lastError && tJoin.room?.gameType === 'durak', 'second human joins the Durak room');
  sendMsg(tHost, { t: 'ADD_BOT' });
  await sleep(180);
  sendMsg(tHost, { t: 'START_GAME' });
  await sleep(350);
  check(tHost.state?.gameType === 'durak' && tJoin.state?.gameType === 'durak', 'both humans get the Durak state');
  check(tJoin.state.players[tJoin.seat].hand.every((c) => c.rank !== '?'), 'joiner sees its own hand');
  check(tJoin.state.players[tHost.seat].hand.every((c) => c.rank === '?'), "joiner cannot see the host's hand");
  // Chat between the two humans.
  sendMsg(tJoin, { t: 'SEND_CHAT', text: 'hi from join' });
  await sleep(200);
  check(tHost.chats.some((m) => m.text.includes('hi from join')), 'chat from one human reaches the other');
  // Joiner disconnects → host sees the member offline (reconnectable, not removed).
  const tToken = tJoin.token;
  tJoin.ws.close();
  await sleep(300);
  const tm = tHost.room.members.find((m) => m.name === 'TJoin');
  check(tm && tm.connected === false, 'disconnected human shows offline in the room (not removed)');
  // Reconnect → hand intact.
  const tBack = await connect();
  sendMsg(tBack, { t: 'RECONNECT', code: tCode, reconnectToken: tToken });
  await sleep(300);
  check(!tBack.lastError && tBack.state?.gameType === 'durak', 'human reconnects to the Durak game');
  check(tBack.state.players[tBack.seat].hand.every((c) => c.rank !== '?'), 'reconnected human still sees its own hand');
  tHost.ws.close(); tBack.ws.close();

  // 2q) Leave lobby before start frees the Durak seat.
  console.log('\n[2q] online Durak: leave lobby before start frees the seat');
  const lqHost = await connect();
  sendMsg(lqHost, { t: 'CREATE_ROOM', name: 'QHost', playerCount: 3, modeSelectionType: 'fixed', gameType: 'durak', variant: 'transfer' });
  await sleep(180);
  const lqCode = lqHost.room.code;
  const lqJoin = await connect();
  sendMsg(lqJoin, { t: 'JOIN_ROOM', code: lqCode, name: 'QLeaver' });
  await sleep(200);
  check(lqHost.room.members.some((m) => m.name === 'QLeaver'), 'joiner is in the Durak lobby');
  sendMsg(lqJoin, { t: 'LEAVE_ROOM' });
  await sleep(200);
  check(!lqHost.room.members.some((m) => m.name === 'QLeaver'), 'leave lobby removed the Durak seat');
  lqHost.ws.close(); lqJoin.ws.close();

  // 2r) ONLINE Tarneeb (released, Stage 10.8): host a 4-seat Tarneeb room,
  // fill with a 2nd human + 2 bots, start, redaction per human, a human acts, a
  // trick completes, chat + reactions + reconnect + leave-lobby all work.
  console.log('\n[2r] online Tarneeb room');
  const tnHost = await connect();
  sendMsg(tnHost, { t: 'CREATE_ROOM', name: 'TnHost', modeSelectionType: 'fixed', gameType: 'tarneeb' });
  await sleep(220);
  check(tnHost.room?.gameType === 'tarneeb', 'CREATE_ROOM tarneeb → room.gameType tarneeb');
  check(tnHost.room?.playerCount === 4, 'Tarneeb room is 4 seats (catalog max)');
  const tnCode = tnHost.room.code;

  // Room browser shows the Tarneeb room.
  const tnList = await connect();
  sendMsg(tnList, { t: 'LIST_ROOMS' });
  await sleep(150);
  check((tnList.roomsList ?? []).some((r) => r.code === tnCode && r.gameType === 'tarneeb'),
    'Tarneeb room appears in the room browser as tarneeb');
  tnList.ws.close();

  // Start before 4 seats is rejected (Tarneeb requires exactly 4).
  tnHost.lastError = null;
  sendMsg(tnHost, { t: 'START_GAME' });
  await sleep(200);
  check(!tnHost.state, 'Tarneeb start rejected before 4 seats (not started)');

  // A 2nd human joins; 2 bots fill to 4.
  const tnJoin = await connect();
  sendMsg(tnJoin, { t: 'JOIN_ROOM', code: tnCode, name: 'TnJoin' });
  await sleep(200);
  sendMsg(tnHost, { t: 'ADD_BOT' });
  sendMsg(tnHost, { t: 'ADD_BOT' });
  await sleep(300);
  check(tnHost.room.members.filter((m) => m.role === 'player').length === 4, 'Tarneeb room fills to 4 (2 humans + 2 bots)');

  // Full room rejects an extra joiner.
  const tnLate = await connect();
  sendMsg(tnLate, { t: 'JOIN_ROOM', code: tnCode, name: 'TnLate' });
  await sleep(150);
  check(tnLate.lastError?.code === 'ROOM_FULL', 'full Tarneeb room → ROOM_FULL');
  tnLate.ws.close();

  // Start → TarneebState over the wire.
  sendMsg(tnHost, { t: 'START_GAME' });
  await sleep(450);
  check(tnHost.state?.gameType === 'tarneeb', 'online Tarneeb start → TarneebState over WS');
  check(tnHost.state?.phase === 'bidding', 'Tarneeb starts in the bidding phase');
  check(tnHost.state?.players?.length === 4, 'Tarneeb state has 4 players');

  // Redaction: each human sees only its own hand; opponents are hidden.
  const tnHostSeat = tnHost.seat, tnJoinSeat = tnJoin.seat;
  check(tnHost.state.handsBySeat[tnHostSeat].every((c) => c.rank !== '?'), 'host sees its own Tarneeb hand');
  check(tnHost.state.handsBySeat[tnJoinSeat].every((c) => c.rank === '?'), "host cannot see the joiner's hand");
  check(tnJoin.state.handsBySeat[tnJoinSeat].every((c) => c.rank !== '?'), 'joiner sees its own Tarneeb hand');
  check(tnJoin.state.handsBySeat[tnHostSeat].every((c) => c.rank === '?'), "joiner cannot see the host's hand");
  const tnLeak = (st, mySeat) => st.handsBySeat.some((h, seat) => seat !== mySeat && h.some((c) => c.rank !== '?'));
  check(!tnLeak(tnHost.state, tnHostSeat) && !tnLeak(tnJoin.state, tnJoinSeat),
    'no opponent hand leaks in either human payload');

  // Drive: a human bids the top amount (→ becomes declarer), names trump, then
  // plays legal cards; bots + the server drive the rest. We look for: a human
  // action accepted, a completed trick, and (best-effort) a human trump choice.
  const tnHumans = {};
  tnHumans[tnHostSeat] = tnHost; tnHumans[tnJoinSeat] = tnJoin;
  let tnHumanActed = false, tnTrickSeen = false, tnHumanTrump = false, tnAdvanceSeen = false;
  let tnLastHand = tnHost.state.handNumber;
  for (let step = 0; step < 300 && !(tnTrickSeen && tnHumanActed); step++) {
    const s = tnHost.state;
    if (!s || s.phase === 'game_finished') break;
    if ((s.completedTricks?.length ?? 0) >= 1) tnTrickSeen = true;
    if (s.handNumber > tnLastHand) { tnAdvanceSeen = true; tnLastHand = s.handNumber; }
    const actionable = s.phase === 'bidding' || s.phase === 'choosing_trump' || s.phase === 'playing';
    if (!actionable) { await sleep(80); continue; } // hand_complete → server auto-advances
    const human = tnHumans[s.currentSeat];
    if (!human) { await sleep(80); continue; }       // bot's turn → the server acts
    const hs = human.state, seat = human.seat;
    const before = JSON.stringify(hs);
    if (hs.phase === 'bidding') {
      const vb = getValidBids(hs, seat);
      if (vb.length) sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'BID', amount: Math.max(...vb) } });
      else sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'PASS_BID' } });
    } else if (hs.phase === 'choosing_trump') {
      sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'CHOOSE_TRUMP', suit: 'spades' } });
      tnHumanTrump = true;
    } else if (hs.phase === 'playing') {
      const legal = getValidPlayableCards(hs, seat);
      if (legal.length) sendMsg(human, { t: 'ACTION_REQUEST', action: { type: 'PLAY_CARD', card: legal[0] } });
    }
    await sleep(90);
    if (JSON.stringify(human.state) !== before) tnHumanActed = true;
  }
  check(tnHumanActed, 'a human Tarneeb action was accepted + advanced the state online');
  check(tnTrickSeen, 'at least one Tarneeb trick completed online');
  console.log(`  · human chose trump online: ${tnHumanTrump}; hand auto-advanced: ${tnAdvanceSeen}`);

  // Out-of-turn: a non-acting human's action is refused server-side.
  {
    const s = tnHost.state;
    if (s && s.phase !== 'game_finished') {
      const offHuman = [tnHost, tnJoin].find((c) => c.seat !== s.currentSeat);
      if (offHuman) {
        offHuman.lastError = null;
        sendMsg(offHuman, { t: 'ACTION_REQUEST', action: { type: 'PASS_BID' } });
        await sleep(150);
        check(offHuman.lastError != null, 'out-of-turn Tarneeb action rejected server-side');
      }
    }
  }

  // Social: chat + a reaction both work in the Tarneeb room.
  sendMsg(tnHost, { t: 'SEND_CHAT', text: 'gg tarneeb' });
  await sleep(200);
  check(tnJoin.chats.some((m) => m.text.includes('gg tarneeb')), 'chat works in an online Tarneeb room');
  const tnReactBefore = tnJoin.reactions.length;
  sendMsg(tnJoin, { t: 'SEND_REACTION', emoji: '👏' });
  await sleep(200);
  check(tnJoin.reactions.length > tnReactBefore, 'reaction works in an online Tarneeb room');

  // Reconnect the host mid-game → own hand intact.
  const tnToken = tnHost.token;
  tnHost.ws.close();
  await sleep(250);
  const tnBack = await connect();
  sendMsg(tnBack, { t: 'RECONNECT', code: tnCode, reconnectToken: tnToken });
  await sleep(350);
  check(!tnBack.lastError && tnBack.state?.gameType === 'tarneeb', 'reconnect restores the online Tarneeb game');
  check(tnBack.state.handsBySeat[tnBack.seat].every((c) => c.rank !== '?'), 'reconnected Tarneeb player sees their own hand');
  // Redaction still holds after reconnect: opponents' hands stay hidden (counts only).
  check(!tnLeak(tnBack.state, tnBack.seat), 'no opponent Tarneeb hand leaks after reconnect');
  tnBack.ws.close(); tnJoin.ws.close();

  // Leave lobby before start frees a Tarneeb seat (separate room).
  const tnlHost = await connect();
  sendMsg(tnlHost, { t: 'CREATE_ROOM', name: 'TnLHost', modeSelectionType: 'fixed', gameType: 'tarneeb' });
  await sleep(160);
  const tnlCode = tnlHost.room.code;
  const tnlJoin = await connect();
  sendMsg(tnlJoin, { t: 'JOIN_ROOM', code: tnlCode, name: 'TnLeaver' });
  await sleep(200);
  check(tnlHost.room.members.some((m) => m.name === 'TnLeaver'), 'joiner is in the Tarneeb lobby');
  sendMsg(tnlJoin, { t: 'LEAVE_ROOM' });
  await sleep(200);
  check(!tnlHost.room.members.some((m) => m.name === 'TnLeaver'), 'leave lobby frees the Tarneeb seat');
  tnlHost.ws.close(); tnlJoin.ws.close();

  // 2p) ONLINE Preferans (experimental, Stage 19.5): host a 3-seat Preferans room,
  // fill with a 2nd human + 1 bot, start, redaction per human, a human acts, a trick
  // completes, chat + reactions + reconnect + leave-lobby all work. No stats recorded.
  console.log('\n[2p] online Preferans room (experimental)');
  const pfHost = await connect();
  sendMsg(pfHost, { t: 'CREATE_ROOM', name: 'PfHost', modeSelectionType: 'fixed', gameType: 'preferans' });
  await sleep(220);
  check(pfHost.room?.gameType === 'preferans', 'CREATE_ROOM preferans → room.gameType preferans');
  check(pfHost.room?.playerCount === 3, 'Preferans room is 3 seats (catalog min=max)');
  const pfCode = pfHost.room.code;

  // Room browser shows the Preferans room.
  const pfList = await connect();
  sendMsg(pfList, { t: 'LIST_ROOMS' });
  await sleep(150);
  check((pfList.roomsList ?? []).some((r) => r.code === pfCode && r.gameType === 'preferans'),
    'Preferans room appears in the room browser as preferans');
  pfList.ws.close();

  // Start before 3 seats is rejected (Preferans requires exactly 3).
  pfHost.lastError = null;
  sendMsg(pfHost, { t: 'START_GAME' });
  await sleep(200);
  check(!pfHost.state, 'Preferans start rejected before 3 seats (not started)');

  // A 2nd human joins; 1 bot fills to 3.
  const pfJoin = await connect();
  sendMsg(pfJoin, { t: 'JOIN_ROOM', code: pfCode, name: 'PfJoin' });
  await sleep(200);
  sendMsg(pfHost, { t: 'ADD_BOT' });
  await sleep(300);
  check(pfHost.room.members.filter((m) => m.role === 'player').length === 3, 'Preferans room fills to 3 (2 humans + 1 bot)');

  // Full room rejects an extra joiner.
  const pfLate = await connect();
  sendMsg(pfLate, { t: 'JOIN_ROOM', code: pfCode, name: 'PfLate' });
  await sleep(150);
  check(pfLate.lastError?.code === 'ROOM_FULL', 'full Preferans room → ROOM_FULL');
  pfLate.ws.close();

  // Start → PreferansState over the wire.
  sendMsg(pfHost, { t: 'START_GAME' });
  await sleep(450);
  check(pfHost.state?.gameType === 'preferans', 'online Preferans start → PreferansState over WS');
  check(pfHost.state?.phase === 'bidding', 'Preferans starts in the bidding phase');
  check(pfHost.state?.players?.length === 3, 'Preferans state has 3 players');
  check(pfHost.state?.talon?.length === 2, 'Preferans deals a 2-card talon');

  // Redaction: each human sees only its own hand; opponents + the talon are hidden.
  const pfHostSeat = pfHost.seat, pfJoinSeat = pfJoin.seat;
  check(pfHost.state.handsBySeat[pfHostSeat].every((c) => c.rank !== '?'), 'host sees its own Preferans hand');
  check(pfHost.state.handsBySeat[pfJoinSeat].every((c) => c.rank === '?'), "host cannot see the joiner's hand");
  check(pfHost.state.talon.every((c) => c.rank === '?'), 'the un-taken talon is hidden from the host');
  check(pfJoin.state.handsBySeat[pfJoinSeat].every((c) => c.rank !== '?'), 'joiner sees its own Preferans hand');
  const pfLeak = (st, mySeat) => st.handsBySeat.some((h, seat) => seat !== mySeat && h.some((c) => c.rank !== '?'));
  check(!pfLeak(pfHost.state, pfHostSeat) && !pfLeak(pfJoin.state, pfJoinSeat),
    'no opponent Preferans hand leaks in either human payload');

  // Drive: each acting human plays a legal move (via the deterministic bot heuristic
  // on its OWN redacted hand); bots + the server drive the rest. Look for a human
  // action accepted and a completed trick.
  const pfHumans = {};
  pfHumans[pfHostSeat] = pfHost; pfHumans[pfJoinSeat] = pfJoin;
  let pfHumanActed = false, pfTrickSeen = false, pfAdvanceSeen = false;
  let pfLastHand = pfHost.state.handNumber;
  for (let step = 0; step < 400 && !(pfTrickSeen && pfHumanActed); step++) {
    const s = pfHost.state;
    if (!s || s.phase === 'game_finished') break;
    if ((s.completedTricks?.length ?? 0) >= 1) pfTrickSeen = true;
    if (s.handNumber > pfLastHand) { pfAdvanceSeen = true; pfLastHand = s.handNumber; }
    const actionable = s.phase === 'bidding' || s.phase === 'talon' || s.phase === 'playing';
    if (!actionable) { await sleep(80); continue; } // hand_complete → server auto-advances
    const human = pfHumans[s.currentSeat];
    if (!human) { await sleep(80); continue; }       // bot's turn → the server acts
    const before = JSON.stringify(human.state);
    sendMsg(human, { t: 'ACTION_REQUEST', action: preferansBotAction(human.state, human.seat) });
    await sleep(90);
    if (JSON.stringify(human.state) !== before) pfHumanActed = true;
  }
  check(pfHumanActed, 'a human Preferans action was accepted + advanced the state online');
  check(pfTrickSeen, 'at least one Preferans trick completed online');
  console.log(`  · Preferans hand auto-advanced online: ${pfAdvanceSeen}`);

  // Out-of-turn: a non-acting human's action is refused server-side.
  {
    const s = pfHost.state;
    if (s && s.phase !== 'game_finished') {
      const offHuman = [pfHost, pfJoin].find((c) => c.seat !== s.currentSeat);
      if (offHuman) {
        offHuman.lastError = null;
        sendMsg(offHuman, { t: 'ACTION_REQUEST', action: { type: 'PASS_BID' } });
        await sleep(150);
        check(offHuman.lastError != null, 'out-of-turn Preferans action rejected server-side');
      }
    }
  }

  // Social: chat + a reaction both work in the Preferans room.
  sendMsg(pfHost, { t: 'SEND_CHAT', text: 'gg preferans' });
  await sleep(200);
  check(pfJoin.chats.some((m) => m.text.includes('gg preferans')), 'chat works in an online Preferans room');
  const pfReactBefore = pfJoin.reactions.length;
  sendMsg(pfJoin, { t: 'SEND_REACTION', emoji: '👏' });
  await sleep(200);
  check(pfJoin.reactions.length > pfReactBefore, 'reaction works in an online Preferans room');

  // Reconnect the host mid-game → own hand intact, no leak.
  const pfToken = pfHost.token;
  pfHost.ws.close();
  await sleep(250);
  const pfBack = await connect();
  sendMsg(pfBack, { t: 'RECONNECT', code: pfCode, reconnectToken: pfToken });
  await sleep(350);
  check(!pfBack.lastError && pfBack.state?.gameType === 'preferans', 'reconnect restores the online Preferans game');
  check(pfBack.state.handsBySeat[pfBack.seat].every((c) => c.rank !== '?'), 'reconnected Preferans player sees their own hand');
  check(!pfLeak(pfBack.state, pfBack.seat), 'no opponent Preferans hand leaks after reconnect');
  pfBack.ws.close(); pfJoin.ws.close();

  // Leave lobby before start frees a Preferans seat (separate room).
  const pflHost = await connect();
  sendMsg(pflHost, { t: 'CREATE_ROOM', name: 'PfLHost', modeSelectionType: 'fixed', gameType: 'preferans' });
  await sleep(160);
  const pflCode = pflHost.room.code;
  const pflJoin = await connect();
  sendMsg(pflJoin, { t: 'JOIN_ROOM', code: pflCode, name: 'PfLeaver' });
  await sleep(200);
  check(pflHost.room.members.some((m) => m.name === 'PfLeaver'), 'joiner is in the Preferans lobby');
  sendMsg(pflJoin, { t: 'LEAVE_ROOM' });
  await sleep(200);
  check(!pflHost.room.members.some((m) => m.name === 'PfLeaver'), 'leave lobby frees the Preferans seat');
  pflHost.ws.close(); pflJoin.ws.close();

  // 3) Host starts the game
  console.log('\n[2] start game → mode selection');
  sendMsg(host, { t: 'START_GAME' });
  await sleep(300);
  check(host.state?.status === 'mode_selection', 'game started in mode_selection');

  // 2c) Joining a started game is rejected
  const late = await connect();
  sendMsg(late, { t: 'JOIN_ROOM', code, name: 'Late2', password: 'secret' });
  await sleep(150);
  check(late.lastError?.code === 'GAME_ALREADY_STARTED', `started game → GAME_ALREADY_STARTED ("${humanError(late.lastError?.code)}")`);
  late.ws.close();

  const clients = [host, j1, j2];
  const bySeat = (seat) => clients.find((c) => c.seat === seat);
  const dealerSeat = host.state.dealerIndex;
  const dealer = bySeat(dealerSeat);
  const nonDealer = clients.find((c) => c.seat !== dealerSeat);
  check(!!dealer, `dealer identified (seat ${dealerSeat}, ${dealer?.room.members[dealerSeat]?.name})`);

  // 4) Only the dealer may choose the mode (Trump). Trump is chosen BEFORE the
  //    kitty now, so the order is: CHOOSE_MODE → select_trump → kitty_exchange.
  console.log('\n[3] dealer chooses Trump → select_trump (before kitty)');
  sendMsg(nonDealer, { t: 'ACTION_REQUEST', action: { type: 'CHOOSE_MODE', modeId: 'trump' } });
  await sleep(150);
  check(nonDealer.lastError?.code === 'NOT_YOUR_TURN', 'non-dealer CHOOSE_MODE rejected');

  sendMsg(dealer, { t: 'ACTION_REQUEST', action: { type: 'CHOOSE_MODE', modeId: 'trump' } });
  await sleep(250);
  check(dealer.state?.status === 'select_trump', 'dealer chose Trump → select_trump (not kitty)');
  check(dealer.state.players[dealerSeat].hand.length === 10, 'dealer hand still 10 (kitty NOT taken yet)');
  check((dealer.state?.currentRound.kitty?.length ?? 0) === 0, 'kitty is not revealed before trump (redacted)');

  // 3b) Select trump → NOW the dealer takes the kitty
  console.log('\n[3b] select trump → kitty_exchange');
  sendMsg(nonDealer, { t: 'ACTION_REQUEST', action: { type: 'SELECT_TRUMP', suit: 'hearts' } });
  await sleep(120);
  check(nonDealer.lastError?.code === 'NOT_YOUR_TURN', 'non-dealer SELECT_TRUMP rejected');

  sendMsg(dealer, { t: 'ACTION_REQUEST', action: { type: 'SELECT_TRUMP', suit: 'hearts' } });
  await sleep(250);
  check(dealer.state?.status === 'kitty_exchange', 'trump chosen → kitty_exchange');
  check(dealer.state?.trumpSuit === 'hearts', 'trump suit is hearts');
  check(dealer.state.players[dealerSeat].hand.length === 12, 'dealer drew the kitty AFTER trump (12 cards)');

  // 5) Kitty exchange — dealer only → playing
  console.log('\n[4] kitty exchange → playing');
  sendMsg(nonDealer, { t: 'ACTION_REQUEST', action: { type: 'EXCHANGE_KITTY', discards: [] } });
  await sleep(120);
  check(nonDealer.lastError?.code === 'NOT_YOUR_TURN', 'non-dealer kitty exchange rejected');

  const discards = dealer.state.players[dealerSeat].hand.slice(0, 2);
  sendMsg(dealer, { t: 'ACTION_REQUEST', action: { type: 'EXCHANGE_KITTY', discards } });
  await sleep(250);
  check(dealer.state?.status === 'playing', 'kitty exchanged → playing');
  check((dealer.state?.currentRound.discard?.length ?? 0) === 2, 'dealer sees their own discard');
  check((nonDealer.state?.currentRound.discard?.length ?? 0) === 0, 'non-dealer cannot see the dealer discard');

  // 6) Redaction: each client sees only its own hand
  console.log('\n[5] redaction + a valid play');
  const leaderSeat = host.state.currentLeaderIdx;
  const leader = bySeat(leaderSeat);
  const otherSeat = (leaderSeat + 1) % 3;
  check(leader.state.players[leaderSeat].hand.every((c) => c.rank !== '?'), 'leader sees its own hand');
  check(leader.state.players[otherSeat].hand.every((c) => c.rank === '?'), 'leader cannot see other hands');

  // 7) Leader plays a valid card; out-of-turn play is rejected
  const leaderHand = leader.state.players[leaderSeat].hand;
  const card = getValidCards(leaderHand, null)[0];
  const offTurn = clients.find((c) => c.seat !== leaderSeat);
  offTurn.lastError = null;
  sendMsg(offTurn, { t: 'ACTION_REQUEST', action: { type: 'PLAY_CARD', playerId: seatToPlayerId(offTurn.seat), card: offTurn.state.players[offTurn.seat].hand[0] } });
  await sleep(150);
  check(offTurn.lastError != null, 'out-of-turn play rejected');

  sendMsg(leader, { t: 'ACTION_REQUEST', action: { type: 'PLAY_CARD', playerId: seatToPlayerId(leaderSeat), card } });
  await sleep(250);
  check((leader.state.currentTrick?.plays.length ?? 0) === 1, 'leader played a card (trick has 1 play)');
  check(getActingPlayerId(leader.state) === seatToPlayerId((leaderSeat + 1) % 3), 'turn advanced to the next seat');

  // 8) Reconnect a player (tab reload)
  console.log('\n[6] reconnect a player');
  const token = j1.token, j1seat = j1.seat;
  j1.ws.close();
  await sleep(200);
  const j1b = await connect();
  sendMsg(j1b, { t: 'RECONNECT', code, reconnectToken: token });
  await sleep(250);
  check(j1b.state != null, 'reconnected client received state');
  check(j1b.state.players[j1seat].hand.every((c) => c.rank !== '?'), 'reconnected client sees its own hand');

  // 9) Server restart → restore → reconnect
  console.log('\n[7] server restart → restore');
  host.ws.close(); j2.ws.close(); j1b.ws.close();
  await sleep(200);
  await killServer(server);
  await sleep(600);
  server = startServer();
  await waitForHealth();
  const back = await connect();
  sendMsg(back, { t: 'RECONNECT', code, reconnectToken: token });
  await sleep(400);
  check(back.room?.code === code, 'room restored after restart');
  check(back.state != null, 'game state restored after restart');
  check(back.state?.players[j1seat].hand.every((c) => c.rank !== '?'), 'restored client sees its own hand');

  back.ws.close();
  await killServer(server);
  rmSync(DATA, { recursive: true, force: true });

  console.log(`\n${failures === 0 ? 'E2E PASS ✅' : `E2E FAIL ❌ (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('E2E crashed:', err);
  if (server) await killServer(server).catch(() => {});
  rmSync(DATA, { recursive: true, force: true });
  process.exit(1);
});
