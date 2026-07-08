// ---------------------------------------------------------------------------
// Cross-game state/action unions (Stage 9.5).
//
// The online transport carries whichever game a room runs. These unions let the
// protocol (messages.ts), the server (serverCore.ts), and persistence hold King,
// Durak, Deberc OR Tarneeb state/action without King's shapes changing. Type-only
// — no runtime (no game engine is pulled into a build by importing these types).
// All four games run online today.
// ---------------------------------------------------------------------------

import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import type { DurakState, DurakAction } from './durak/types';
import type { DebercState, DebercAction } from './deberc/types';
import type { TarneebState, TarneebAction } from './tarneeb/types';

export type AnyGameState = GameState | DurakState | DebercState | TarneebState;
export type AnyGameAction = GameAction | DurakAction | DebercAction | TarneebAction;
