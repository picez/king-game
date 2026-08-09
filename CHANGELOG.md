# Changelog

All notable, user-facing changes to **Card Majlis**. This is a concise release
snapshot, not the full stage-by-stage history (see the git log for that).

The format loosely follows [Keep a Changelog](https://keepachangelog.com/); the
project uses [Semantic Versioning](https://semver.org/). The running version is
also reported at `GET /health/diagnostics` (`version` field).

## [Unreleased]

### Fixed

- **The table no longer shrinks when you open the chat (Stage 38.0.16).** Opening the chat
  used to take its space out of the game: in Durak the felt fell from 650px to 304px on a
  tablet and from 706px to 315px on a 1920 desktop — less than half the table — and opening
  the sticker picker took more still. The hand and the action buttons jumped ~330px down
  the page, and on a wide screen the board also lost 15px sideways the moment a scrollbar
  appeared.
  The game and the chat are now two separate regions. Whatever you open, the table, the
  seats, the deck, the melds, your hand and the action buttons stay exactly where they
  were, to the pixel — measured in all seven games at 360, 390, 768, 1366, 1920 and 2560,
  in Arabic too. The chat follows the whole game scene: the page gets taller and you scroll
  to it, and nothing is taken away from the table.

- **The game uses the whole screen again on a wide monitor (Stage 38.0.16.1).** The first
  attempt at the fix above kept a column permanently reserved for the chat on screens wider
  than 1620px. It did stop the table changing size when you opened the chat — by making it
  smaller all the time. With the chat **shut**, 376px was held back from the game: the
  Syrian 51 table ran 1528px wide on a 1920 screen instead of ~1904, and 2184 instead of
  2560; Preferans lost the same. That reservation is gone. The game now spans the full
  width in every state, on every screen, and the chat opens below the scene.

### Added

- **Send a line and an animated sticker as one message (Stage 38.0.16).** You could send
  text, or a sticker, but never both: tapping a sticker mid-sentence posted it on its own
  and left your typing behind.
  Now, while you are writing, a sticker **attaches** to what you are writing. A small
  preview appears above the message box with an ✕ to take it off, you carry on typing, and
  Send posts **one** message with your words and the animated sticker in the same bubble.
  Picking another sticker swaps it rather than sending anything; one sticker per message.
  With nothing typed, tapping a sticker still sends it straight away, as it always did, and
  old messages in the history look exactly as they did before.

- **One set of emoji in the chat picker (Stage 38.0.15).** An interim build split them into
  two labelled rows — "Into your message" and "On the table" — which simply showed every
  emoji twice: measured in the real Durak, Syrian 51 and Poker tables at 360 and 390, in
  Arabic too, 14 buttons for 7 emoji. The duplicate row and both headings are gone.
  There is now **one row of emoji**, and the same button does the right thing:
  - while you are **typing**, it drops the emoji into your message at the cursor — nothing
    is sent, nothing you typed is lost, the keyboard stays up, and the line leaves only
    when you press Send;
  - when you are **not typing**, it throws the emoji onto the table over your seat, once,
    and whatever is in the message box stays exactly as it was, untouched.
  Which of the two happens is decided the moment your finger lands, so a keyboard closing
  under your thumb can no longer change what your tap meant. Stickers are unchanged: a
  sticker is a message, so it is still sent straight away, all 253 of them.

- **The chat no longer takes over the game (Stage 38.0.14).** Stage 38.0.13 (below) gave
  every game the same chat window — as a pop-up over the table, and that was worse than
  the problem it solved. While it was open the whole game was dimmed behind it, the page
  would not scroll, and taps meant for your cards or the Call/Draw/Take buttons hit the
  chat instead: measured across all seven games, pressing a legal card **did nothing at
  all** while the turn timer kept counting down. In Durak the chat sat on the table and
  the cards; in Syrian 51 on the melds and the action row.
  The chat is now an ordinary panel **on the page**, not over it. It opens between the
  table and your hand and simply takes up space there — no dimming, no pop-up. You can
  read the chat and keep playing: your cards and the action buttons stay live, a move goes
  through without closing the chat, and the chat stays open when the next state arrives
  from the server. The timer, voice, "Leave game" and "Quit for good" ride in the same
  compact row of buttons, and Poker's action history keeps its own place.
  On a phone the panel is a full-width card with a capped height, so your hand is one
  short scroll below it; on a wide screen it is the same card, capped so it does not
  stretch across the table. Everything else is unchanged — stickers still send straight
  away, and the emoji work as described under Stage 38.0.15 above.

### Changed

- **The chat now looks and behaves the same in all seven games (Stage 38.0.13).** Stage
  38.0.12 (below) gave every game the same chat *functions* and said that was enough. It
  was not: pressing 💬 still opened a different-looking chat depending on the game. In
  Durak, King, Deberc, Tarneeb and Preferans it was a tall panel down the right-hand edge
  of the screen with no dimmed background; in Syrian 51 a small window at the bottom with
  one; in Poker a box wedged in above the betting buttons. Measured side by side on a
  390px phone: 320×844, 390×544 and 371×400 — three chats, one component.
  Now there is **one chat window**. It opens from the same 💬 button, over a dimmed
  background, as a sheet at the bottom of a phone and a compact centred card on a desktop
  — the same size, the same rounded corners, the same layout in every game, in Arabic
  too. The page behind it no longer scrolls while it is open. Poker's action-history panel
  keeps its own place; only the chat was unified.
- **Emoji no longer need a mode to be chosen (Stage 38.0.13).** The "To message" / "To
  table" buttons are gone. The chat simply follows what you are doing:
  - if you are **typing** (the message box is active), tapping an emoji drops it into your
    message at the cursor — nothing is sent, nothing you typed is lost, and the keyboard
    stays up;
  - if you are **not typing**, tapping an emoji throws it onto the table over your seat,
    once, and whatever is left in the message box stays exactly as it was.
  Tap the message box to switch to typing; tap the conversation to switch back. A small
  line above the emoji says which one will happen. Opening the picker or tapping an emoji
  can no longer steal the cursor and change what your tap meant. Stickers are unaffected:
  they are always sent as a message, whatever you are doing.

- **One chat, one emoji picker, in all seven games (Stage 38.0.12).** The room panel used
  to differ from game to game: Syrian 51 had a messenger-style chat whose emoji typed into
  the message but could not be thrown on the table, while the other six had a separate 😀
  button whose emoji only flew over the table and a chat with no emoji at all. Every game
  now has **one 💬 button**. Inside it: the conversation, the message box, Send, and one
  😀 button next to the field that opens a picker underneath — with a visible switch for
  what an emoji does:
  - **To message** — it is typed in at the cursor, so you can drop it into the middle of a
    half-written line and keep going;
  - **To table** — it flies over your seat for everyone, exactly as the old reactions did.
  Stickers send straight away. Nothing you send closes the chat or the picker, the message
  box is always reachable, and the conversation stays visible beside the picker instead of
  being pushed off screen (it used to shrink to 80px on a phone and to nothing on a large
  screen). Escape closes the picker first and the chat second.

### Added

- **160 new animated stickers in the room picker (Stage 38.0.11).** The sticker grid grew
  from 93 to 253 items. Only genuinely new pictures were added: every candidate was compared
  by content, so a sticker that was already there under a different file name was skipped,
  and none of the existing stickers changed, moved or lost its id — the new ones are simply
  appended after them. They are the original animated GIFs, copied untouched (no re-encoding,
  no flattening, transparency intact).

### Fixed

- **Six things the owner hit in Syrian 51 and the room panel (Stage 38.0.9).**
  - **Reactions no longer close the panel.** Sending an emoji or a sticker used to shut the
    room sheet, so firing a few in a row meant re-opening it every time. It now stays open
    on the Reactions tab, right where you were. Only ✕, the backdrop, Escape or the button
    that opened it close it. The other games' floating/docked panels are unchanged.
  - **Stickers are shown in full.** Each one was being squeezed into a thin horizontal band
    (measured: a 37-pixel-tall image inside an 81-pixel cell). Every sticker now fills its
    own square, at any screen width, and the grid picks 3–5 columns to fit.
  - **Melds are compact again.** A player's melds used to be blown up to half the screen and
    stretched down to match a taller neighbour, leaving a large empty area. Each player's box
    now ends right after its last card and is only as wide as its longest combination.
  - **You can add to the START of a run.** Laying `5♠` onto `6♠ 7♠ 🃏` was refused, because
    the card was always appended to the end. Cards may now join either legal end, and the
    joker keeps the card it already stood for.
  - **You choose the joker's side.** Adding a joker to `4♠ 5♠ 6♠` is legal at both ends —
    as `3♠` at the start or `7♠` at the end. A small dialog now shows both and lets you pick;
    when only one end is legal it simply happens, with no dialog.
  - **`6♠ + 🃏 + 8♠` works without reloading.** Occasionally a perfectly valid combination
    could not be laid until the page was reloaded. A move that changed your cards without
    changing how many you held (swapping a joker back, for instance) left the selection
    pointing at cards that no longer existed. The selection is now checked against your real
    hand after every update instead of being guessed from the number of cards.

### Fixed

- **Two holes in the new Poker anti-dumping limits (Stage 38.0.8.1).**
  - **Two tables at once.** Two people could open two paid tables together at the *same
    moment* and both would be funded, because the limit only looked at matches that had
    already finished. A match that is still being played now reserves its players until it
    resolves, and the check is taken under a database-level lock — so only one of two
    simultaneous starts can ever succeed, even across server instances. Nothing is charged
    for the one that is refused.
  - **A damaged setting no longer removes the limits.** If the small record that says which
    rules a table is playing under got corrupted, the table used to fall back to "no limits,
    fully counted". It now fails the safe way instead: no further rebuys, the match does not
    count towards the Poker rating, and no new paid table can start until that one is
    properly finished. Chips are never affected — the payout and the refund still work
    exactly as before, and nothing is confiscated.
  - Neither fix changes any limit: still 2 rebuys per player per match, a 15-minute wait
    between paid tables for the same people, and the first three finished matches a pair
    plays each day counting towards the rating.

### Changed

- **Online Poker now limits how fast chips can move between the same players (Stage 38.0.8).**
  This is a **mitigation, not a guarantee**: in a cash game that pays the final stacks into
  permanent wallets, a deliberate loss cannot be reliably told apart from bad play. What
  changed is the *speed* and what it *counts for*.
  - **At most two rebuys per player per match.** After that a busted seat is out for that
    match. The table shows how many you have left.
  - **A 15-minute wait between paid tables for the same people.** If two of you just finished
    a paid match together, a new paid table with that line-up — a rematch *or* a brand-new
    room — waits a little. You are told roughly how long, never who caused it, and nothing is
    charged. You can always play locally without chips in the meantime.
  - **Only the first three paid matches a pair finishes each day count.** Beyond that the
    table still plays and still pays out exactly as before — it just does not affect the Poker
    rating, win statistics or achievements. The host is asked to confirm that **before** any
    chips are taken, and every seat sees a **Ranked** / **Unranked** badge.
  - **Nothing is ever confiscated, and a refund is never blocked.** All of this happens before
    a buy-in is charged; if it says no, no chips moved and no table was created.
  - **Local pass-and-play Poker is completely unaffected** — no wallet, no limits, unlimited
    rebuys — and the other six games are untouched. Matches already in progress when this
    shipped keep the old rules until they end.

### Added

- **See your online record, per game (Stage 38.0.6).** Profile → Statistics opens with a new
  **Online matches** block above the detailed stats. Pick **Overall** or a single game and you
  get two cards side by side — **People only** and **With bots** — each showing matches, win
  rate, wins, losses, draws and how many times a game was quit for good.
  - **Online only.** Local pass-and-play is never counted; only games played in an online room
    appear here. Poker is not included yet — it is being tested separately.
  - **People-only and with-bots are never mixed.** Which one a match belongs to is decided when
    it starts and never changes afterwards, so a bot taking over a seat cannot move a
    human-only game into the other column.
  - **A match counts once it has a result.** A game you are still playing is not counted; a
    game you quit for good counts immediately, as the single loss it is.
  - Everything else on the page is unchanged: the detailed per-game statistics, the ratings,
    the achievements and the leaderboards all keep working exactly as before, and a brand-new
    account simply sees zeros instead of a missing block.

### Fixed

- **Quitting for good now always finishes the job (Stage 38.0.5.1).** If the match happened
  to end in the split second between your loss being recorded and your seat being handed
  over, the app told you the departure was complete while your seat, your reconnect link and
  your account's claim on the room were all still alive — and no bot ever took over. The
  hand-over is now unconditional once the loss is written: the seat is always vacated, the old
  reconnect link always stops working, a bot always takes over if anyone stays, and the room
  closes if nobody does. A finished match is never restarted and no bot move is played after
  it. There is still exactly one loss, and the final result of the match can never overwrite
  it. Double-tapping the confirm button now also sends a single request, and a late refusal
  can no longer re-open a table you have already left.

### Changed

- **Syrian 51 got its table and its chat panel redesigned (Stage 38.0.4.1).** The owner's
  phone showed a full-width strip of social buttons wedged between the melds and the prompt,
  and every laid-out combination as its own bulky dark card repeating the owner's name.
  - **One button instead of a toolbar.** Chat, reactions, voice and *Quit for good* now live
    behind a single icon in the 51 top bar (with the unread-message badge on it) that opens a
    sheet you can close with the ✕, the backdrop or Escape. Collapsed, the game column has no
    social row at all; the turn timer moved up to the top bar next to it. The other six games
    keep the layout they already had.
  - **Melds now read like cards on a table.** They are grouped by player: the name appears
    once per group with that player's total, and each combination is a compact `Run · 30` /
    `Set · 36` row of cards underneath. Cards never overlap, are never cut off, never hide
    behind a sideways scrollbar and keep their proper proportions; long runs wrap onto the
    next line in order. Add-to-meld and joker-replacement are small icon buttons in the
    combination's own row, shown only when you can actually use them.
  - Card order inside a meld is unchanged — it is a rule of the game, not a display choice.

### Added

- **Quit an online game for good (Stage 38.0.5).** Every active online game except Poker
  now has a third, deliberately separate exit next to the reversible one. The ✕ / **Back to
  menu** still only drops your connection — your seat waits and **Resume** still works — and
  **Leave lobby** before the start still costs nothing. **Quit for good** is the irreversible
  one, and its confirmation says exactly what will happen before you commit: you cannot come
  back, a technical loss is recorded for you, a bot takes your seat if anyone stays, and the
  room closes if nobody does.
  - **Nothing happens until it is safe.** The loss is written to the database first; only
    after that does the seat change hands. If the write cannot be completed the request is
    refused, the table keeps playing, and your seat, your reconnect link and your saved
    session are all exactly as they were — so you can retry, or just use Back to menu.
  - **The table is not disturbed.** The bot lands on the *same* seat, so turn order, dealer,
    teams, contracts, melds and the running turn timer are untouched — no seat is re-numbered
    and nothing is re-dealt. If it was your turn, the bot plays it once. If you were the host,
    the badge moves to another *person*, never to a bot.
  - **The way back is really closed.** Your old reconnect link stops working, the account
    reclaim from another device stops working, and the room disappears from "your active
    rooms". A stale **Resume** card now clears itself instead of failing forever.
  - **Results stay honest.** Whether a match counts for your stats is decided when it
    *starts*: a table that began human-only still counts after a bot replaced someone, and a
    table that began with bots still does not. Whoever stays gets their real final result,
    the player who quit gets exactly one loss and never a second one — not even if the bot
    that inherited the seat goes on to win — and a teammate is never punished for someone
    else quitting. Bots never earn anything for the person who left.
  - **Migration 0014** adds the online-match record behind this (which match, which seats,
    which outcome). It only adds tables — existing stats and leaderboards are untouched, and
    the Poker chip economy is not part of this at all.

- **Poker between-hands rebuy — local play (Stage 38.0.3B).** A player whose stack hits 0
  is no longer eliminated on the spot: the match pauses in an explicit rebuy window under
  the hand review, and the busted seat can buy back in for exactly one starting stack.
  - **Local tables:** free, and the device owner decides for **every** busted seat —
    human *or* bot — so a solo player can keep an opponent in the game. An explicit
    **Continue** closes the window; whoever declined (or was left undecided) is eliminated
    then, and only then does the match end or deal on. No wallet, network or DB involved.
  - The pure core gained the `rebuy_window` phase with `REBUY` / `DECLINE_REBUY` /
    `CLOSE_REBUY_WINDOW`; the amount is always derived from the configured starting stack,
    never from the action, and a duplicate or illegal action is a strict no-op. Chip
    conservation now tracks `initial chips + confirmed rebuys`.
  - **Migration 0013** widens the `poker_ledger.reason` CHECK with `table_rebuy` — the
    reason the online debit will use. It cannot reuse `table_buy_in`: durable ownership
    requires exactly one initial buy-in row per participant and treats any extra as
    corrupt evidence. Online bankroll tables are unchanged for now — the server closes the
    reason cannot be `table_buy_in`: durable ownership requires exactly one initial buy-in
    row per participant and treats any extra as corrupt evidence.
  - **Online bankroll tables (Stage 38.0.3C):** the busted player gets a real, wallet-backed
    rebuy. The window is server-authoritative and lasts **20 seconds** — an absolute
    deadline that a reload, reconnect or restart cannot extend, closing early once everyone
    has answered, treating silence as a decline, and never closing over a debit in flight.
    The client sends an **empty** intent; the server derives the room, account, seat, match,
    hand and amount. Each debit is one immutable ledger row, so a double tap or a replay
    charges exactly once, and a crash between the debit and the table update is reconciled
    exactly once. A payout now pays the **funded total** (buy-ins + rebuys) and a
    cancellation refunds each account its buy-in plus its own rebuys; anything that cannot
    be proven freezes the table instead of guessing. Only your own seat shows a balance —
    everyone else sees a public decision status. [`POKER_RULES.md §17`](POKER_RULES.md)

### Fixed

- **Leaving an active online game no longer disturbed the other players.** During a live
  match, "leave" used to delete the seat outright and re-number everyone else's — quietly
  shifting turn order, dealer and teams mid-game. It is now what it always claimed to be:
  the lobby-only action in the lobby, and an ordinary reconnectable disconnect during a
  game. King's in-game ✕ behaves like the other five games again.

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Poker mobile layout (Stage 38.0.3)** — two defects the owner hit in production,
  both reproduced as measured rectangle intersections before being fixed.
  - **The social buttons no longer cover the betting controls.** The history / voice /
    emoji / chat cluster was a FIXED corner overlay, so on a phone it sat on top of the
    action row — measured at 208×74 px over it, covering Call/Check, the amount field,
    the presets and the slider; an open chat or history panel covered them too. Poker
    now renders that cluster as a compact horizontal toolbar in NORMAL FLOW between the
    table and the action row, with any open panel as a normal-flow sibling beneath it,
    and exactly one panel open at a time. The toolbar scrolls sideways if it must; the
    page never does; every control keeps a 44×44 tap target and the safe-area inset.
  - **Four-player side seats no longer sit on the board.** The side seats shared the
    felt's vertical middle with the community cards, so on a 360/390 screen the pods
    covered the board and the pot. The board, pot and street label now own a reserved
    centre band of the felt that no seat may enter, and the pods/cards shrink on narrow
    phones. Verified for 2/3/4/5/6 players across pre-flop→river, long names, all
    badges, folded/all-in/out seats, LTR and Arabic RTL, at 360/390/desktop.
  - New gate `npm run layout:poker` (`scripts/poker-layout-qa.mjs`) renders the real
    components in a real browser and fails on ANY pod/board/pot/control intersection,
    page overflow or sub-44px control: **1484 violations → 0** across 186 checks.

### Changed

- **Poker UX corrections (Stage 38.0.2)** — five owner-confirmed fixes; no rules,
  engine, economy, schema or dependency change.
  - **Chips where you need them.** The chip balance and the **Get 1,000,000** daily
    claim moved from **Profile** into the **Poker host flow of the start menu**, right
    above the stakes picker. The menu now owns **one** wallet store shared by the wallet
    card and the stakes picker, so a claim refreshes the balance **and** the buy-in
    affordability instantly — no reload, and never two balances that disagree.
    "Economy unavailable" is shown only for a real `503`.
  - **A much lighter table.** The felt was too dark to read: it is now a lit green
    centre fading to a slightly deeper rim inside a visible wooden rail, with a dark
    plate behind pot/street, clearer empty board slots and stronger acting/my-seat
    states. Seat geometry, viewer-bottom positioning and the RTL-stable physical layout
    are unchanged — verified at 2/4/6 seats on 360/390/desktop in LTR and Arabic RTL
    (0 clipped seats, 0 horizontal overflow; this also fixed a pre-existing overlap of
    the pot row with the side seats at 360).
  - **Type an exact bet.** The bet/raise controls gained a **manual numeric field**
    beside the slider and the Min/½ Pot/Pot/All-in presets, all driving one amount and
    showing the allowed min–max. The field may be blank while editing; every commit
    (blur, **Enter**, or the Bet/Raise button) is validated as a finite safe integer and
    clamped to the legal window, so an unusable draft can never send an illegal action.
    Enter does exactly what the button does; the maximum is still sent as ALL-IN.
  - **History next to chat.** The action history is no longer a block under the table.
    It is a compact button in the bottom-end control cluster — online inside the
    RoomSocial cluster next to chat/emoji/voice/timer, locally in a matching cluster —
    default closed, with an **unread dot** cleared by opening, and the last 30 public
    entries (seat, action, amount only).
  - **No more "Your turn" before every move.** In local play with **one human and bots**
    the handover screen is gone entirely and that player keeps their hole cards across
    bot turns. With **two or more humans** the confirmation now sticks to its seat:
    A → bots → A no longer re-prompts, while A → bots → B (and A → B) still hands over
    privately, and no human's cards are shown while a bot acts.
    [`POKER_RULES.md §14 / §16 I`](POKER_RULES.md)

### Added

- **Poker bankroll economy + real table UI (Stage 37.7).** A full bankroll layer for
  online Poker plus a reworked table.
  - **Chip wallet + daily claim.** Every signed-in (non-guest) account has a chip
    **wallet** (`GET /api/me/poker-wallet`) and can **claim exactly 1,000,000 chips once
    per UTC day** (`POST /api/me/poker-wallet/daily-claim`), shown on Profile → account.
    Balances are `BIGINT`, **never negative**; every change appends an **immutable,
    idempotent ledger** row (migration 0010: `poker_wallets` + `poker_ledger`).
  - **Configurable tables.** The host picks one of **8 stakes presets** (25/50 …
    3200/6400); the **buy-in is always 100 big blinds**, derived server-side. Optional
    **blind growth** every N hands (Off/3/5/10 or custom 1–100). **Local** free-play adds
    a **starting-stack selector** (1k–1M presets + custom) and never touches the wallet.
  - **Atomic escrow.** At match start every seat's buy-in is debited in one
    all-or-nothing transaction; final stacks are paid back at finish; an abandoned funded
    table is refunded — all **idempotent** (reconnect/restart-safe) and payout/refund
    mutually exclusive. Bankroll rooms are **authenticated-humans-only** (no bots).
  - **New oval table UI** with 2–6 seats positioned around the felt, dealer button,
    central pot/board, per-seat stacks/bets/state, a **showdown review** that highlights
    the exact five winning cards + the localized combination (server-paced ~7 s), an
    in-table **hand-rankings Help** modal, and a **collapsible action log**. RTL-stable
    seat geometry. EN/UK/DE/AR. [`POKER_RULES.md §16`](POKER_RULES.md)
  - **Lifecycle hardening (Stage 37.7.1):** online Poker is **bankroll-only** (no free/guest
    table); **rematch is a brand-new paid match**; payout ↔ refund are **DB-authoritative
    mutually exclusive** (migration 0011 `poker_match_settlements`); a restored transient
    escrow is **reconciled** on restart; every lifecycle op is **serialized per room**; and
    payouts are refused unless Σ(final stacks) == Σ(buy-ins).
  - **Crash durability + auth-seat hardening (Stage 37.7.2):** a **durable match record**
    (migration 0012 `poker_matches`) commits atomically with the buy-in, so a crash between the
    debit and room persistence can still be recovered — a startup scan refunds any orphaned
    committed match exactly once. Bankroll **player seats now require a signed-in non-guest
    account** (stamped atomically at join; one seat per account; guests may spectate). Delayed
    async CREATE/JOIN are **cancellable** (no stale/duplicate rooms); navigation can't reshape a
    table mid-lifecycle-op; malformed persisted escrow **fails closed**; and an idempotent wallet
    repeat can no longer falsely throw Insufficient/Overflow (verified on a real PostgreSQL).
  - **Target-room JOIN serialization + durable fail-closed (Stage 37.7.3):** a JOIN into a
    **busy** bankroll table is refused (target checked, not just the current room), and START
    verifies the escrow seats still equal the seated players; a delayed JOIN whose target was
    deleted creates no ghost; the durable-seats parser is **all-or-nothing** (a corrupt record is
    left unresolved, never partially refunded); `recordMatchTx` rejects conflicting matchId
    metadata; a recovered room whose buy-ins were refunded is **cancelled/frozen** (never a free
    continuation); every session transition cancels a pending async CREATE/JOIN; and the Poker
    host's account id is stamped atomically at creation. All verified on a real PostgreSQL.
  - **Recovery-state reset + no-DB fail-closed (Stage 37.7.4):** a recovery-**cancelled** lobby
    becomes a fully playable new paid match on START (buy-in debited once, flag cleared atomically,
    actions/timer/advance unblocked, pays out at finish); a restored funded table with **no chip
    economy** fails closed (no advance/action/start/rematch — `ECONOMY_UNAVAILABLE` — escrow + state
    kept for a DB-backed restart, never cancelled without DB proof); durable seats are bounded to
    0–5; `recordMatchTx` validates fresh metadata before insert; a canceled async CREATE/JOIN sends
    no stale error; and a minimal public recovery banner (cancelled/frozen) leaks no economy data.
  - **Recovery retry + real recovery UI (Stage 37.7.5):** START after a refund/recovery now works —
    a new `debitFreshStart` mints a **brand-new matchId + escrow** over a terminal (settled/cancelled)
    escrow and debits once (old ledger untouched); a rematch whose restart fails refunds once and
    leaves a persisted cancelled lobby a fresh start can use; and the public recovery status is finally
    **shown in the UI** — a `PokerRecoveryBanner` in the lobby/table (cancelled → start a new match /
    frozen → Start disabled), EN/UK/DE/AR, wrapping cleanly on 360/390 + Arabic RTL, with no economy
    data leaked. Verified end-to-end on a real PostgreSQL.
  - **Refund-failure safety + read-only recovery table + Poker rematch (Stage 37.7.6):** every
    place that refunds a buy-in on a failed start/rematch now **checks the refund result** instead
    of assuming success — a refund that can't be confirmed (transient DB failure) keeps the escrow
    **funded and retryable**, is surfaced honestly as **“Settlement pending — table temporarily
    unavailable”** (never a false “refunded”), and a background sweep completes it exactly once; only
    a **confirmed** refund flips the table to a fresh-startable cancelled lobby. A funded escrow that
    reaches START from a clean lobby is treated as an **orphan** (never silently reused as a “fresh”
    match) — it is refunded first, or the start **fails closed** as settlement-pending. The recovery
    **table UI is now fully read-only** (frozen / settlement-pending hide every Fold/Check/Call/Bet/
    Raise/All-in and next-hand control, banner explains why), and **online Poker finally has rematch**
    — the shared ready-up `RematchControls` on the finish screen starts a new **paid** match only after
    the previous one has settled (suppressed entirely under recovery). EN/UK/DE/AR. Fault-injection +
    real-PostgreSQL tests confirm no double debit/refund/payout and the payout↔refund mutex holds.
  - **Payout-failure recovery + verified rematch lifecycle (Stage 37.7.7):** the finished-table
    **payout** now has the same recovery safety the refund path already had. `payoutStacks` returns an
    explicit result (paid / already-paid / already-refunded / retry-pending / invalid); a **transient
    payout failure** leaves the escrow funded and surfaces a new honest **“payout pending”** state
    (a background sweep retries it with the authoritative final hand and pays out **exactly once**), so
    a finished paid table can no longer hang without paying or offering a misleading rematch. A finished
    match the settlement gate reports as **already refunded** is turned into an honest cancelled table
    (never shown/continued as paid). **Live match / refund-pending / payout-pending** are now distinct
    (a live game is never refunded by cleanup). Online **rematch waits for the confirmed payout** — the
    ready-up controls are hidden while any recovery is pending and a rematch is refused with an honest
    banner instead of a silent readiness reset. The rematch lifecycle was extracted into a unit-tested
    helper (`runBankrollRematch`) and verified end-to-end on real PostgreSQL. The recovery banner is now
    rendered **exactly once** per state (the duplicate on the finished screen is gone). EN/UK/DE/AR.
  - **Settlement-before-stats + permanent invalid freeze (Stage 37.7.8):** a bankroll match's
    **stats/rating/achievements are now recorded only after a confirmed payout** — never before, never
    in parallel. Payout and stats run as one serialized flow: a transient payout failure defers the
    stats (the sweep records them after it finally pays out), an **already-refunded** match records
    nothing (and becomes a cancelled table), and an **invalid** payout (impossible conservation — a
    fail-closed operator condition, not a transient error) now **permanently freezes** the table for
    review instead of retrying the impossible payout every sweep. A frozen table blocks start/action/
    rematch, shows only the public *frozen* status (no economy leak), and survives restart. The
    request-level rematch handler was also extracted so the real REMATCH_READY/DECLINE path
    (authorization, one-vs-all readiness, decline, recovery-blocked, no double-restart) is unit-tested.
  - **Finish/rematch correctness hardening (Stage 37.7.9):** three real defects fixed. (1) Two
    consecutive paid matches in the same room that ended with an **identical result** collided on the
    durable stats key, silently dropping the second match's stats — bankroll stats identity now comes
    from the **stable unique escrow match id** (hashed; never exposed), so every paid match is recorded
    once. (2) A payout that **succeeded** but whose stats write then failed transiently could lose the
    stats forever (the escrow was already settled, so nothing retried) — a paid finish with an owed
    stats write is now a **persisted stats-pending** state that blocks a new paid rematch (but never
    re-pays), is retried by the background sweep until it records **exactly once**, and survives a
    restart. (3) A rematch queued behind a busy room lock could still start (and debit new buy-ins)
    after a player **declined / disconnected** or the table entered a recovery state while it waited —
    the lock body now **re-validates** finished + not-recovery-blocked + everyone-still-ready before
    starting, so withdrawn consent is never acted on.
  - **Paid-finish recovery + teardown correctness (Stage 37.7.10):** three more real defects fixed.
    (1) On a real server **restart**, a restored bankroll table whose match was already **paid out**
    (settled) was mis-classified as a refund — its finished result was wiped and the owed stats lost;
    bootstrap now distinguishes a live match, a payout still owed, a **paid finish** (keep the result,
    finalize stats), a refund, and a frozen table, so a settled/paid finish is never cancelled. (2) When
    the last players **left** a finished table, teardown paid out and deleted the room without ever
    recording the stats; teardown now runs the **same settle→stats lifecycle** as a normal finish and
    never deletes a paid table until its stats are recorded (a transient failure keeps the table for a
    retry; the payout is never repeated). (3) A finished match's stats were attributed from the *current*
    seats, so a valid human-vs-human match recorded **nothing** once players left — attribution now comes
    from the **immutable participant snapshot** captured at buy-in, so both players are always credited
    correctly. The finished screen also no longer flickers "rematch available" for an instant between the
    payout and the results being finalized.
  - **Fail-closed recovery of incoherent paid tables (Stage 37.7.11):** two more real defects fixed.
    (1) After a crash, a table whose chips were **already paid out** but whose saved state was still
    *mid-hand* was restored as a **live game** — it could take timers, bot steps and player actions
    after the money had left, and a teardown would have deleted it outright. Such a table is now
    recognised as an **incoherent paid state** and **frozen for review**: never resumed, never paid or
    refunded again, never deleted, and shown to players only as a paused table. No table of any kind
    resumes now until the chip-recovery check has classified it. (2) A **structurally impossible**
    paid match (seats that don't match the finished hand, a duplicated seat/account, a wrong buy-in, a
    bot seat, an impossible winner) could still reach the stats writer and store a **partial, wrong
    result**. Payout and stats now share **one strict participant check**, so such a match records
    nothing at all and is frozen for review instead of being retried forever.
  - **A table's chips are tied to the hand that was actually dealt (Stage 37.7.12):** two more real
    defects fixed. (1) A **rematch** takes the new buy-ins *before* the new hand is dealt. If the
    server died in that window, the saved table held the **new buy-ins next to the previous hand's
    final result** — and recovery paid the fresh money out to the *previous* winner and recorded the
    old result a second time, all without a single card being dealt. Every table now durably records
    **which paid match produced its current hand**, and no payout, no result and no stats can ever be
    written unless the two match. A buy-in whose hand never started is **refunded exactly once**
    instead (a transient failure keeps retrying, and such a table is never deleted before the refund
    is confirmed); afterwards the table is a clean lobby a new match can use. An older saved table
    with no such record is **frozen for review** rather than guessed at. (2) The strict paid-match
    check now also proves the hand is genuinely **finished**: a mid-hand table, a missing/unknown
    winner, a non-human or duplicated seat, a stray extra seat, or final stacks where the winner does
    not hold exactly the whole pot are all rejected — nothing is paid, nothing is recorded, and the
    table is frozen for review.
  - **Startup settlement ordering + honest "still settling" tables (Stage 37.7.13):** two more real
    defects fixed, one of them a **correction to the previous entry**. (1) Stage 37.7.12 stated that a
    table whose paid match cannot be identified is frozen *without any payout or refund*. In
    production that did not actually hold: on startup the automatic "refund abandoned buy-ins" sweep
    ran **before** the tables had been classified, so such a table's buy-ins were refunded seconds
    before it was frozen — leaving a frozen table whose money had already gone back. Startup now
    classifies every table first and only then sweeps, and every table that is live, frozen, or whose
    outcome is not yet proven is **protected** from that sweep. Only a buy-in that is *provably*
    nobody's — an explicitly stale one whose hand never started — is still refunded, exactly once.
    (2) A table whose buy-in was still **in flight** when the server stopped could be declared a
    clean **cancelled** match even though the server had not been able to check whether the chips
    were actually taken (a temporary database problem, or a half-written charge). Such a table is now
    held as **"still settling"** instead: it keeps its hand and its record, plays nothing, accepts no
    actions, is never deleted, and is retried — and only becomes a cancelled lobby once the database
    **proves** nothing was ever charged. A half-charged table is frozen for review rather than being
    guessed at in either direction.
  - **Tables that were "still settling" now really do recover by themselves (Stage 37.7.14):** three
    more real defects fixed, one of them another **correction to the previous entry**. (1) Stage
    37.7.13 said such a table would be retried "on the next pass". It was not — the periodic
    background check never re-asked the database, so a table caught by a momentary database problem
    stayed unplayable until the server was restarted. Worse, for a table whose buy-in belonged to a
    hand that never started, that same background check threw away the table's record of which hand
    it was **before** the database had confirmed anything. The background check now re-asks the
    database first, and nothing is refunded, paid, recorded or cleared until the answer is in; a
    revived table resumes exactly once. (2) When a table's saved file said "buy-in still in progress"
    but the database had **already** paid out (or already refunded) that match, the payout/refund was
    ignored and the table could resume a hand whose chips were gone. A committed payout or refund now
    always wins over whatever the saved file says. (3) A table whose durable buy-in record was
    **damaged** could still be resumed as a normal game; it is now frozen for review before anything
    else happens — never advanced, never paid, refunded, recorded or deleted, with everything kept
    intact for the operator and only an opaque "paused" status shown to players.
  - **A table's buy-in record is now checked against the table itself (Stage 37.7.15):** three more
    real defects fixed, two of them **corrections to the previous entry**. (1) The new "damaged
    record" check matched records to tables by **table code**. Codes are four characters and are
    reused once a table is gone, while a damaged record can sit in the database indefinitely — so a
    brand-new, perfectly healthy table could be frozen forever because it happened to reuse an old
    table's code. Records are now matched to the exact match they belong to, and the code is only
    kept as context. (2) The check only asked whether the record could be *read*. It never proved
    the record — and the individual chip charges behind it — actually belong to that table, so a
    table whose record was **missing**, described a **different** match, or whose charges had the
    right count but the **wrong accounts, amounts or table** could still be resumed as a normal game.
    A table now only resumes after its record and every individual buy-in charge match it exactly;
    anything else is frozen for review with nothing paid, refunded, recorded or deleted (a temporary
    database problem is still just a retry, not corruption). (3) The claim that operator logs never
    contain internal match identifiers was not true — several economy log lines printed them. All
    poker economy logs now carry only the table code, a short reason and counts.
  - **Paying or refunding a table now proves whose table it is, at the moment it pays (Stage
    37.7.16):** four more real defects fixed, all **corrections to the previous entry**. (1) The new
    ownership check was skipped entirely whenever the table had already been paid out or refunded —
    so a paid table whose buy-in record was missing or described a different match was still treated
    as a healthy finished game, and its result could be **recorded against the wrong accounts**; a
    refunded one silently erased the evidence an operator would need. A completed payout or refund
    now only tells us what happened to the chips — never whose table it was; both facts must hold.
    (2) Tables whose saved file already said "paid" or "refunded" were never checked at all. A saved
    status is now treated as a claim: if the database has no matching record, or records the
    opposite, the table is frozen for review. (3) The check ran during startup recovery but not when
    a table actually paid out or refunded, so a record altered after the game began could still be
    paid. The proof now happens **inside the same database transaction** that moves the chips — if it
    fails, nothing at all is written. (4) The evidence was read with three separate queries, so a
    concurrently finishing buy-in could be seen half-written and freeze a perfectly healthy table;
    it is now read as one consistent snapshot.
  - **Nothing is refunded — or written off — without proof (Stage 37.7.17):** three more real
    defects fixed, all **corrections to the previous entry**. (1) The new "prove whose table it is"
    guard was wired into a table's own payout and refund, but the **startup cleanup that refunds
    abandoned buy-ins still used the old unguarded path**. It trusted a buy-in record just because it
    could be read, so a record whose actual chip charges were missing, partial or belonged to a
    different account was refunded to **every** listed seat — **creating chips for a player who was
    never charged** — and then marked the match fully settled. That sweep (and the damaged-table
    recovery beside it) now uses the same guard: no charge record, no refund. (2) A table that had
    lost its buy-in record but still remembered a hand in progress was **wiped clean and marked
    cancelled no matter what** — even when the cleanup had failed, when the chips had actually been
    **paid out**, or when there was nothing to identify the match by at all. Such a table now stays
    intact and unplayable until the outcome is genuinely established; it only becomes a clean lobby
    once a refund for exactly that match is confirmed. (3) A table whose saved file merely *said*
    "already paid/refunded" was accepted as proof when deleting it; that claim is now re-checked
    against the database first.
  - **A payout is never mistaken for a refund, and cleanups retry without a restart (Stage
    37.7.18):** three more real defects fixed, all **corrections to the previous entry**. (1) The
    refund path reported one vague "resolved" for two opposite outcomes, so when a payout won the
    race against a cleanup the match was recorded as **refunded** — and a table could then be
    cancelled and wiped even though its chips had been paid out. Every settlement now reports which
    outcome actually happened, and only a real refund may cancel a table. (2) The damaged-table
    recovery still refunded every buy-in record that merely shared the table's four-character code,
    which is reused — so it could settle a completely different table's match. Such a table is now
    frozen for review and its records are left untouched; only an exact match identity can authorise
    a settlement. (3) The cleanup that refunds abandoned buy-ins ran **only at startup**, so a
    momentary database problem left those chips withheld until the server was restarted; it now
    retries on the normal background schedule (one at a time), and a table waiting on such a cleanup
    becomes a clean lobby the moment its refund is confirmed.
  - **A paid table can no longer be restarted around, and cleanups can't collide with a new hand
    (Stage 37.7.19):** three more real defects fixed, all **corrections to the previous entry**.
    (1) Several places still treated "the payout already happened" as if it were an ordinary retry:
    a failed start, a seat change during start, a failed rematch and the background cleanup all
    reported "still settling" — while the table had quietly become settled, unblocked itself, and a
    second start could charge a **brand-new buy-in** on top of a table whose chips were already
    paid. Every one of those paths now shares a single rule, and a paid or unresolvable conflict
    permanently pauses the table for review instead. (2) Starting or rematching trusted the table's
    own saved "already paid/refunded" note before replacing it with a new hand; that note is now
    re-checked against the database first, and a note the database does not confirm blocks the new
    charge. (3) The background cleanup that refunds abandoned buy-ins could overlap with a table
    starting a new hand and refund a **live** game's chips; starting a hand and running that cleanup
    are now strictly ordered so they can never overlap.
  - **A refused rematch no longer damages a finished table (Stage 37.7.20):** three more real
    defects fixed, all **corrections to the previous entry**. (1) Starting a new hand cleared the
    table's record of the previous one BEFORE charging the buy-ins, so an ordinary "not enough
    chips" (or a momentary database error) left the finished table with a result and no record of
    the match that produced it — which recovery could then pause for review. The charge is now fully
    reversible: if it does not go through, the table is left exactly as it was and a retry works. (2)
    The rule that a background cleanup must not touch a table that is starting a hand only covered
    the split second while the charge was in flight, and only looked at the tables known when the
    cleanup began — so a table that had just been charged but had not yet dealt, and any table
    created moments earlier, could still have its chips refunded mid-start. The cleanup now protects
    every match any live table holds, re-read at the moment it runs, and only ever settles matches no
    table owns. (3) A table whose chips were paid out but whose final hand was lost could still be
    reused for a new game or silently deleted; it is now always paused for review, with its record
    kept, and a finished table is only deleted once the database confirms its refund.
- **Poker — No-Limit Texas Hold'em, the 7th game (Stage 37.4).** A full platform release
  (`status: available`): **local pass-and-play** (with a per-hand handover screen so hole
  cards stay private) + **server-authoritative online** rooms, **2–6 players**, 1000-chip
  stacks, fixed blinds 10/20. Complete engine — betting (fold/check/call/bet/raise/all-in),
  four streets, side pots, split pots, odd-chip award, best-5-of-7 evaluation with full tie
  breaking and the A-2-3-4-5 wheel, and a fair deterministic bot. **Private-hand redaction**
  (hole cards, deck order and burn cards never reach a client; only showdown-eligible hands
  reveal), reconnect/persistence, optional turn timer. **Score-only stats + leaderboard**
  under `game_type='poker'` (no DB migration), a Profile sub-tab, **favoritable**, a scripted
  tutorial, EN/UK/DE/AR copy, and its own PNG chip emblem. The shared room cap grew 5 → 6.
  Achievements catalog **48 → 52**: *Poker Winner*, *All-In Survivor*, *Big Pot* (win a pot
  of ≥ 1000), *Royal Flush*; **All-Rounder now needs a win in all seven games**.
  [`POKER_RULES.md`](POKER_RULES.md) · [`POKER_PLAN.md`](POKER_PLAN.md)
- **The full owner-requested achievement pack — catalog 34 → 48 (Stage 37.3).** Fourteen new badges, each
  backed by **real per-round / per-hand / per-game telemetry** (never an aggregate proxy), added to the
  JSONB stats payload with **no DB migration**, backward-compatible and null-safe for old accounts, recorded
  from real game outcomes and idempotent on reconnect:
  - **King** — *Spotless Slate* (a zero-penalty round in every one of the six negative modes), *Clean Sweep*
    (take every trick in a Trump round), *Trump Wallflower* (fewer Trump tricks than every rival).
  - **Durak** — *Six-Gun Salute* (finish the fool with an all-sixes attack) and *Sixed Out* (lose as the
    fool who took one).
  - **Deberc** — *Beyt-Free* (win without your team ever taking a «Бейт» mark), *Below Zero* (negative final
    team score), *Melodyless* (a whole match with no combination).
  - **Tarneeb** — *Flawless Contract* (a game as declarer with zero failed contracts), *Grand Slam Bid*
    (bid the maximum 13 and make it).
  - **51** — *First-Move Finish* (win a round on the very first move), *Sealed Shut* (never open a whole
    game), *Double Joker* (dealt two jokers in one hand), *Hundred-Free* (no 100-point penalty all game).

  English, Ukrainian, German, Arabic. All-Rounder, `totalWins`/`totalGames` and every existing badge are
  **unchanged**.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Poker Host routing: selecting Poker created a King room (Stage 37.6).** `StartMenu.host()` added the
  chosen `gameType` only via per-game conditional spreads (durak / deberc / tarneeb / preferans / fifty-one)
  and had **no branch for Poker**, so `CREATE_ROOM` went out with no `gameType` and the server applied its
  legacy `?? 'king'` default — a real King room + King reducer/UI under a "Poker" label. The create-intent is
  now built by a shared pure `buildCreateIntent(...)` that **always carries the authoritative selected
  `gameType`** for all seven games (game-specific *options* stay per-game), so no game can silently fall back
  to King. No rules/engine/UI change to Poker itself (the confirmed fault was purely Host routing); no DB
  migration, dependency, or version change.

- **Authoritative room turn timer for all 7 games (Stage 37.5).** Fixes two production bugs: (1) the timer
  could reach 0 without the server auto-action firing (the timeout silently stopped on a no-op and never
  re-scheduled); (2) a reload / reconnect / reclaim mid-turn restarted the client countdown from full and
  could re-arm the server timeout, granting extra time. The per-turn deadline is now part of the
  **authoritative room state** (`turnDeadlineAt` + `turnTimerRevision`, persisted) and is minted **only on a
  real gameplay transition** — connection events keep the same deadline. Every `STATE_UPDATE` carries a
  `RoomTimerInfo` (`{ deadlineAt, revision, serverNow }`); the client derives the remaining time from the
  server deadline against `Date.now()` (skew-corrected, background-throttle-safe), so a reload 12 s into a
  30 s turn shows ~18 s and never resets/extends. The server arms ONE absolute-deadline timer with a
  **revision guard** (no stale double-move); the disconnected-substitute deadline is server-only, starts on
  disconnect and cancels on reconnect, and never extends an enabled room timer. Restore uses the persisted
  remaining time (past deadlines resolve immediately; legacy rooms restore conservatively). The turn-timeout
  auto-action path is audited across all 7 games so a deadline never stalls the table (Durak defence gained a
  `TAKE_CARDS` safety fallback). No DB migration; no game-rule change; timer metadata carries no
  cards/tokens/user ids.

- **Achievements grid: no "All" tab, default Global (Stage 37.3).** Reverted the Stage 37.2 re-introduction
  of a combined **All** chip — the owner's ask was to implement the full requested badge *pack* (above),
  not a combined tab. The grid opens on **Global** and is browsed one group at a time; the header still
  reports the global **earned / total** across every badge.

## [0.4.8] — 2026-07-21 — Achievement grouping and badge expansion

> Player-facing polish to the Profile **Achievements** grid (grouped-per-game filter, no "All" tab) plus
> five new stats-derived badges (**29 → 34**). **No** DB migration (latest stays `0009`), dependency,
> schema, or new-stats-field change; **no** version-affecting server change. Stage 37.1 is the release QA
> pass (docs/version bump).

### Added

- **More achievements + a cleaner grid (Stage 37.0).** The Profile **Achievements** catalog grows **29 →
  34**: five new badges derived from the existing stats (no DB migration) — **King** *"Nothing Went Right"*
  (concede points in every one of the six negative rounds), **Deberc** *"Paltina Hunter"* (3 Палтіна) and
  *"Double Declaration"* (2+ combinations in one hand), and **Tarneeb** *"In the Red"* (finish a game with
  a negative team score) and *"Overbidder"* (declare 3+ hands and make none). The grid is now browsed
  **per game**: a styled filter chip strip (**Global** and each game, each with its icon + earned/total)
  replaces the old flat wall — there's **no "All" tab** (it opens on Global) and it never shows all badges
  at once. The strip scrolls **inside itself** (styled scrollbar), so 360/390 and Arabic RTL never overflow
  the page. Earned/locked logic, **All-Rounder**, and the totals are **unchanged**; every new badge is
  null-safe. English, Ukrainian, German, Arabic. Many other requested badges need per-round/per-hand
  telemetry the aggregate stats don't carry yet — they're documented as **deferred** with the exact field
  each needs in [`ACHIEVEMENTS_PLAN.md`](ACHIEVEMENTS_PLAN.md) §7.

## [0.4.7] — 2026-07-21 — Reconnect and table polish

> Player-facing polish across **reconnect**, **achievements**, and **51**. **No** DB migration (latest
> stays `0009`), dependency, or native change. Stage 36.2 additionally corrected stale env-var docs
> (`ORPHAN_ROOM_TTL_MS` is **5 min**, not the old 15 min) and added a guard that the 51 calculator stays
> local-only.

### Added

- **Resume your game from another device (Stage 36.1).** The main menu now shows a **"Your active rooms"**
  block to a **signed-in** player, listing the rooms **their own account** has a seat in (game, code,
  Lobby/In game, player count, "updated N ago"). Tapping one **reclaims that seat** — server-matched by the
  account (userId), no reconnect token needed — so a game (or a lobby with bots) started on one device can
  be resumed on another. It shows only your **own** rooms (privacy-safe discovery — no tokens/hands/other
  identities), never appears for guests or an empty list, and does **not** duplicate this device's local
  Resume card. Refreshed on opening the menu / after sign-in / a Refresh button — not polled. Completes the
  server-authoritative reclaim from Stage 36.0. English, Ukrainian, German, Arabic.
- **Achievements by game (Stage 36.0).** The Profile **Achievements** grid gains a compact **filter
  strip** — **All · Global · King · Durak · Deberc · Tarneeb · Preferans · 51** — each chip showing its own
  **earned/total**, so 29 badges are browsable per game instead of one long wall. Purely a UI grouping
  (pure `groupAchievements`): the earned/locked logic, **All-Rounder**, and the totals are unchanged. The
  strip scrolls horizontally on 360/390 and mirrors under Arabic RTL. English, Ukrainian, German, Arabic.
- **51 card calculator (Stage 36.0).** A new **🧮 Count cards** toggle on the 51 table opens a **local,
  display-only** calculator available at **any time — even on another player's turn**. Tap cards in your
  hand to preview whether the selection is a valid meld and what it's worth, plus your hand's total penalty
  value. It **dispatches nothing**, never removes cards, and never disturbs the meld selection/staging or
  the manual hand order — it reuses the existing pure rules (`resolveMeld` / `handPenalty`).

### Changed

- **Rooms survive 5 minutes for reconnect (Stage 36.0).** The orphan-room TTL (how long a room with no
  connected human lives) is now **5 minutes** (was 90 s), so a player who accidentally closed the tab or
  reloaded — **including in a game against bots** — can come back and RECONNECT to the same room. Deliberate
  **Leave** and finished-room cleanup are unchanged. Overridable via `ORPHAN_ROOM_TTL_MS`.
- **51 meld cards — uniform slot + bigger (Stage 36.0).** Every public-meld card (normal, bare joker, and a
  joker showing the card it represents) now renders in the **same `.fiftyone-meldcard` slot wrapper**, so a
  single CSS rule governs the slot for all of them — no path can disagree and overlap. Cards are enlarged
  to **72×112** (from 64×100); a long run scrolls **inside** its meld block so nothing overflows the page.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Same-user reconnect from another device (Stage 36.0).** A signed-in player can now resume their **own**
  active room from a **different device**. New server-authoritative paths match the account by the
  **session-cookie userId** (never a client-claimed value): `RECLAIM_ROOM` takes over the caller's own seat
  (minting a fresh reconnect token for the new device) and `FIND_MY_ROOMS` returns a privacy-safe list of
  the caller's rooms (codes + game type + started only — no tokens/hands/other identities). Also fixed a
  **reconnect race**: an old, half-open socket's late `close` no longer disconnects a member whose socket
  map now points at a **newer** connection (the cause of a reconnect sometimes "not connecting"). No DB,
  schema, dependency, or reconnect-token-security change.

## [0.4.6] — 2026-07-21 — Android TWA debug build readiness

> A **config + docs** patch packaging Stages 33.13–33.14. It **unblocks and verifies** the Android TWA
> **debug** build (a one-line `twa-manifest.json` fix), records the emulator run as evidence, and teaches
> `check-env.ps1` to find an Android Studio toolchain that isn't on `PATH`. **No** gameplay/web-source
> change, no DB migration (latest stays `0009`), no dependency, and **no** native binary is committed (the
> APK / keystore / generated Gradle project / screenshots stay git-ignored). A **debug** build opens as a
> **Custom Tab** until a real `assetlinks.json` (custom domain + Play App-Signing SHA-256) verifies the
> origin — see [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) §9.

### Docs

- **Android TWA debug build evidence (Stage 33.14).** Recorded that the Android TWA **debug APK actually
  builds and runs** — added `android-twa/DEBUG_BUILD_EVIDENCE.md` (the working toolchain — Android Studio
  JBR 21 + SDK, AVD `Pixel_9`, Bubblewrap 1.24.1; the `bubblewrap update` → `gradlew assembleDebug` →
  **BUILD SUCCESSFUL** commands; the emulator install/launch summary; visual confirmation of the Card
  Majlis menu, six-game tagline, Tutorials tile and interactive Local setup; and the known non-bugs:
  **Custom Tab** in the unverified debug state, Chrome first-run, and `check-env` false-NOT-READY when the
  JBR/SDK aren't on `PATH`). Also improved `check-env.ps1` to **detect** an Android Studio JBR/SDK off
  `PATH` and print the `JAVA_HOME`/`ANDROID_HOME` to set (read-only — never writes env vars). No binaries
  are committed (APK / keystore / generated Gradle project / screenshots stay git-ignored); no gameplay/
  dependency/version change.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Android TWA debug build blocker (Stage 33.13).** The committed `android-twa/twa-manifest.json` was
  missing `splashScreenFadeOutDuration`, so **Bubblewrap 1.24+** generated an `app/build.gradle` with
  `splashScreenFadeOutDuration: ,` (empty) → Gradle failed with `Unexpected input: ','` and
  `gradlew assembleDebug` never produced an APK. Added `"splashScreenFadeOutDuration": 300` to the manifest
  (verified end-to-end: `bubblewrap update` → `gradlew assembleDebug` → **BUILD SUCCESSFUL**, and the debug
  APK runs in an Android emulator, opening the production PWA as a Custom Tab — Stage 33.12). Hardened
  `android-twa/.gitignore` to exclude local run artifacts (`emulator-*.png`, `manifest-checksum.txt`) and
  added `src/pwa.test.ts` guards. **No** generated Gradle project / APK / keystore / screenshots are
  committed; no gameplay/web-source change, no dependency, no version bump.

## [0.4.5] — 2026-07-21 — Owner smoke guide

> A **docs-only** patch. **No** gameplay, DB migration (latest stays `0009`), dependency, native artifact,
> or runtime change.

### Docs

- **Owner smoke guide (Stage 35.0).** Added [`OWNER_SMOKE_GUIDE.md`](OWNER_SMOKE_GUIDE.md) — a short,
  owner-friendly 20–30 min walkthrough for the live manual smoke: what to open and in what order
  (diagnostics/static → login/avatar → friends/invite → voice → the six games → 51/Deberc/Tarneeb special
  rules → tutorials/achievements → mobile RTL), a **"how to report a bug"** checklist (game, local/online,
  room code, exact steps, expected vs actual, screenshot/video, browser/device, `diagnostics`
  version/commit, whether a hard refresh was tried), and a **"what is *not* a product bug"** list (deploy
  lag before rollout finishes, missing TURN for cross-network voice, iOS PWA-only, Android Custom Tab
  before Asset Links, Google OAuth `redirect_uri_mismatch`, avatar `503` on non-ffmpeg hosts). Linked from
  `PRODUCTION_SMOKE.md`, `PRODUCTION_SMOKE_LOG_TEMPLATE.md`, `QA_CHECKLIST.md`, and `PROJECT_OVERVIEW.md`.
  The detailed PASS/FAIL/BLOCKED matrix stays authoritative in `PRODUCTION_SMOKE_LOG_TEMPLATE.md` (no
  duplication).

## [0.4.4] — 2026-07-21 — Production readiness audit

> A **docs-only** patch packaging the Stage 34.0 pre-live audit. **No** gameplay, DB migration (latest
> stays `0009`), dependency, native artifact, or runtime change — it fixes current-state doc/comment drift
> and fills a security-wording gap so the repo is ready for the owner's live production smoke.

### Docs

- **Final production-readiness audit (Stage 34.0).** A pre-live-testing repo audit for **v0.4.3** —
  release-state consistency, security/privacy wording, and mobile readiness. Fixes only real current-state
  drift: a stale **"Experimental"** label for **51** in the `QA_CHECKLIST.md` online-smoke step (51 is a
  fully **released** game, `status:'available'`) and a matching misleading code comment in
  `src/games/registry.ts` (`coming_soon (not playable yet)` → `released`). Added concise
  **security/privacy** spot-checks to `PRODUCTION_SMOKE.md` §11 (WS payloads carry no auth
  secrets/tokens/emails; voice relays signaling only — no audio bytes/recording/DB; TURN creds are
  env-only, not committed; avatar upload needs Postgres+ffmpeg with no committed secrets; only the
  placeholder `assetlinks.example.json` is committed). No gameplay, DB, dependency, or native-artifact
  change; no version bump.

## [0.4.3] — 2026-07-21 — Mobile app build readiness

> A **docs + tooling** patch (Stages 33.8–33.10), continuing the v0.4.2 mobile-readiness line. It hardens
> the **owner-run Android TWA build** path — a paste-in build-log template + a read-only build-log **triage
> helper**, and the ordered **production Asset Links + custom-domain** runbook to reach a full-screen TWA.
> **No** native app is built or submitted, no APK/AAB/keystore or generated Gradle project is committed, no
> real `assetlinks.json` (only the placeholder example), no dependency, no DB migration (latest stays
> `0009`), no gameplay/rule change. **Nothing runs at runtime that changed** — it is entirely docs +
> owner-side PowerShell helpers + guard tests.

### Docs

- **Android TWA build-log triage helper (Stage 33.10).** Added `android-twa/triage-build-log.ps1` — a
  **read-only** classifier that takes a pasted build-log file and maps known failures to **Category /
  Evidence / Meaning / Owner action**, tagged **[environment]** (your machine) vs **[repo/config]** (this
  repo). It recognises JDK < 17, missing Android SDK / `ANDROID_HOME`, unaccepted licenses, the wrong `npx
  bubblewrap` package, the wrong `init --manifest` target, Gradle download/network failures, a missing
  Android Gradle plugin/distribution, `adb` no-device/unauthorized, "opens as a Custom Tab because Asset
  Links aren't verified", Asset Links SHA mismatch (upload/debug-key mistake), and Google OAuth
  `redirect_uri_mismatch`; anything else prints "Unknown — paste the full log". It **installs nothing,
  downloads nothing, spawns no process, and writes no files** (verified on Java-8/npx/adb/clean samples).
  README + `BUILD_LOG_TEMPLATE.md` document it; new `src/pwa.test.ts` guards assert it exists, stays
  read-only, and covers every category. No build, no APK/AAB, no keystore, no real `assetlinks.json`, no
  dependency, no version bump.
- **Android TWA production Asset Links + custom-domain plan (Stage 33.9).** Added the ordered owner runbook
  ([`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) §9) to turn the Custom-Tab debug build into a **full-screen**
  verified TWA: choose a **custom domain** → add it in Render + re-point `GOOGLE_REDIRECT_URI`/
  `ALLOWED_ORIGINS` → add the new origin to Google OAuth (redirect URIs + JS origins) → verify manifest/
  service-worker/login on it → build a **signed AAB** → read the **Play App-Signing SHA-256** (Play Console
  → App integrity → App signing; **not** the upload/debug key) → create + **deploy** the real
  `/.well-known/assetlinks.json` (copy the example locally, fill the SHA — **never commit it**) → verify
  reachability/JSON/fingerprint and `adb shell pm get-app-links com.cardmajlis.app`. Warns that a
  wrong/stale `assetlinks.json` can be cached. **Docs + guard tests only — no real `assetlinks.json`, no
  APK/AAB, no store submission, no invented SHA, no dependency, no version bump.**
- **Android TWA owner-build triage hardening (Stage 33.8).** Made the owner-run Android **debug** build
  as fail-safe as possible without building anything in-repo: a paste-in
  [`android-twa/BUILD_LOG_TEMPLATE.md`](android-twa/BUILD_LOG_TEMPLATE.md) (check-env → `bubblewrap init` →
  Gradle → `adb`, plus a full-screen-vs-Custom-Tab observation), a **Known-expected-launch-states** table
  and a **Troubleshooting** table in the README (wrong `npx` package, wrong `--manifest` target, Java 8,
  missing Android SDK, unaccepted licenses, blocked Gradle download, no adb device, DAL-not-verified,
  microphone, Google OAuth redirect), read-only **config-sanity** checks added to `check-env.ps1`
  (packageId / `webManifestUrl` / README uses `@bubblewrap/cli` / no wrong `npx bubblewrap init`), and new
  `src/pwa.test.ts` guards (correct init command, no wrong command, never instructs to commit
  APK/AAB/keystore, the template exists). No owner build logs were available, so **no native build,
  APK/AAB, keystore, or generated Gradle project** was produced or committed; no dependency, no version
  bump. iOS is unaffected.

## [0.4.2] — 2026-07-21 — Mobile app readiness

> A **docs + PWA** patch release: it packages Stages 33.0–33.6 — the **Android TWA** strategy/readiness,
> a config-only TWA scaffold (`android-twa/`), the owner build runbook + `check-env.ps1`, the corrected
> Bubblewrap command, the **iOS PWA-only** decision, and a new **iOS "Add to Home Screen" hint**. **No**
> native app is built or submitted, no dependency, no DB migration (latest stays `0009`), no gameplay/rule
> change. The only runtime change is the web-only iOS install hint.

### Added

- **iOS "Add to Home Screen" hint (Stage 33.6 — iOS PWA hardening).** Because iOS Safari never fires
  `beforeinstallprompt`, the Android-style install card never appeared on iPhone/iPad. A small,
  non-intrusive **hint** now shows there instead: **"Install Card Majlis — Tap Share, then Add to Home
  Screen"** — **menu only** (never during a game), **iOS only**, only when **not already installed**, and
  **dismissible** (persisted under its own key so it doesn't cross-suppress the Android install card). No
  fake install button, no modal. English, Ukrainian, German, Arabic. Web-only; no gameplay change, no
  dependency, no native project. (Guarded by new `src/pwa/pwaClient.test.ts` cases.)

### Docs

- **iOS app strategy decided (Stage 33.5).** Added a dedicated iOS section to
  [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) (§8): an audit of **iOS PWA-only vs Capacitor WKWebView vs
  native rewrite vs defer-until-Android-proven**, with the recommendation to **keep iOS PWA-only for now**
  and defer any App Store wrapper until the Android TWA is validated, a custom domain exists, and store
  assets (privacy policy, support email, screenshots) are ready — and, if a wrapper is ever built, to use
  **external-browser OAuth (`ASWebAuthenticationSession`)**, never an embedded WebView. Includes an
  iOS feature-compatibility matrix, a **PWA-hardening checklist** (mostly already shipping — apple-touch
  icon, status-bar/standalone meta, `viewport-fit=cover`, `navigator.standalone` detection), store
  prerequisites, and a re-staged rollout (33.5 iOS decision → 33.6 iOS PWA hardening → 33.7 Android
  debug/internal test → 33.8 iOS native decision). A small `src/pwa.test.ts` guard now asserts the iOS
  meta stays in `index.html`. **Design-only: no iOS project, no Capacitor, no dependency, no App Store
  submission, no version bump.**

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Android TWA build command (Stage 33.4 triage).** Corrected the build runbook: `bubblewrap init
  --manifest` takes the **Web App Manifest URL** (`…/manifest.webmanifest`), not the repo's
  `twa-manifest.json` — `init` *writes* a twa-manifest, while `build`/`update` *read* it (verified against
  the Bubblewrap CLI reference). The README/plan now `init` from the live web-manifest URL and confirm the
  package/colors/orientation at the prompts (with an optional `git checkout -- twa-manifest.json` +
  `bubblewrap update` to pin the committed config), flag `npx @bubblewrap/cli` over the wrong `npx
  bubblewrap`, and a new `src/pwa.test.ts` guard keeps `twa-manifest.webManifestUrl` in sync with `host`.
  Docs-only + a guard test; no native build has run (still awaiting the owner's toolchained logs).

### Changed

- **Android TWA build runbook (Stage 33.3).** Prepared the owner-run path to a real Android **debug**
  build from `android-twa/twa-manifest.json` — no app is built or submitted. Added a **read-only**
  `android-twa/check-env.ps1` (checks JDK 17+, Android SDK, adb, Node/npm, Bubblewrap, and the manifest;
  installs/downloads/writes nothing; `FAIL` on this repo's JDK 8), the exact PowerShell build runbook in
  the README (`check-env` → `bubblewrap init` → `.\gradlew.bat assembleDebug` → `adb install`), an
  Asset-Links/TWA-verification explanation (a debug-signed APK shows a Custom Tab URL bar until a Play
  App-Signing `assetlinks.json` matches; `keytool` debug-SHA + Play Console locations), an expanded
  on-device Android QA checklist, and **repo guard tests** (`src/pwa.test.ts`) that fail if any
  APK/AAB/keystore or generated Gradle project is committed or the config drifts from the web manifest.
  No native project/APK/AAB/keystore committed, no real `assetlinks.json`, no web dependency, no version
  bump.
- **Android TWA scaffold (Stage 33.2).** Added a **config-only** Trusted Web Activity scaffold at
  `android-twa/` — a committed Bubblewrap `twa-manifest.json` (package `com.cardmajlis.app`, host
  `king-game-cqgd.onrender.com`, `standalone`/`portrait`, theme `#0d4f28`, 512 + maskable icons), a
  `.gitignore` that keeps keystores / APKs / AABs / the generated Gradle project out of the repo, and a
  README with the `bubblewrap init/build` + `assetlinks.json` steps. The **native Android project is not
  generated or built** (the environment lacked JDK 17+, the Android SDK, and Bubblewrap — the generated
  files are deliberately not faked); the owner runs `bubblewrap init` on a toolchained machine (Stage
  33.3). **No** store submission, real `assetlinks.json`, keystore, runtime dependency, or version bump.
- **Android app readiness (Stage 33.1).** Prepared the web/PWA for a future **Android TWA** without
  building an app: the install **description** (manifest + page `<meta>`) now names **all six** games
  (previously only four), and the repo carries a `public/.well-known/assetlinks.example.json` **template**
  (proposed package `com.cardmajlis.app`, placeholder certificate). The real Digital-Asset-Links file is
  added only at store setup with the Play App-Signing key. No native project, no dependency, no runtime
  behaviour change.

### Docs

- **Mobile app strategy designed (Stage 33.0).** Added [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) — an
  audit of four paths to Android/iOS apps and a recommendation: **Android-first via a Trusted Web
  Activity** wrapping the production PWA (the Chrome engine keeps Google login, cookies and voice behaving
  exactly as on the web), with **iOS staying a PWA** until a later decision. Includes a
  feature-compatibility matrix, security/privacy + store-disclosure notes, store prerequisites, a
  technical-readiness checklist, and a staged rollout (33.1–33.5).

## [0.4.1] — 2026-07-20 — Achievements expansion

### Added

- **More achievements (Stage 32.1).** The Profile **Achievements** grid grows from **14 to 29** badges —
  every game that lacked a basic "won a game" badge now has one (**Deberc / Tarneeb / Preferans / 51**),
  plus play-count and win-count depth badges, a **Sharp Bidder** skill badge (70% Tarneeb contract
  success over a real sample), and two global milestones (**Six-Game Regular** — play every game; and
  **Champion's Circle** — 25 total wins). A new **Uncommon** rarity tier joins Common/Rare/Epic. Every
  badge is still **derived purely from your existing stats** — no DB migration, no new tracking, no
  server push, and All-Rounder is unchanged (still a win in all six games). English, Ukrainian, German
  and Arabic. Designed in [`ACHIEVEMENTS_PLAN.md`](ACHIEVEMENTS_PLAN.md) (Stage 32.0).

## [0.4.0] — 2026-07-20 — Tutorials and final rule polish

> A minor release: the headline is **Tutorials for all six games** (Stages 31.1–31.2). It rides on the
> **v0.3.9** rule polish it builds on — the **51 configurable elimination score (210/310/410/510)** and
> the **Deberc rule corrections** (restricted trump exchange, length-first Палтіна, бела-declared-on-play,
> −10% table cards) — see the **[0.3.9]** notes below for that detail.

### Added

- **Tutorials — learn a game in 2 minutes (Stages 31.1–31.2).** A new **🎓 Tutorials** item on the main
  menu opens a hub listing all six games — and **all six** (King, Durak, Deberc, Tarneeb, Preferans,
  51) have a full **step-by-step tutorial**: a short, guided walk-through with a little demo table,
  highlighted cards, and plain-language captions (Back / Next / Skip, or ← / → / Esc). Each is under two
  minutes and needs **no account and no internet** — nothing you do in a tutorial affects your stats or a
  real game. Available in English, Ukrainian, German and Arabic. No DB migration, no dependency.

## [0.3.9] — 2026-07-20 — Hand drag, 51 polish, and Deberc rule fixes

### Changed

- **Deberc rule corrections (Stage 30.16).** Three owner rule fixes, plus smaller table cards:
  - **Trump exchange is restricted.** You can only swap your low trump (7 for 3p, 6 for 4p) for the
    face-up card when that exposed card is itself of the **trump suit**, and only if your low trump was
    in your **originally dealt hand** — a low trump you picked up in the прикуп (talon) can no longer be
    exchanged.
  - **Палтіна ranks by length first.** A **longer** run now beats a shorter one regardless of top card
    (a 5-card палтіна beats any 4-card палтіна); equal-length runs still compare by high card.
  - **Бела is declared when you play it, not at the start.** Instead of announcing бела up front, you
    now **declare it as you play a trump K or Q** (a "Declare Bela" toggle), and it scores **20 only if
    you win that trick**. Playing the honor without declaring, or declaring but losing the trick, scores
    nothing.
  - **Table cards are ~10% smaller** in Deberc so the played trick sits more comfortably; the trump and
    stock pile are unchanged.

### Added

- **51: choose how long a match runs (Stage 30.15).** When you set up a 51 game — local or as an
  online host — you can now pick the **elimination score**: **210 / 310 / 410 / 510**, with **510**
  still the default. A player is knocked out once their running penalty reaches the chosen score, so a
  lower value makes for a shorter match. The pick shows in the online lobby (`☠ 310`) and carries over
  when you play again. Nothing else about scoring changes, and existing rooms keep the classic 510. No
  DB migration, no dependency.
- **51: take a joker back off the table (Stage 30.14).** Once you've opened, if a meld on the table
  uses a **joker** and you hold the exact card it stands in for, you can swap them: press
  **"🃏 Replace joker"** on that meld to put your real card in and take the **joker into your hand**.
  It works on anyone's meld — your `J♥` replaces a joker standing in as `J♥`, and the joker is then
  yours to use in a meld of your own (or costs the usual 25 if you're still holding it at the end).
  The card has to match **exactly** — same rank *and* suit. Players who haven't opened can't do this,
  and you still go out on your final discard. No DB migration, no dependency.

### Changed

- **51: meld cards on the table are bigger and never overlap (Stage 30.14).** The cards in melds are
  larger and fully readable, with **Add** and **Replace joker** moved to their own row **under** the
  cards instead of sitting over them; long melds scroll inside their own block, so nothing spills off
  the screen at 360/390.
- **51: "How to play" now explains scoring and melds (Stage 30.14).** The help sheet gained **Card
  values** and **Melds** sections — what each card is worth (2–10 face value, J/Q/K 10, A 10 but
  `A-2-3` = 6, joker 25 in your hand), which combinations are legal (`A-2-3`, `Q-K-A`, why `K-A-2`
  isn't, sets without a repeated suit, one joker per meld) — plus the discard-to-open exception and
  the new joker replacement rule. Available in English, Ukrainian, German and Arabic.

- **51: take the discard only to open, and clearer melds (Stage 30.13).** In 51 you may now pick up
  the **top of the discard pile before you've opened — but only if you open with it that turn** (the
  card must be part of your 51+ opening melds); you can't just scoop it into your hand. Tap the discard
  top (it lights up), add your hand cards, and press **"Take & open 51"**. Once you've opened, taking
  the discard works as before. Bots use this too. The cards in melds on the table are also **bigger and
  clearer**, with no overlapping. No DB migration, no dependency; no change to scoring, penalties,
  elimination, or going out by the final discard.

### Added

- **Drag your hand into any order (Stage 30.12).** In every game you can now **drag a card** within
  your hand — touch, mouse or pen — to arrange it however you like; a quick tap still plays or selects
  the card. Once you've reordered, a **newly drawn card lands on the left** so it's easy to spot, and a
  **↺ Auto-sort** button snaps back to the default. The hand tray is roomier and easier to grab on a
  phone. It's purely how *you* see your hand — it never changes the cards, the rules, or what your
  opponents see (nothing is sent to the server). In **51**, the selected cards show as an ordered
  **meld builder** with the joker's stand-in card, so you can place a **joker exactly where you want**
  in a run (`[🃏, 8♠, 9♠]` = 7-8-9 vs `[8♠, 9♠, 🃏]` = 8-9-10) and still keep your last card to go out
  on the final discard.
- **Partnerships show your names (Stage 30.12).** In **Tarneeb** and **Deberc** Pairs the two teams
  now read like **"Alex & Dina"** vs **"Niko & Yara"** — in the lobby, the in-game standings, and the
  finished screen — instead of an abstract "Team A/B" (with a graceful "Team Alex" fallback while a
  seat is still empty). Solo modes keep showing individual names. Labels only — no scoring change.
  No DB migration, no dependency, no protocol change.

## [0.3.8] — 2026-07-14 — 51 meld and opening rule fixes

A 51-focused patch on **v0.3.7**. Two owner rule corrections to Syrian 51 — jokers may sit
anywhere in a meld, the 51 opening total is required only once per round, and Ace-low runs
extend so an Ace lays off onto a `2-3-4` — plus a fix so public-meld cards no longer overlap
or clip on phones. Fixes only; no new features, no schema/dependency change; the six-game
release state is intact.

### Changed

- **51 (Syrian 51) meld & opening rules corrected (Stage 30.9).** Two fixes, in the shared pure
  core so **local and online behave identically**: (1) a **joker can now sit anywhere in a meld** —
  the start, the middle, or the end of a run (the card it stands for is fixed by where you place it,
  so `7♠ 8♠ 🃏` = 7-8-9, `🃏 8♠ 9♠` = 7-8-9, `Q♠ K♠ 🃏` = Q-K-A, `🃏 2♠ 3♠` = A-2-3; illegal wraps
  like `K-A-🃏` are still rejected). (2) The **51 opening total is required only once per round** —
  once you have opened, you can lay **new melds of any value**, keep laying off, and take the discard
  top; you never have to reach 51 again. The table button now reads **"Lay meld"** after you have
  opened (it says **"Open (n/51)"** only while you still need to open), with clearer hints. Bots also
  lay new melds after opening. No rules changed beyond these two; no DB migration or new dependency.
- **51 (Syrian 51) Ace-low lay-off + meld card layout fixed (Stage 30.10).** An **Ace now extends a
  low run** — a `2-3-4` on the table accepts an Ace to become `A-2-3-4` (and an `A-2-3` accepts a
  `4`); `K-A-2` and adding a King to `A-2-3` stay invalid. Ace-low runs display Ace-first
  (`A-2-3-4`). And the **public-meld cards no longer overlap or get clipped** — each meld's cards lay
  out in a clean, readable row (full card faces, clear gaps, scrolls within the meld if long) with no
  horizontal overflow on 360/390 phones. No DB migration, dependency or other rule change.

## [0.3.7] — 2026-07-14 — Syrian 51 sixth-game release

The **6th game — 51 (Syrian 51)** graduated from experimental to a fully released
`available` member (Stage 30.7), and a six-game release audit (Stage 30.8) closed the
remaining "five games" drift and hardened the platform guards. Card Majlis is now a
**six-game** lounge (King, Durak, Deberc, Tarneeb, Preferans, 51). 51 is playable local +
server-authoritative online, records its own score-only stats + leaderboard under
`game_type='fifty-one'`, can be set as your favorite game, and earns a **"51 Winner"**
achievement that also counts toward **All-Rounder** (now a win in all six games); it ships
its own game emblem and finish-screen frame. No DB migration, no new dependency, no rule
change; the other five games are unchanged.

### Added

- **51 (Syrian 51) is released as the 6th game (Stage 30.7).** 51 is now a first-class member of
  the platform, no longer "Experimental": it appears in the **Local and Host pickers** without the
  Experimental tag, can be set as your **favorite game**, records **stats + a leaderboard** (win
  rate, avg/best penalty, eliminations), and earns a **"51 Winner"** achievement — which also counts
  toward **All-Rounder** (now a win in all six games). It ships its own game emblem (two fanned
  cards). Card Majlis is now a **six-game** lounge (King, Durak, Deberc, Tarneeb, Preferans, 51).
  No DB migration, no new dependency, no rule change; the other five games are unchanged.
- **51 (Syrian 51) is now playable ONLINE (Stage 30.5, experimental).** The 6th game can now be
  **hosted online** from the Host picker (flagged "Experimental"), not just locally: create a
  2–4-seat room, add bots or invite friends, and play server-authoritative 51 with the same table
  UI. The server owns the deal, turn order, bot moves and the between-rounds advance; each player
  sees only their own hand (opponents + the draw pile stay hidden); "Play again" and reconnect work
  like the other online games. **Still experimental — no stats, leaderboard, achievements or
  favorite yet** (those arrive with the full release). No new dependency, DB migration or protocol
  change; the five released games are unchanged.
- **51 (Syrian 51) is now playable locally (Stage 30.3, experimental).** The planned 6th game
  can be played **pass-free local** (1 human + bots, 2–4 players) from the **Local** game picker
  (flagged "Experimental"); the **Host/online** picker still shows it disabled. New `src/ui/fiftyOne/`
  — a setup screen (player count + deck rule), a table (running-penalty scoreboard, draw/discard
  piles, public melds showing each joker's represented value, own hand) and a context action bar
  (draw / take discard / stage + open melds ≥ 51 / add to a meld / discard). Meld validation reuses
  the pure core (Stage 30.1); jokers use the core's clear-card inference (ambiguous → rejected in
  the UI). i18n for **en/uk/de/ar**. **No online, stats, favorite or DB** — those come in 30.4+;
  the five released games are unchanged, no new dependency.

### Internal

- **Six-game release audit + guard hardening (Stage 30.8, no user-facing change).** Swept the
  codebase + docs for stale "five games / 5 games" and "51 is experimental / coming soon"
  references and corrected the canonical current-state ones (online architecture, render/QA/smoke
  checklists, visual direction, type-union + hook comments) while leaving dated stage records as
  history. Hardened the platform guard so it asserts **exactly six available games**, each with
  local + online + bots + stats + favorite coverage + **a game-scoped achievement** + a PNG icon
  under 150 KB, and that **All-Rounder spans exactly the available set** (dropping any one game
  unearns it). Gave 51's finish screen the shared ornamental **finish frame** the other five games
  wear, and added a source guard that the Profile achievements loader fetches 51 stats. No behaviour
  change to the five games; no DB migration, no dependency, no rule change.
- **51 (Syrian 51) stats + leaderboard foundation (Stage 30.6, experimental).** Finished ONLINE
  51 games now record **score-only** stats under `game_type='fifty-one'` — per-seat final running
  penalty, eliminated flag and the match winner, aggregated into a per-user cache (games, wins,
  win rate, average/best penalty, eliminations, rounds) with a public leaderboard. Added a **51
  stats + leaderboard sub-tab** to the Profile screen (i18n en/uk/de/ar). Stats are human-vs-human
  only (bots/guests skipped), idempotent per game, and store **no cards / hands / draw pile /
  melds**. **No DB migration** (reuses the free-text `game_type` column) and **no new dependency**.
  51 stays **experimental** — it is deliberately **excluded from favorites and from achievements /
  All-Rounder** (a guard test enforces this) until the full release (Stage 30.7). The five released
  games' stats and achievements are unchanged.
- **51 (Syrian 51) online redaction / readiness hardened (Stage 30.4, no user-facing change).**
  Proved the 51 `GameDefinition` is server-authoritative-ready **without enabling online** —
  `supportsOnline` stays `false`, so `CREATE_ROOM` still rejects a 51 room and `GET /api/games`
  still lists it as local-experimental. `serverCore` now drives 51 through the same generic path
  as the released games: `startGame`, generic turn-ownership authorization (foreign-seat →
  `NOT_YOUR_TURN`, illegal move → `ILLEGAL_ACTION` reducer no-op), `applyBotTurn`/
  `applyTimeoutAction`, and a seeded `autoAdvance`/`publicScreenOf` branch for the public
  `round_complete → START_NEXT_ROUND` redeal. Added `FiftyOneState`/`FiftyOneAction` to the
  `AnyGameState`/`AnyGameAction` type unions and an **optional `deal` seed on
  `applyActionRequest`** (off by default — the released games' WS path is byte-identical) so 51's
  mid-turn reshuffle stays reproducible. **Redaction hardened** with a JSON-payload leak scan
  (no opponent hand / draw-pile card ever reaches the wrong viewer; draw pile hidden with count
  kept; discard / melds+joker value / scores / opened / eliminated / turn public; spectator sees
  nothing) and a persistence round-trip test. **No online release, no stats, no DB migration, no
  protocol/message or dependency change; the five released games are untouched.**
- **51 (Syrian 51) registered as "coming soon" (Stage 30.2).** Wired the Stage-30.1 pure core
  into the platform as a `coming_soon` game (id **`fifty-one`**): added the `GAME_CATALOG` entry
  (`supportsLocal/Online:false`, `supportsBots:true`, 2–4 players, `rulesDoc:'51_RULES.md'`) and
  registered `fiftyOneGameDefinition` (`recordsStats:false`). It now surfaces in `GET /api/games`
  and the Local/Host game pickers as **"Coming soon" (disabled)** — the existing gates keep it
  non-startable (CREATE_ROOM rejects `!supportsOnline`; picker greys out `!usable`), and it is
  **excluded from favorites and per-game stats tabs**. Added `gameType.fifty-one` + quick-rules
  `help.fifty-one.*` i18n in **en/uk/de/ar** and a 🀄 emoji emblem (no PNG asset). **No new
  dependency, DB migration or stats; the five released games are unchanged.**
- **51 (Syrian 51) pure core (Stage 30.1, no user-facing change).** Added `src/games/fiftyOne/`
  — the pure TypeScript reducer for the planned 6th game: `types`, `deck` (1-deck+2J for 2p /
  2-deck+2J for 3–4p), `melds` (run/set validator with `A-2-3`=6, `Q-K-A`=30, reject `K-A-2`,
  ≤ 1 joker/meld, no duplicate identical card in a set), `rules`, `engine` (draw→meld→discard
  turns, 51-opening from own melds, open-gated discard-take + lay-off, empty-hand win,
  per-round penalties incl. Joker=25 and never-opened=100, elimination at 510,
  continue-until-one-remains, draw-pile reshuffle), a deterministic greedy `ai`, server-side
  `redact` (own hand + draw-pile order hidden), and `invariants` — with **70 unit tests**. **Not
  wired into any catalog/registry, UI, server/ws, stats or migration** — 51 is still invisible
  in the app; the five released games are untouched. No dependency or schema change.

### Docs

- **51 (Syrian 51) rules spec + implementation plan (Stage 30.0, docs-only).** Added
  [`51_RULES.md`](51_RULES.md) (MVP rules, reconciling the owner's Syrian 51 source with
  authoritative house-rule corrections; 10 open confirmations recorded) and
  [`51_PLAN.md`](51_PLAN.md) (staged rollout 30.1 core → 30.7 release, `src/games/fiftyOne/`,
  redaction/bot/stats guidance). Marked 51 as the **planned 6th game** in `MVP_STATUS.md` /
  `PROJECT_OVERVIEW.md` and added a `QA_CHECKLIST.md` placeholder. **No runtime code, catalog,
  UI, stats, dependency or schema change** — the five released games are untouched.

## [0.3.6] — 2026-07-14 — Tarneeb target score and compact table

A Tarneeb-focused patch on **v0.3.5**. The match **target score is now host-configurable** (presets
31/41/61/101, default 41, for Pairs and Solo), the in-game **ranked score table is compact and
centered**, the per-turn **timer now rides in the social control cluster** (not over the table), and
the Tarneeb HUD is the **ranked score table** introduced across 29.7. **No rules/scoring change, no DB
migration** (0009 stays the latest), **no dependency changes**; the one new online field
(`tarneebTargetScore`) is optional and backward-compatible. `/health/diagnostics` `version` reads
`0.3.6`.

### Added

- **Tarneeb match target is now host-configurable (Stage 29.8, owner).** When creating a Tarneeb
  room (online Host sheet) or a local Tarneeb game, you now choose how many points win the match —
  presets **31 / 41 / 61 / 101**, for **both Pairs and Solo**. The default stays **41**, so existing
  and legacy rooms are unchanged. The value is validated/clamped server-side (safe integer 21–201;
  invalid/missing → 41), flows through the whole online path (create → room → snapshot → start), is
  preserved across rematch and server restart, and the lobby shows it (e.g. `Solo · 🎯 61`). **Per-hand
  scoring is unchanged — only the finish threshold moves.** No DB migration, no protocol break
  (a new optional field), no new achievements.

### Changed

- **Tarneeb score table made compact and centered (Stage 29.8, owner).** The ranked standings table
  from 29.7 stretched the full board width; it is now capped to a small max-width, centered, and
  wrapped in a subtle card — easier to read on 360/390 with no horizontal overflow. Content/behaviour
  unchanged.
- **Per-turn timer moved into the social control cluster (Stage 29.7, owner).** After 29.5 put the
  online timer at the bottom of the table it could still sit over the cards/bidding bars. It now rides
  **inside the bottom-right RoomSocial cluster**, next to the voice/emoji/chat buttons — a compact pill
  with an enlarged clock that can never cover the hand, table, or action bars (`pointer-events:none`).
  Same gating: shown only when the host set a timer, low-time sound **only on your turn**, and it works
  for every online game that got the timer in 29.2. King keeps its in-banner timer.
- **Tarneeb HUD is now a ranked score table (Stage 29.7, owner).** The solo chip strip and the Pairs
  Us/Them boards are replaced by a compact, high-contrast **table sorted by total score (descending)**:
  columns are place, player/team, the **bidder ▶ + bid amount** (declarer once the auction resolves,
  else the current high bidder), **🃏 tricks this hand**, and **★ total score**. It highlights your
  row, the acting row, the bidder, and the leader (crown only once someone is ahead). **Solo** lists
  the 4 players by name (no Team A/B); **Pairs** lists the two teams as Us/Them and keeps its team-tricks
  viewer. Sorting keys off total score only (which changes at hand end), so there is no mid-trick
  jitter. Display-only — reads the existing public ledgers, never recomputes scoring or shows hidden
  hands; no rules/scoring/protocol/DB change.

## [0.3.5] — 2026-07-14 — Table HUD and reactions polish

A display-only polish patch on **v0.3.4**. Floating reactions/stickers now anchor over the sender's
**actual** seat in **Tarneeb** (whose on-screen seats are mirrored), the per-turn online timer moves
to a **bottom-of-table HUD** pill with a larger clock, and the in-game **score/tricks readouts** for
Tarneeb (Solo + Pairs) and Deberc are easier to read. **No rules/scoring change, no DB migration**
(0009 stays the latest), **no dependency changes, no protocol/payload change**. `/health/diagnostics`
`version` reads `0.3.5`.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Reactions/stickers now float over the sender's ACTUAL seat in Tarneeb (Stage 29.5, owner).** The
  floating-reaction anchor assumed every table seats players clockwise with `rel = fromSeat − mySeat`,
  but Tarneeb deliberately **mirrors** its seats on screen (its engine order is counter-clockwise by
  index, so the UI flips it to read clockwise). The sender always anchors to the bottom, so the sender
  never noticed — but every *other* viewer saw the chip on the wrong side of the table. The anchor now
  takes a `mirrored` flag (true only for Tarneeb, both Pairs and Solo) that flips the convention to
  match the screen. No protocol/payload change: it still uses the existing public `seatIndex` and the
  send is still emoji-only (the server stamps the seat).

### Changed

- **Per-turn timer moved to a bottom-of-table HUD pill with a bigger clock (Stage 29.5, owner).** The
  online timer that arrived in every game in 29.2 was a small top-centre overlay; it now sits at the
  **bottom of the table**, above the hand, with a larger clock icon and countdown, and pulses when
  time is low (respecting reduced-motion). Same gating: shows only when the host enabled a timer, and
  the low-time sound still fires **only on your turn**.
- **Current score/tricks HUD made more readable (Stage 29.5, owner).** Tarneeb **Solo** standings now
  stack a name row over a bold tricks·score row and **highlight the seat whose turn it is** (bright
  ring + ▶) alongside the my-seat and leader markers; the leader crown only appears once someone is
  actually ahead. Tarneeb **Pairs** Us/Them boards and **Deberc**'s match-score chips get larger,
  tabular score numbers and a coloured top edge so your side and the live trick count read at a
  glance. Display-only — no rules/scoring change; Solo shows no Team A/B labels, Pairs keeps them,
  and Deberc's 3p-Solo / 4p-Pairs labels are unchanged.

## [0.3.4] — 2026-07-14 — Durak reveal and online timer polish

A display-only polish patch on **v0.3.3**. Durak's trump/draw pile is enlarged and the **final
defended card now lingers ~2 s** so you can see what beat the last attack; the **per-turn timer is
now visible in every online game** (not just King) when the host enables it; and **Tarneeb Solo**
shows live per-player trick counts with a larger "review my tricks" button. **No rules/scoring
change, no DB migration** (0009 stays the latest), **no dependency changes**. `/health/diagnostics`
`version` reads `0.3.4`.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Durak trump/deck enlarged (Stage 29.2, owner).** The face-up trump + draw pile are ~22% larger
  and more readable, scoped to the Durak screen (Deberc's own deck sizing is untouched). CSS only.
- **Durak — the last defended card is now visible (Stage 29.2, owner).** A bout resolves in the same
  reducer action that places the final defence, so the table used to clear before you could see the
  card that beat the last attack. The engine now captures the resolved pairs into a display-only
  `lastBout` snapshot the instant the table clears, and the felt lingers on it for ~2 s (the existing
  review hold now shows the *final* beaten pairs, not the pre-defence table). No rules/scoring change;
  `lastBout` holds only public table cards.
- **Per-turn timer now visible in EVERY online game (Stage 29.2, owner).** The countdown was wired
  into King only; Durak/Deberc/Tarneeb/Preferans applied the server timeout but showed nothing. A
  shared, game-agnostic `TurnTimerBar` (extracted from King's `TurnTimer`) is now mounted for all
  online games as a top-centre overlay, computing the acting player via the `GameDefinition`. It
  shows only when the host set 30/60/90; the low-time sound alert still fires **only on your turn**.
- **Tarneeb Solo — live per-player trick counts + a bigger tricks button (Stage 29.2, owner).** The
  solo standings strip now shows each of the 4 players' current trick count (🃏 N) during play and
  between hands, and the "review my tricks" control moves from a tiny topbar badge to a larger,
  dedicated button under the standings (easier to reach on mobile). Pairs keeps its compact topbar
  team-tricks badge; no Team A/B labels appear in Solo.

## [0.3.3] — 2026-07-13 — Tarneeb scoring correction

A small correctness patch on **v0.3.2**. Aligns **Tarneeb Solo** contract scoring with **Pairs**
(exact make → bid×2, overtrick → tricks actually won, failure unchanged) per the owner's
clarification, and resizes the **Deberc** table (smaller played trick cards, ~20% larger
trump/stock). **No DB migration** (0009 stays the latest), **no dependency changes**, no bid-range
or trump-obligation change. `/health/diagnostics` `version` reads `0.3.3`.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Tarneeb Solo scoring — exact-bid double + overtricks (Stage 29.0, owner clarification).** Tarneeb
  **Solo** now scores a made contract like **Pairs** (§8): an **exact** make scores **bid×2** (e.g.
  bid 7 → +14) and an **overtrick** scores the **tricks actually won** (e.g. bid 7, 10 tricks → +10),
  instead of the earlier flat "+bid on any make". The **failure** model is unchanged (declarer −bid;
  each defender banks its own tricks). Pairs scoring was already correct — this only corrects Solo, so
  both modes now match. The solo hand-complete panel shows the "✨ exact bid double" note. Bid range
  (3–13) and trump obligation are untouched; no stats-schema/DB/dependency change (per-seat deltas
  flow through the existing `scoresBySeat`).
- **Deberc table card sizing (Stage 29.0, owner).** On the Deberc table the **played trick cards are
  slightly smaller** (×1.35 → ×1.15) and the **face-up trump + stock deck are ~20% larger**
  (`scale(0.85)` → `scale(1.02)`), so the trump/deck no longer looks dwarfed by the trick. CSS-only —
  no gameplay/engine change; mobile 360/390 stays overflow-safe.

## [0.3.2] — 2026-07-13 — Tarneeb Solo release & bandwidth hardening

A feature + hardening patch on **v0.3.1**. Headline: **Tarneeb now ships two released modes —
Pairs (2×2, default) and Solo (4-player cutthroat)** — playable local + online, with a separate
Solo stats/leaderboard (`game_type='tarneeb-solo'`) and one achievement. Also: a **static-bandwidth
cut** (proper Cache-Control + ETag/304 + gzip) that fixes the Render HTTP-egress overage, a
static-routing correctness fix (missing file-like paths now 404 instead of the app shell), and
**Deberc's Solo/Pairs modes made explicit + playable online**. **No DB migration** (0009 stays the
latest), **no dependency changes**, no gameplay-rule changes to Tarneeb Pairs / Deberc scoring.
`/health/diagnostics` `version` reads `0.3.2`.

### Added

- **Tarneeb Soloist achievement (Stage 28.6).** One new common badge — **"Tarneeb Soloist"** 🗡️ —
  unlocked by winning a Tarneeb **Solo** (cutthroat) match. It reads a **separate** solo stats
  dimension (`game_type='tarneeb-solo'`) that the profile loads independently, so it never mixes
  with the Pairs Tarneeb badges and is **not** required for **All-Rounder** (which still needs a win
  in every canonical game — Solo excluded). Purely derived from public stats (no server push, no
  card data); the "new badge" toast + seen ledger work with the new id **without migration**.
  No gameplay/rules/protocol/DB/dependency change; Pairs achievements + aggregates unchanged.
- **Tarneeb Solo — full release: local + online + stats (Stage 28.4).** The 4-player cutthroat
  (every-player-for-self) mode is now a **released** Tarneeb mode alongside Pairs (still the
  default). The online **Host** sheet has a Pairs/Solo picker; a `tarneebVariant` flows through
  `CREATE_ROOM` → the room → snapshots → `buildTarneebStartAction` (mirroring Durak's variant), and
  is persisted/restored (legacy rooms & clients read Pairs). The lobby shows the mode and renders
  **individual seats for Solo** (no Team A/B grid); rematch preserves the mode; the online table /
  finished screens use the same solo-aware UI as local. **Stats + a leaderboard** record solo under
  a **separate `game_type='tarneeb-solo'`** with a Pairs/Solo toggle in the profile — **no DB
  migration**, and the released Pairs aggregates (`game_type='tarneeb'`) are byte-for-byte
  untouched. Backward compatible; no new dependency; Solo achievements deferred (post-MVP).
  See `TARNEEB_RULES.md` §17 / `TARNEEB_SOLO_PLAN.md`.
- **Tarneeb Solo — local playable prototype (Stage 28.3).** The Tarneeb **local** setup now has a
  **Pairs / Solo** mode picker (default **Pairs**, so the released game is unchanged). Choosing
  **Solo** starts a 4-player cutthroat table (1 human + 3 bots) on the Stage 28.1 pure core: the
  scoreboard shows a **4-player standings strip** instead of Us/Them teams, the tricks viewer shows
  **your own** tricks, the between-hands panel is **per-seat**, and the finished screen names an
  **individual** winner. Trick play (follow-suit + trump obligation) is identical to Pairs. **Online
  Tarneeb stays Pairs-only** (the online host + lobby do not offer Solo) and Solo records **no
  stats/leaderboard/achievements** yet. No protocol/DB/dependency change; Pairs is byte-for-byte
  unchanged. See `TARNEEB_SOLO_PLAN.md` / `TARNEEB_RULES.md` §17.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Tarneeb Solo hardening (Stage 28.5 QA pass).** Two real drifts found after the 28.4 release,
  both fixed: (1) the **room browser** hard-coded "· 2 teams" for every Tarneeb room, mislabelling
  Solo rooms — it now shows the room's actual **Pairs / Solo** mode from `tarneebVariant` (which the
  room summary already carries); (2) the **profile achievements** derived from whatever the Tarneeb
  stats toggle last fetched, so viewing the **Solo** tab could feed solo data into achievements —
  Pairs stats are now the canonical achievements source and Solo has its own separate state, so the
  two never mix. Also: the game-picker subtitle for Tarneeb is now mode-neutral ("Pairs / Solo")
  instead of "2 teams". No rules/scoring/stats-schema change; Pairs and Deberc untouched.
- **Deberc Solo is now actually playable online (Stage 28.2).** Despite the Stage 28.0 labels,
  every hosted Deberc room was still forced to 4 seats (`server/wsHandlers.ts` hard-coded
  `playerCount = maxPlayers` and ignored the client's value), and the lobby drew the Team A/Team B
  2×2 grid for *any* Deberc room — so Solo was invisible in practice. Now: the online **Host** sheet
  has an explicit **Solo (3) / Pairs (4)** mode picker (defaulting to Solo); the server honors an
  in-range host `playerCount` (falling back to the catalog max, so other games and older clients are
  unchanged); and the lobby renders **individual seats + an "every player for themselves" hint** for
  3-seat Solo rooms while keeping the **Team A/B grid** for 4-seat Pairs. The seat cap and start
  gate now come from the room's own player count (Solo needs 3, Pairs needs 4). The Deberc score
  table / finished screen already showed per-player standings; the win celebration now reads as an
  individual win in Solo. **Engine, scoring, stats data model, and 4-player Pairs are unchanged; no
  protocol or DB change** (the `playerCount` field already existed on `CREATE_ROOM`).

### Added (foundation, not yet playable)

- **Tarneeb solo — pure core (Stage 28.1).** A `variant: 'pairs' | 'solo'` flag on `TarneebState`
  and `START_GAME`, **defaulting to `'pairs'`**, adds a 4-player cutthroat (every-player-for-self)
  game: per-seat scoring (declarer makes it → +bid, defenders +0; declarer fails → −bid, each
  defender +its own tricks; first to 41, ties are not a finish), a solo bot that assumes no partner,
  and variant-agnostic redaction. Trick legality (follow-suit + trump obligation) is the **same**
  `legalPlays` as pairs. **Not exposed anywhere yet** — no game picker entry, no online rooms, no
  stats, and the lobby/team UI is unchanged. Released Tarneeb **pairs** is byte-for-byte unaffected
  (a legacy state with no `variant` reads as pairs). Covered by `src/games/tarneeb/solo.test.ts`;
  the local-only playable prototype is the next stage. See `TARNEEB_SOLO_PLAN.md`.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Static file-like 404s + HEAD (Stage 28.1b).** A missing path with a file extension
  (`/cards/faces/AS.png`, `/assets/typo.js`) previously fell through to the SPA `index.html`, so it
  returned `200 text/html` instead of a real **404** — which masked broken/misnamed assets and made
  the bandwidth/cache smoke checks false positives. The static handler now 404s any missing
  *extension-bearing* path (`text/plain`, `no-store`) while extension-less routes (`/`, `/profile`,
  `/?room=CODE`) still fall back to the shell. `HEAD` requests now return the full headers
  (Content-Type, Cache-Control, ETag, Last-Modified, Content-Length) with **no body**. Card faces
  are `{suit}-{rank}.png` lower-cased (`spades-a.png`), documented with real example URLs.

### Performance

- **Static bandwidth cut (Stage 28.1).** The server previously sent every non-hashed static
  asset — the ~10 MB of card-face art, the menu hero, felt, icons, sounds, stickers — with
  `no-cache` **and no validator**, so a browser re-downloaded all of it on *every* visit (the main
  driver of Render HTTP egress). Now `server/httpStatic.ts` uses three Cache-Control tiers: hashed
  `/assets/*` stay `immutable`; static media is `public, max-age=604800` (a week, then a cheap
  ETag **304**); the app shell (`index.html`/`sw.js`/`manifest`) stays `no-cache`. Every response
  also carries an **ETag + Last-Modified** (conditional `If-None-Match` → 304, empty body), text is
  **gzip**'d on the fly, and previously-missing MIME types (`.webp`/`.webm`/`.mp3`/`.gif`/`.jpg`)
  are now correct instead of `application/octet-stream`. **No gameplay, protocol, or dependency
  change.** Trade-off documented in `RENDER_DEPLOY.md`: an in-place asset swap can take up to a
  week to reach clients (rename or bump the SW cache version to force it).

### Changed

- **Deberc — explicit Solo / Pairs modes (Stage 28.0).** The seat count has always *been* the
  mode (3 = every-player-for-self, 4 = fixed 2×2 pairs); now the setup and lobby **name it**.
  Local setup shows **"Solo · 3 players"** and **"Pairs · 4 players"** mode cards instead of bare
  3/4 tabs, and the online lobby game-line reads **"· Solo"** or **"· Pairs"** from the room's
  seat count. **No engine, scoring, or stats change** — label only.

### Added (foundation, not yet playable)

- **Tarneeb solo — implementation-ready spec.** [`TARNEEB_SOLO_PLAN.md`](TARNEEB_SOLO_PLAN.md)
  fixes the design for a future **4-player cutthroat** solo variant (Variant B), including the
  individual scoring model (declarer ±bid; set defenders earn defensive credit by their own
  tricks). A `soloGuard.test.ts` pins the released **4-player 2×2 pairs** behaviour so the future
  build can add a `variant` flag without touching the shipped team game, its stats, or its
  leaderboard. **Released Tarneeb is unchanged and remains team-only; solo is not implemented.**

## [0.3.1] — 2026-07-12 — Gameplay polish & friends/voice fixes

A patch release rolling up the **Stage 27.x gameplay polish** and the post-v0.3.0 **friends /
voice / invite** fixes. Additive and fairness-safe: **no new features, no schema/migration
changes** (0009 stays the latest), **no dependency changes**. `/health/diagnostics` `version`
reads `0.3.1`.

### Audit (Stage 27.6 — gameplay polish audit)

- **Post-27.x regression audit — no gameplay bugs found.** Verified the 27.0–27.5 changes left
  the five released games stable: Tarneeb and Deberc legality share **one source of truth**
  (`legalPlays`) between the table UI and the reducer, so the server accepts exactly what the UI
  offers (no authority drift) and illegal plays return the same state; Deberc's trump exchange
  stays reducer-gated; online turn-authority, friends-invite visibility, invite-accept join,
  bot/human rematch and reconnect all hold; cards never render blank; the Tarneeb team-tricks
  viewer reads only public data. Locked with a focused audit test; no runtime code changed.

### Changed (Stage 27.4 — clockwise & table-clarity audit)

- **Play now reads clockwise in every game.** Audited all five (`CLOCKWISE_AUDIT.md`); King,
  Durak, Deberc and Preferans were already clockwise. **Tarneeb** read counter-clockwise on
  screen and was corrected **UI-only** — the turn now sweeps to your left, with your partner
  still opposite at the top. Dealing, partnerships, play order and scoring are unchanged.
- **King now flags the led card** of the current trick with the same "1" badge + ring the other
  games use, so it's always clear who led. (The winning card already pulses when a trick is
  taken.) Reveal delay stays a readable ~2 s across every game.

### Added (Stage 27.3 — Tarneeb team-tricks review)

- **Tarneeb: view your team's taken tricks** — a "🃏 Team tricks" button opens a review of every
  trick your side has won this hand (winner + the 4 cards in play order, lead card flagged);
  opponents show as a count only. Display-only (the played cards are already public), so no rules,
  scoring, or stats change; works local and online.

### Added (Stage 27.2 — Deberc trump exchange)

- **Deberc trump exchange** — before the first card, the holder of the lowest trump (7 in
  3-player, 6 in 4-player) can swap it for the face-up table trump ("🔄 Swap low trump" on their
  declaring turn). The exposed card enters their hand and the low trump becomes the new table
  trump — the hand keeps the same number of cards, once per hand, optional. A public note shows
  the swap; no hidden hand is revealed. Bots do it automatically. Enforced in the pure reducer, so
  online validates identically.

### Changed (Stage 27.1 — menu sections + sender-anchored reactions)

- **Profile is split into clear sections** — Account, Friends, Statistics, Achievements and
  Leaderboards are each their own tappable section (with the incoming friend-request badge on
  Friends) instead of one crowded tab strip that overflowed on small phones.
- **Reactions & stickers float over the sender's seat** — an emoji/sticker now pops near the
  player who sent it (bottom for you, others around the table) instead of always at the centre.
  It reuses the existing public seat info — no protocol change.

### Changed (Stage 27.0 — game rules + table clarity)

- **Tarneeb:** the **minimum bid is now 3** (auction 3–13; scoring unchanged), and the **trump
  obligation** is enforced — void in the led suit while holding a trump means you **must trump**
  (you may discard another suit only when void in both). Enforced in the reducer (online too).
- **Deberc:** the 50-point run is spelled **"Палтіна" (Paltina)** everywhere (display only); the
  **skip-meld** button is red; **table cards are larger**.
- **Every game:** the **last card of a trick/bout now lingers ~2 seconds** (normalized) before play
  advances — including online Tarneeb/Preferans, which previously had no delay. The **card that led**
  the current trick shows a small **"1" badge + ring** so it's always clear who led.
- Deferred (with design notes in `RULES_UX_TODO.md`): profile/menu section split, Deberc trump
  exchange, Tarneeb "view my tricks", solo/individual variants, clockwise audit, reactions-over-sender.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Friend invite "Join" now works** (Stage 26.1): tapping **Join room** on an invite actually
  joins the inviter's room instead of doing nothing — at the menu it joins directly; from inside
  another room it confirms before leaving; in the same room it dismisses. The `?room=` deep-link
  still prefills the Join sheet. The invite still carries only a room code.
- **Tarneeb help text corrected** (Stage 27.8): the in-game "How to play" now says the auction
  **starts at 3** (3–13, all four languages), matching the shipped rule — the old "7–13" predated
  the Stage 27.0 minimum-bid change. Text only; no rule change.

## [0.3.0] — 2026-07-12 — Social & voice release

Adds the social layer on top of the five-game platform: **friends, room invites, online
rematch, and opt-in in-room voice chat** — plus a round of account/avatar production fixes
and gameplay polish. Additive and fairness-safe: no gameplay/scoring change; friends need
Postgres + migration `0009_friends.sql`.

### Added

- **Friends & presence** (Stage 25.1–25.9): add friends **by code** (never by email); an
  app-level presence connection shows who's **online** and drives an incoming-request **badge**
  on the Profile tile + Friends tab. Signed-in only; presence is per-instance.
- **Room invites**: a signed-in host can invite a friend into the current room from an
  **always-visible "Invite friends"** block in the Lobby (online friends first). The target gets
  a **Join/Dismiss** toast that reuses the `?room=` flow (never auto-joins); failures (offline /
  not friends / not in a room) surface a small non-fatal notice. The invite carries only a room
  code + display name.
- **Online rematch / Play again**: after a game finishes, Play again restarts the **same game in
  the same room** (same options/seats) instead of leaving to the menu. One human + bots restarts
  immediately (bots are always ready); multiple humans must **all** press Play again (no
  auto-start) and see who wants a rematch. In-memory only; a fresh game records its own stats.
- **In-room voice chat** (Stage 25.3–25.6, opt-in): a room-scoped **WebRTC mesh** (≤5) —
  Join/Mute/Leave in the Lobby card + a compact in-game mic, a safe status/debug block (Mic /
  Peers / ICE state / Audio), and reconnect that rebuilds the mesh. **No audio is stored,
  recorded, or sent through the server** (peer-to-peer; the server only relays signaling).
  STUN-only by default; a deployment adds a **TURN** relay via `VOICE_ICE_SERVERS` (runtime,
  `/api/voice/ice-config`) or `VITE_VOICE_ICE_SERVERS` (build-time) — credentials are env-only,
  never committed, and redacted from diagnostics. `/health/diagnostics` reports
  `voice.ice: stun_only|turn_configured`.

### Fixed

- **Fifty-One mobile table (Stage 38.0.4)** — two defects the owner hit on a phone, both
  reproduced as measured rectangles before being fixed.
  - **A laid-out meld no longer loses its last card.** The block was capped at 18rem while
    four cards plus their gaps need about 320px, and the card row was `nowrap` with an
    inner horizontal scroll — so a 4-card meld was clipped (measured at 360px: the fourth
    card spanned 278..350 inside a row that ended at 318) and a 7-card run showed only
    four cards. Melds now take the available width, the card size is viewport-responsive
    with the face aspect preserved, and a long run WRAPS onto the next line inside its own
    block. Every card of every meld is fully visible with a positive gap, nothing overlaps
    and nothing hides behind a scrollbar.
  - **The social buttons no longer sit on the cards.** Online Fifty-One now renders the
    same generic docked RoomSocial that Poker uses — in normal flow between the public
    melds and the prompt/actions/hand — so the microphone, reactions and chat cannot cover
    the table. Only one panel is open at a time; local play gets no social controls at all;
    the other games keep their floating cluster unchanged.
  - New gate `npm run layout:fiftyone` renders the real screen in a real browser and fails
    on any clipped/overlapping card, inner scroll, social-over-content intersection or page
    overflow — with `--legacy` reproducing the old CSS: **249 violations → 0** over 24
    checks at 360/390/desktop, 2/3/4 players, LTR and Arabic RTL.

- **Account / auth resilience** (Stage 24.2–24.5): a transient DB blip on `/api/me` no longer
  dead-ends the Profile (falls back to a guest view); a missing migration surfaces a clear
  `503 migration_required` instead of masquerading as a guest; live, secret-free auth
  diagnostics help pinpoint an unreachable/cross-origin API base.
- **Avatar upload production** (Stage 24.6–24.8): the "Uploading…" button can no longer hang
  (client timeout always settles); every server phase (body read / ffmpeg / DB write) is bounded
  with a distinct safe error; the browser now **compresses the image before upload** (a multi-MB
  photo POSTs a ~KB WebP), making a Render timeout unlikely.
- **Cards never render blank**: a slow / stalled / broken card image now falls back to the
  rank+suit text (shown until the artwork actually paints) instead of a blank card.
- **Last-card reveal delay**: the final card of a trick/bout lingers ~1 s so it can be read before
  play advances — in every game, now including Durak (its bout lingers before the table clears).
- **Voice audio reliability**: ICE candidates that arrived before the remote description are now
  buffered (they used to be dropped, stalling the connection); remote audio sinks are attached to
  the DOM for reliable mobile playback; a "TURN may be required" hint shows when every peer fails.

### Notes

- Real **cross-network voice** is a manual check (CI has no mic); strict/symmetric-NAT users need
  a **TURN** relay to connect P2P (otherwise they fall back to text chat).
- Production with Postgres must run **`npm run db:migrate`** after deploy (Friends need `0009`).

## [0.2.0] — 2026-07-11 — Five-game platform release

First tagged snapshot of the rebranded **Card Majlis** card lounge — five games,
online play, profiles, stats, and an installable PWA.

### Highlights

- **Rebrand:** the product is **Card Majlis** (internal ids stay `king` /
  `king-card-game` for compatibility).
- **Five games, all fully playable** (local pass-and-play **and** online):
  **King**, **Durak**, **Deberc**, **Tarneeb**, **Preferans** — each with bots.
- **Online rooms:** host/join by 4-letter code, invite links (`?room=CODE`),
  team lobby, reconnect + server restart recovery, AI substitute for a
  disconnected player, room browser with filters and auto-refresh.
- **Room social:** whitelisted emoji reactions, chat, and media stickers
  (server-validated, no uploads/URLs).
- **Identity & profile:** guest play, optional Google sign-in, 3-tier avatars
  (emoji / local image / server upload), favorite game, appearance (card back +
  face themes), animation and sound-alert preferences.
- **Progress:** per-game stats, public leaderboards, and derived achievements
  with an unlock toast.
- **PWA:** installable app shell, user-controlled "Update available" refresh,
  offline pill, and mobile safe-area / touch polish.
- **Ops:** optional **Docker** runtime with `ffmpeg` for server avatar upload;
  a safe public **`GET /health/diagnostics`** snapshot (build/commit, uptime,
  DB + avatar readiness, room + socket counts, game ids — no private data).

### Security & privacy

- Server-authoritative game state with per-client redaction (no hand leaks).
- WSS + CSRF protection, `scrypt` password hashing, per-connection and per-IP
  rate limits, origin allowlist.
- Diagnostics and logs expose only aggregate/routing info — never user ids,
  emails, room codes, session ids, tokens, chat, or cards.

### Known limitations

- **Single Node instance** — rooms/social live in one process; horizontal
  scaling needs sticky sessions or a shared store.
- **Postgres required** for profiles, auth, stats, and leaderboards; without
  `DATABASE_URL` those `503` and local/guest/online play still works.
- **Avatar upload needs `ffmpeg`** at runtime — the native Render runtime has
  none, so uploads `503` there; use the shipped Docker runtime (or `FFMPEG_PATH`).
- **No moderation console** yet (chat/stickers are whitelisted, not moderated).
- **Preferans post-MVP variants** (misère, распасы, whist, Sochi, 4-player) are
  documented but not implemented.

[0.2.0]: https://github.com/picez/king-game/releases/tag/v0.2.0
