export type GameMode = 'PvP' | 'PvAI-Black' | 'PvAI-Red' | 'AIvAI';

export const GAME_MODES: Array<{ mode: GameMode; label: string; shortLabel: string; description: string }> = [
  { mode: 'PvP', label: 'Local board', shortLabel: 'Local', description: 'Two players, one board, no engine moves.' },
  { mode: 'PvAI-Black', label: 'You play Red', shortLabel: 'Red vs AI', description: 'Red moves first while the engine replies as Black.' },
  { mode: 'PvAI-Red', label: 'You play Black', shortLabel: 'Black vs AI', description: 'The engine starts as Red, then you defend as Black.' },
  { mode: 'AIvAI', label: 'AI exhibition', shortLabel: 'AI vs AI', description: 'Both sides are engine-driven for watching and review.' },
];
