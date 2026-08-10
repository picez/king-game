# Card Majlis — owner smoke guide (start here)

A human walkthrough of the live app. Ten checks, top to bottom. Each one says what to do, what
counts as **PASS**, and what it does **not** prove — because a check that quietly overclaims is
worse than no check at all.

- **App:** https://king-game-cqgd.onrender.com (or your custom domain)
- **Heads-up:** the free Render tier **cold-starts** — the first page/API hit can take ~1 minute.
  That is not a bug.
- The detailed PASS/FAIL/BLOCKED log lives in
  [`PRODUCTION_SMOKE_LOG_TEMPLATE.md`](PRODUCTION_SMOKE_LOG_TEMPLATE.md); the exhaustive technical
  pass is [`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md); deep per-game QA is
  [`QA_CHECKLIST.md`](QA_CHECKLIST.md).

## The three states — use them honestly

Write one of these beside every check. There is no fourth state, and **NOT RUN is not a failure** —
it is the truth about what you did.

| State | Means |
| --- | --- |
| **PASS** | You performed the check and saw the expected result **yourself**. |
| **FAIL** | You performed the check and saw something else. File it (see "How to report a bug"). |
| **NOT RUN** | You skipped it, were blocked, or could not get the second account / device / chips. |

> **Never mark PASS by inference.** "Poker opened, so the wallet must work" is NOT a PASS for the
> wallet check. A release is only PASS when every check below is genuinely PASS.

## What you need

- **2 devices** (or 2 browsers/profiles) and **2 Google accounts** — checks 8 and 9 are impossible
  with one account, and most of the value is in the *online* behaviour.
- A phone at a small width (**360–390px**) for check 5; set the language to **Arabic** once for
  check 6.
- A **wide desktop window** — at least **1700px** — for checks 3 and 4. A 1366px laptop cannot run
  them; mark them NOT RUN rather than guessing.
- Optional: a headset/mic on both devices for voice.

---

## 1. Diagnostics — version, commit, db, games

Open `…/health/diagnostics`.

- **PASS when:** `version` matches the release you deployed, `commit` matches the commit you
  expect, `db: "enabled"`, and `games.count: 7` with `games.ids` containing
  `king, durak, deberc, tarneeb, preferans, fifty-one, poker`.
- **Does NOT prove:** anything about the database *schema*. `db: "enabled"` only means the server
  reached Postgres and the four user-settings columns from migrations 0005–0008 are present. It
  says nothing about migrations 0009–0014 — that is check 2.

## 2. Migration evidence (0009–0014) — what each check really proves

**There is no migration ledger and no endpoint that reports which migrations ran.** The only
authoritative proof is the `npm run db:migrate` transcript itself, which prints one
`applied <file>.sql` line per file and a final `done (15 file(s))`. Everything below is
*indirect*: a feature that would fail on the missing table/column succeeded, so the migration
behind it must have run.

**Owner-provided migration evidence:** a `npm run db:migrate` run against the Render External
Database URL completed with `applied 0014_online_matches.sql` and `done (15 file(s))`. 15 files is
exactly the number of `.sql` files in `server/db/migrations/` (`0000` … `0014`), and `0014` is the
last of them — so that transcript is consistent with a full, in-order run and is the strongest
evidence available for the whole 0000–0014 range.

| Migration | Check you can run | A success proves | It does NOT prove |
| --- | --- | --- | --- |
| **0009** friends | Sign in, open Friends → your **friend code** appears and the list loads (`GET /api/friends`) | `users.friend_code` and the `friendships` table exist | The indexes or the `status`/self-friend CHECK constraints |
| **0010** wallet + ledger | Profile/Poker host flow → **claim the daily chips** (`POST /api/me/poker-wallet/daily-claim`) | **Both** `poker_wallets` **and** `poker_ledger` exist and are writable | Nothing about 0011–0014. Merely *viewing* the balance (`GET …/poker-wallet`) proves only `poker_wallets` — not the ledger |
| **0011** settlements | Play a real-stakes online Poker match to the end and watch the chips land (payout) or come back (refund) | Only *circumstantially* — the settlement transaction completed | Nothing directly. There is **no read path** for this table; a rollback anywhere in that same transaction looks identical from outside |
| **0012** matches | **Buy in** to a real-stakes online Poker table (chips visibly debited, table opens) | `poker_matches` exists — and so do `poker_wallets`/`poker_ledger`, because the durable match row is written in the *same* transaction as the debits | The room index; nothing about 0011 or 0014 |
| **0013** rebuy | Bust mid-match and use the in-game **rebuy** | The widened `poker_ledger.reason` CHECK accepts `table_rebuy` — nothing else could make that write legal | Anything outside that one constraint. A rebuy *failing* is ambiguous; a rebuy *succeeding* is unambiguous |
| **0014** online matches | Finish an online match in any of the **6 non-Poker** games, then open Profile → Statistics → **online participation tracker** (`GET /api/me/online-tracker`) and see the counter move off zero | `online_matches` + `online_match_participants` exist and their CHECKs accept the real values | Anything via Poker — **0014 deliberately never records Poker** (its chip economy settles separately) |

Mark each row PASS / FAIL / **NOT RUN** separately. 0011 and 0013 need real chips and a second
account; NOT RUN is the honest answer if you did not stake anything.

## 3. King on a wide desktop — chat closed / open / picker

Open a **King** online room in a window **≥ 1700px wide**.

- Note the table's position and size with the chat **closed**.
- Open the chat (💬). Open the emoji/sticker **picker**.
- **PASS when:** in all three states the table does **not** move, does **not** shrink and does
  **not** scroll — the chat opens in the empty band *beside* it — **and** you can still play:
  click a legal card with the chat open and the move registers, exactly once, while the turn timer
  keeps running.
- **Does NOT prove:** anything about narrower widths — that is check 4.

## 4. Adaptive sidecar — the boundary widths

The side panel is **earned by the game declaring its scene width**, not by the screen simply being
wide. Only two games declare one:

| Game | Scene width | Chat opens beside from |
| --- | --- | --- |
| **King** | 900px | **1668px** |
| **Poker** | 704px | **1472px** |
| Durak, Deberc, Tarneeb, Preferans, Fifty-One | *(uses the full width)* | never — the chat always follows below |

Resize the window across each boundary with the chat open:

- **PASS when:** King flips to a side panel at **1668px and above** and back to a panel *below* the
  table under it; Poker does the same at **1472px**; the other five games **never** show a side
  panel at any width; and in every case the table itself keeps the full layout width — the chat
  never takes space away from the game.
- **Does NOT prove:** phone behaviour — that is check 5.

## 5. Mobile 360/390 — King, Poker, Fifty-One

On a phone (or a 360px and a 390px viewport), open **King**, **Poker** and **51**.

- **PASS when:** no sideways scrolling anywhere; the chat opens **in normal flow below the table**
  (the mobile fallback — there is no sidecar on a phone) and **never** covers the table, dims the
  page or blocks a tap; gameplay still works with the chat open. The hand may end up below the
  fold with the chat open — that is expected, scroll to it.
- **Does NOT prove:** right-to-left correctness — that is check 6.

## 6. Arabic (RTL)

Switch the language to **Arabic** once and revisit the menu, one game table and the profile.

- **PASS when:** the layout mirrors correctly, nothing overflows sideways, and the chat, the
  picker and the seat-anchored reactions land on the mirrored side.

## 7. Rich chat — text + one animated sticker

In any online room:

- Type a message, then attach **one animated sticker**, then Send.
- **PASS when:** the text and the sticker arrive as **ONE message in ONE bubble**; picking another
  sticker **replaces** the attachment rather than adding a second; remove clears it; sending with
  no text still posts the sticker alone. Only **GIF** stickers are offered.
- **Emoji destination (the rule to check deliberately):** the intent is read when your finger goes
  **down**, not when it comes up. With the message field **focused/being typed in**, tapping an
  emoji **inserts it at the caret** and sends nothing. With the field **not** focused, the same tap
  posts **one seat-anchored table reaction** and leaves your draft untouched. Try both.

## 8. Poker with two authenticated accounts

Both accounts signed in (not guests) — online Poker refuses guests and bots by design.

- [ ] **Claim** the daily chips on each account (once per UTC day).
- [ ] **Buy in** to a stakes table → the buy-in is debited **exactly once** on each account.
- [ ] **Reload the page** mid-match → you return to your seat and are **not** debited a second time.
- [ ] **Hole-card privacy** → each player sees only their own hole cards; the other seats are
      face-down for you, and yours are face-down for them.
- [ ] **Rebuy** after busting → chips restored (this is also the 0013 evidence).
- [ ] **Payout** at the end → the winner's chips arrive and the total is conserved.
- [ ] **Refund** path → abandon/tear down a table before it finishes → the buy-ins come back, and
      the money is **either** paid out **or** refunded, never both.
- [ ] **Rematch** → starts a **new paid match** with a **new match id**; the previous one must be
      settled first.
- **PASS when:** every line above is individually true. If you could not get a second account, mark
  the whole check **NOT RUN** — do not infer it from a single-account session.

## 9. Online statistics — three separate buckets

Profile → Statistics → online participation tracker.

- **PASS when:** **online human-only** and **online with-bots** are shown as **separate** counters
  and are never summed together; and a **local pass-and-play** game you just finished changes
  **neither** of them. Local play creates no online match record at all — by construction, not by a
  filter.
- **Note, not a bug:** Poker never appears in this tracker. It is deliberately out of scope.

## 10. Record the result

Tick every check above as **PASS / FAIL / NOT RUN** in
[`PRODUCTION_SMOKE_LOG_TEMPLATE.md`](PRODUCTION_SMOKE_LOG_TEMPLATE.md). A release may only be
called PASS when every one of the ten is genuinely PASS — a checklist with NOT RUN rows is an
honest, incomplete pass, and should be reported as exactly that.

---

## How to report a bug

For anything marked **FAIL**, capture these — it's the difference between a fix and a
back-and-forth:

- **Game** (King / Durak / Deberc / Tarneeb / Preferans / 51 / Poker) and **Local or Online**.
- **Room code** if online and it's safe to share.
- **Exact steps** to reproduce, in order.
- **Expected** vs **Actual** result.
- **Screenshot or short video** (a clip beats a description).
- **Browser + device** (e.g. Chrome 128 on Pixel 7) and **viewport width** — essential for checks 3
  to 6, where the width *is* the behaviour.
- **`diagnostics` `version` + `commit`** at the time (from `…/health/diagnostics`).
- Whether you tried a **hard refresh** (Ctrl/Cmd-Shift-R) and, if installed as an app, tapped the
  **"Update available"** refresh — this rules out a stale cached version.

## What is *not* a product bug

Don't file these as bugs — they're deploy/config/environment, and each has a known cause:

- **Version/commit doesn't match the release yet** — the deploy is still rolling out. Wait for
  Render to finish, then hard-refresh and re-check `…/health/diagnostics`.
- **No side panel on a 1366px laptop** — expected. The sidecar starts at 1668px (King) / 1472px
  (Poker), and the other five games never have one. See check 4.
- **The hand sits below the fold with the chat open on a phone** — expected, deliberate. The chat
  is in normal flow so it can never cover or block the table.
- **Poker refuses a guest account or a bot** — expected. Online Poker is bankroll-only and
  authenticated-humans-only. Local Poker is free play and has no wallet.
- **Poker missing from the online participation tracker** — expected, by design.
- **Cross-network voice fails / falls back to text** — voice needs a **TURN** relay for strict NATs
  (mobile data especially). Same-Wi-Fi should work; cross-network needs `VOICE_ICE_SERVERS`
  configured.
- **No iOS App Store app** — iOS is **PWA-only** for now (Add to Home Screen); a native iOS app is
  a later decision, not shipped.
- **Android TWA opens with a URL/address bar (Custom Tab)** — expected for a debug build until a
  real `/.well-known/assetlinks.json` (with the **Play App-Signing SHA-256**) is deployed. See
  [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) §9.
- **Google login fails with `redirect_uri_mismatch`** — the login origin isn't registered in the
  Google OAuth client. A config fix (add `…/auth/callback`), not a code bug — see
  [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md).
- **Avatar upload returns 503** — only on a non-Docker/no-ffmpeg host; that path is expected to
  503. On the current deploy (`avatarUploads.ffmpeg: true`) it should work.

When in doubt, note it and share it — the
[triage table in the log template](PRODUCTION_SMOKE_LOG_TEMPLATE.md#triage-rules--classify-every-fail-before-filing)
sorts a real bug from a config/environment/cache issue.
