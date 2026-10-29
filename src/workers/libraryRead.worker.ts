import { parseLibraryState } from '../utils/gameLibrary';
import { packCollectionGames } from '../utils/moveTreeTransfer';

self.onmessage = (event: MessageEvent<string>) => {
    const state = parseLibraryState(event.data);
    self.postMessage({ games: packCollectionGames(state.games), mutationBlocked: state.mutationBlocked });
};
