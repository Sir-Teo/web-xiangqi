export type EngineNotice = { tone: 'warning' | 'danger'; text: string } | null;
export type EngineHashFeedback = 'queued' | 'cleared' | null;
export type ExportFailureKey = 'copy-pgn' | 'download-pgn' | 'copy-share' | 'copy-fen' | 'copy-record' | `copy-pv-${number}`;
