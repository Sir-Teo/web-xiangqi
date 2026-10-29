import { prepareAutoSavedGame, type AutoSaveInput } from '../utils/autoSave';
import { unpackCollectionGames, type PackedGame } from '../utils/moveTreeTransfer';

self.onmessage = (event: MessageEvent<{ game: PackedGame<AutoSaveInput>; savedAt: number }>) => {
    try {
        const game = unpackCollectionGames<AutoSaveInput>([event.data.game])[0];
        self.postMessage(prepareAutoSavedGame(game, event.data.savedAt));
    } catch { self.postMessage({ result: 'failed' }); }
};
