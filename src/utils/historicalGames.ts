export type HistoricalGame = {
  id: string;
  redPlayer: string;
  blackPlayer: string;
  event: string;
  date: string;
  result: 'red' | 'black' | 'draw';
  opening?: string;
  /**
   * Where the moves came from, and the field whose absence let the old set in.
   *
   * Required, not optional. Both sibling apps have one -- web-katrain records
   * `source: 'go4go.com'` beside bundled SGFs, web-chess stores a
   * `lichessGameId` and fetches the moves -- and this file's own note said the
   * lack of one made these records "merely asserted" rather than checkable.
   * It was right.
   */
  source: string;
  moves: string[];
};

/**
 * Empty, deliberately. What was here did not come from the games it named.
 *
 * Ten entries were attributed to real, named grandmasters with specific events
 * and dates -- "Hu Ronghua vs Liu Dahua, National Championship, 1977" and so
 * on. They are not those games:
 *
 * - **Seven of the ten contained the identical eight-move block**
 *   `a0a1 a9a8 a1d1 a8d8 i0i1 i9i8 i1h1 i8g8`, six of them as a consecutive
 *   run. For four of the entries that one block was half of the whole "game".
 *   Ten games between different players across 1973-1991 do not share eight
 *   moves in the same order.
 * - **That block hangs a chariot.** After it, red's chariot on d1 and black's
 *   on d8 face each other down a completely open file. In `hist-1`, black
 *   plays `a8d8` into that, and red -- Hu Ronghua -- declines a free chariot to
 *   play `i0i1` instead.
 * - **Two of the ten contained moves that are not legal at all**, which is how
 *   this started: they had been loading silently truncated because
 *   `loadMoves` stops at the first illegal move without saying so.
 * - Running the app's own Game Review over them scored these grandmasters at
 *   20-28% accuracy with seven to ten blunders each, against 7% for a control
 *   of randomly generated moves. The review was right; the data was not.
 *
 * So the section is empty rather than wrong. Everything around it -- the type,
 * the loader, the library UI, the replay test -- is intact, and a set of real
 * games with `source` on each drops straight back in.
 *
 * ## Before adding any
 *
 * Three things this file learned the hard way, and one it learned tonight:
 *
 *  - **Give every entry a `source`.** It is required for the reason above.
 *  - **An excerpt cannot carry an outcome of its own.** These were the first
 *    eight to twelve moves a side; competitive xiangqi runs 60 to 120 plies, so
 *    a `result` beside a short line is a fact about the game it was taken from
 *    and has to be framed that way. The section was called "Classic Games",
 *    each card carried a decisive result badge, and Game Review scored the
 *    excerpt as a finished game.
 *  - **`historicalGames.test.ts` replays every line through the rules engine.**
 *    Nothing else does: `handleLoadHistoricalGame` calls `loadMoves` without
 *    validating, unlike saved games, and `loadMoves` stops at the first illegal
 *    move without saying so -- so a bad entry loads short and looks complete
 *    while the card's label, built from the data, advertises the full length.
 *  - **Play a few of them through Game Review before committing.** That is what
 *    caught this: a real grandmaster opening does not score 25% accuracy with
 *    eight blunders, and a control of random moves scored 7%.
 */
export const HISTORICAL_GAMES: HistoricalGame[] = [];
