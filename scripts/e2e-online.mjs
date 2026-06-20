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
    // Fast bot delay so the e2e bot scenario resolves quickly.
    env: { ...process.env, PORT: String(PORT), ROOM_STORAGE_FILE: STORE, BOT_DELAY_MS: '40' },
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
  const c = { ws, clientId: null, token: null, seat: null, room: null, state: null, lastError: null };
  ws.on('message', (m) => {
    const o = JSON.parse(m.toString());
    if (o.t === 'WELCOME') { c.clientId = o.clientId; c.token = o.reconnectToken; c.room = o.room; }
    if (o.t === 'ROOM_UPDATE') c.room = o.room;
    if (o.t === 'STATE_UPDATE') c.state = o.state;
    if (o.t === 'ROOMS_LIST') c.roomsList = o.rooms;
    if (o.t === 'KICKED') c.kicked = o;
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

  // 2b) Full room rejects an extra joiner
  const extra = await connect();
  sendMsg(extra, { t: 'JOIN_ROOM', code, name: 'Late', password: 'secret' });
  await sleep(150);
  check(extra.lastError?.code === 'ROOM_FULL', `full room → ROOM_FULL ("${humanError(extra.lastError?.code)}")`);
  extra.ws.close();

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
  for (let step = 0; step < 80 && !botPlayed; step++) {
    const ref = bHost.state;
    if (!ref || ref.status === 'round_scoring' || ref.status === 'game_finished') break;
    const actingId = getActingPlayerId(ref);
    if (!actingId) { await sleep(100); continue; } // trick_complete → server timer
    const seat = Number(actingId.split('-')[1]);
    const human = humansBySeat[seat];
    if (!human) { // bot's turn → wait for the server to act, then look for a bot play
      await sleep(100);
      const all = [
        ...(bHost.state.currentRound?.tricks ?? []).flatMap((t) => t.plays),
        ...(bHost.state.currentTrick?.plays ?? []),
      ];
      if (all.some((p) => p.playerId === botSeatId)) botPlayed = true;
      continue;
    }
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
