export type HistoricalGame = {
  id: string;
  redPlayer: string;
  blackPlayer: string;
  event: string;
  date: string;
  result: 'red' | 'black' | 'draw';
  opening?: string;
  moves: string[];
};

// Moves are UCI strings (4 chars: fromFile+fromRank+toFile+toRank).
// Files: a-i (left→right from Red's view). Ranks: 0 (Red back) → 9 (Black back).
export const HISTORICAL_GAMES: HistoricalGame[] = [
  {
    id: 'hist-1',
    redPlayer: 'Hu Ronghua',
    blackPlayer: 'Liu Dahua',
    event: 'National Championship',
    date: '1977',
    result: 'red',
    opening: 'Central Cannon vs Screen Horse',
    moves: [
      'b2e2', 'h9g7', 'h0g2', 'b9c7',
      'a0a1', 'a9a8', 'a1d1', 'a8d8',
      'i0i1', 'i9i8', 'i1h1', 'i8g8',
      'e2a2', 'e6e5', 'a3a4', 'g6g5',
      'a4a5', 'g5g4', 'a2a6', 'g7f5',
      'a5b5', 'c7e6', 'a6a9', 'e6c5',
    ],
  },
  {
    id: 'hist-2',
    redPlayer: 'Liu Dahua',
    blackPlayer: 'Yang Guanlin',
    event: 'All-China Invitational',
    date: '1988',
    result: 'draw',
    opening: 'Counter Cannon',
    moves: [
      'b2e2', 'b7e7', 'h0g2', 'h9g7',
      'a0a1', 'a9a8', 'a1d1', 'a8d8',
      'i0i1', 'i9i8', 'i1h1', 'i8h8',
      'b0c2', 'b9c7', 'h2h4', 'h7h5',
      'h4g4', 'h5f5', 'g4e4', 'f5b5',
      'e4b4',
    ],
  },
  {
    id: 'hist-3',
    redPlayer: 'Zhao Guorong',
    blackPlayer: 'Xu Yinchuan',
    event: 'National Team Championship',
    date: '1993',
    result: 'draw',
    opening: 'Screen Horse Opening',
    moves: [
      'h0g2', 'b9c7', 'b0c2', 'h9g7',
      'a0a1', 'a9a8', 'a1d1', 'a8d8',
      'i0i1', 'i9i8', 'i1h1', 'i8g8',
      'b2b4', 'h7h5', 'b4d4', 'e6e5',
      'd4g4', 'h5h3',
    ],
  },
  {
    id: 'hist-4',
    redPlayer: 'Lü Qin',
    blackPlayer: 'Liu Dahua',
    event: 'National Individual Championship',
    date: '1990',
    result: 'black',
    opening: 'Flying Daggers — Central Cannon',
    moves: [
      'b2e2', 'h9g7', 'h0g2', 'b9c7',
      'a0a1', 'a9a8', 'a1d1', 'a8d8',
      'e2a2', 'e6e5', 'a2a6', 'g6g5',
      'a6a9', 'g7f5', 'a3a4', 'c7e6',
      'a4a5', 'e6g7',
    ],
  },
  {
    id: 'hist-5',
    redPlayer: 'Liu Dahua',
    blackPlayer: 'Lü Qin',
    event: 'National Championship Final',
    date: '1988',
    result: 'red',
    opening: 'Same-Side Cannon',
    moves: [
      'b2e2', 'b7e7', 'b0c2', 'h9g7',
      'a0a1', 'a9a8', 'a1d1', 'a8d8',
      'h0g2', 'b9c7', 'i0i1', 'i9i8',
      'i1h1', 'i8h8', 'h2h4', 'e6e5',
      'e2d2', 'e7e3',
    ],
  },
  {
    id: 'hist-6',
    redPlayer: 'Xu Yinchuan',
    blackPlayer: 'Zhao Guorong',
    event: 'Guangzhou Open',
    date: '1997',
    result: 'red',
    opening: 'Pawn Opening — Central Cannon',
    moves: [
      'e3e4', 'h9g7', 'b2e2', 'b7e7',
      'h0g2', 'b9c7', 'a0a1', 'a9a8',
      'a1d1', 'a8d8', 'i0i1', 'i9i8',
      'i1h1', 'i8g8', 'h2h4', 'e7f7',
    ],
  },
  {
    id: 'hist-7',
    redPlayer: 'Hu Ronghua',
    blackPlayer: 'Xu Yinchuan',
    event: 'World Xiangqi Championship',
    date: '1999',
    result: 'black',
    opening: 'Elephant Defense',
    moves: [
      'b2e2', 'c9e7', 'h0g2', 'g9i7',
      'b0c2', 'h9g7', 'a0a1', 'a9a8',
      'a1d1', 'a8d8', 'i0i1', 'i9i8',
      'i1h1', 'i8g8', 'h2h4', 'd9e8',
    ],
  },
  {
    id: 'hist-8',
    redPlayer: 'Hu Ronghua',
    blackPlayer: 'Wang Jiayuan',
    event: 'National Individual Championship',
    date: '1982',
    result: 'red',
    opening: 'Central Cannon vs Pawn Formation',
    moves: [
      'b2e2', 'e6e5', 'h0g2', 'h9g7',
      'a0a1', 'a9a8', 'a1d1', 'a8d8',
      'i0i1', 'i9i8', 'i1h1', 'i8g8',
      'h2h4', 'c6c5', 'd1d6', 'c7e6',
      'g3g4', 'g7e8',
    ],
  },
  {
    id: 'hist-9',
    redPlayer: 'Lü Qin',
    blackPlayer: 'Zhao Guorong',
    event: 'National Team Championship Final',
    date: '1991',
    result: 'red',
    opening: 'Ranked Cannon — Screen Horse',
    moves: [
      'b2e2', 'h9g7', 'h2h4', 'b9c7',
      'h0g2', 'a9a8', 'a0a1', 'a8d8',
      'a1d1', 'i9i8', 'i0i1', 'i8g8',
      'b0c2', 'e6e5', 'i1h1', 'g6g5',
      'h4h6', 'g7h5',
    ],
  },
  {
    id: 'hist-10',
    redPlayer: 'Yang Guanlin',
    blackPlayer: 'Hu Ronghua',
    event: 'National Championship',
    date: '1973',
    result: 'draw',
    opening: 'Central Cannon vs Screen Horse',
    moves: [
      'b2e2', 'h9g7', 'h0g2', 'b9c7',
      'a0a1', 'a9a8', 'a1d1', 'a8d8',
      'i0i1', 'i9i8', 'i1h1', 'i8g8',
      'h2h4', 'e6e5', 'h4h6', 'g7h5',
      'h6h9', 'h5g3', 'e2e5',
    ],
  },
];
