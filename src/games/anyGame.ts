// ---------------------------------------------------------------------------
// Cross-game state/action unions (Stage 9.5).
//
// The online transport carries whichever game a room runs. These unions let the
// protocol (messages.ts), the server (serverCore.ts), and persistence hold King,
// Durak, Deberc, Tarneeb, Preferans OR 51 state/action without King's shapes
// changing. Type-only — no runtime (no game engine is pulled into a build by
// importing these types). All six games run online today — 51 was released as the
// 6th `available` game at Stage 30.7 (online since Stage 30.5).
// ---------------------------------------------------------------------------

import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import type { DurakState, DurakAction } from './durak/types';
import type { DebercState, DebercAction } from './deberc/types';
import type { TarneebState, TarneebAction } from './tarneeb/types';
import type { PreferansState, PreferansAction } from './preferans/types';
import type { FiftyOneState, FiftyOneAction } from './fiftyOne/types';
import type { PokerState, PokerAction } from './poker/types';

export type AnyGameState = GameState | DurakState | DebercState | TarneebState | PreferansState | FiftyOneState | PokerState;
export type AnyGameAction = GameAction | DurakAction | DebercAction | TarneebAction | PreferansAction | FiftyOneAction | PokerAction;
