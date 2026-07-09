// ---------------------------------------------------------------------------
// Guest → account merge (Stage 6 — Google sign-in).
//
// When a user with a GUEST session signs in with Google and that Google account
// already belongs to ANOTHER (real) user, we fold the guest's data into the real
// account so nothing is lost: settings, per-game settings, King stats, and the
// guest's historical game participation. The guest user row is then retired
// (soft-deleted, `guest_key` freed) and its sessions revoked.
//
// (The FIRST-time Google sign-in for a guest takes a simpler path in the API —
// the guest user is PROMOTED in place, no merge needed.)
//
// Everything runs in ONE transaction and is IDEMPOTENT: the merge only proceeds
// when the source is still a live guest, and it removes/repoints the source's
// rows, so a replayed callback no-ops instead of double-counting stats.
// Multi-game safe: stats/settings merge per `game_type`. Bots are never touched
// (they have no user_id). See ARCHITECTURE_DB_AUTH.md §2.11/§5.
// ---------------------------------------------------------------------------

import { eq, and, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users, userSettings, userGameSettings, gamePlayers, games, sessions } from './schema';
import { getDb } from './client';
import { mergeUserStatsInto } from './stats';

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('merge repository requires DATABASE_URL (Postgres).');
  return conn.db as PostgresJsDatabase;
}

/** Fills the target's global settings from the guest's, where the target is unset. */
async function mergeSettings(tx: PostgresJsDatabase, fromId: string, toId: string): Promise<void> {
  const from = (await tx.select().from(userSettings).where(eq(userSettings.userId, fromId)).limit(1))[0];
  if (!from) return;
  const to = (await tx.select().from(userSettings).where(eq(userSettings.userId, toId)).limit(1))[0];
  if (!to) {
    await tx.update(userSettings).set({ userId: toId }).where(eq(userSettings.userId, fromId));
    return;
  }
  // Keep the target's non-default choices; otherwise inherit the guest's.
  const lang = to.lang && to.lang !== 'en' ? to.lang : (from.lang ?? to.lang);
  const avatar = to.avatar ?? from.avatar;
  const cardStyle = to.cardStyle && to.cardStyle !== 'classic' ? to.cardStyle : (from.cardStyle ?? to.cardStyle);
  const animationPreference = to.animationPreference && to.animationPreference !== 'system'
    ? to.animationPreference
    : (from.animationPreference ?? to.animationPreference);
  await tx.update(userSettings).set({ lang, avatar, cardStyle, animationPreference, updatedAt: new Date() })
    .where(eq(userSettings.userId, toId));
  await tx.delete(userSettings).where(eq(userSettings.userId, fromId));
}

/** Moves the guest's per-game settings to the target where the target lacks them. */
async function mergeGameSettings(tx: PostgresJsDatabase, fromId: string, toId: string): Promise<void> {
  const fromRows = await tx.select().from(userGameSettings).where(eq(userGameSettings.userId, fromId));
  for (const fr of fromRows) {
    const to = (await tx.select().from(userGameSettings)
      .where(and(eq(userGameSettings.userId, toId), eq(userGameSettings.gameType, fr.gameType))).limit(1))[0];
    if (!to) {
      await tx.update(userGameSettings).set({ userId: toId })
        .where(and(eq(userGameSettings.userId, fromId), eq(userGameSettings.gameType, fr.gameType)));
    } else {
      await tx.delete(userGameSettings)
        .where(and(eq(userGameSettings.userId, fromId), eq(userGameSettings.gameType, fr.gameType)));
    }
  }
}

export interface MergeResult { merged: boolean; reason?: string }

/**
 * Merges a guest user into a target (real) account. Returns `{ merged:false }`
 * (with a reason) when it would be unsafe or unnecessary: same user, missing
 * rows, or the source is no longer a guest (already merged → idempotent no-op).
 */
export async function mergeGuestInto(guestUserId: string, targetUserId: string): Promise<MergeResult> {
  if (!guestUserId || !targetUserId || guestUserId === targetUserId) return { merged: false, reason: 'noop' };
  const db = await database();
  return db.transaction(async (tx) => {
    const guest = (await tx.select().from(users).where(eq(users.id, guestUserId)).limit(1))[0];
    const target = (await tx.select().from(users).where(eq(users.id, targetUserId)).limit(1))[0];
    if (!guest || !target) return { merged: false, reason: 'missing' };
    // Only ever fold a GUEST away — never merge two real accounts automatically.
    if (!guest.isGuest) return { merged: false, reason: 'not_a_guest' };

    await mergeSettings(tx, guestUserId, targetUserId);
    await mergeGameSettings(tx, guestUserId, targetUserId);
    await mergeUserStatsInto(tx, guestUserId, targetUserId);

    // Repoint historical participation + winner attribution to the real account.
    await tx.update(gamePlayers).set({ userId: targetUserId }).where(eq(gamePlayers.userId, guestUserId));
    await tx.update(games).set({ winnerUserId: targetUserId }).where(eq(games.winnerUserId, guestUserId));

    // Carry over a custom display name only if the target has none.
    if ((!target.displayName || !target.displayName.trim()) && guest.displayName?.trim()) {
      await tx.update(users).set({ displayName: guest.displayName, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));
    }

    // Revoke the guest's sessions and retire the guest row (frees guest_key).
    await tx.update(sessions).set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, guestUserId), isNull(sessions.revokedAt)));
    await tx.update(users).set({
      isGuest: false, status: 'merged', deletedAt: new Date(), guestKey: null, updatedAt: new Date(),
    }).where(eq(users.id, guestUserId));

    return { merged: true };
  });
}
