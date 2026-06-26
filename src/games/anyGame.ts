// ---------------------------------------------------------------------------
// Cross-game state/action unions (Stage 9.5).
//
// The online transport carries whichever game a room runs. These unions let the
// protocol (messages.ts), the server (serverCore.ts), and persistence hold King
// OR Durak state/action without King's shapes changing. Type-only — no runtime
// (the durak engine is NOT pulled into a build by importing these types).
// ---------------------------------------------------------------------------

import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import type { DurakState, DurakAction } from './durak/types';

export type AnyGameState = GameState | DurakState;
export type AnyGameAction = GameAction | DurakAction;
