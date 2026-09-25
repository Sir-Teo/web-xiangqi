import { parsePgnCollection } from '../utils/pgnCollection';
import { packCollectionGames } from '../utils/moveTreeTransfer';
self.onmessage = (event: MessageEvent<string>) => {
    try { self.postMessage({ games: packCollectionGames(parsePgnCollection(event.data)) }); }
    catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not read this collection.' }); }
};
