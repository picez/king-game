// ---------------------------------------------------------------------------
// Cross-game state/action unions (Stage 9.5).
//
// The online transport carries whichever game a room runs. These unions let the
// protocol (messages.ts), the server (serverCore.ts), and persistence hold King,
// Durak, Deberc, Tarneeb, Preferans OR 51 state/action without King's shapes
// changing. Type-only — no runtime (no game engine is pulled into a build by
// importing these types). Five games run online today (Preferans released — Stage
// 19.7); 51 is in the union for online READINESS only (Stage 30.4 — serverCore can
// hold/redact/serialize its state) while it stays gated OFF at CREATE_ROOM
// (supportsOnline=false), so no online 51 room is actually creatable yet.
// ---------------------------------------------------------------------------

import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import type { DurakState, DurakAction } from './durak/types';
import type { DebercState, DebercAction } from './deberc/types';
import type { TarneebState, TarneebAction } from './tarneeb/types';
import type { PreferansState, PreferansAction } from './preferans/types';
import type { FiftyOneState, FiftyOneAction } from './fiftyOne/types';

export type AnyGameState = GameState | DurakState | DebercState | TarneebState | PreferansState | FiftyOneState;
export type AnyGameAction = GameAction | DurakAction | DebercAction | TarneebAction | PreferansAction | FiftyOneAction;
