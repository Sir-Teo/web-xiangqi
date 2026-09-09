import { parsePgnCollection } from '../utils/pgnCollection';
self.onmessage = (event: MessageEvent<string>) => {
    try { self.postMessage({ games: parsePgnCollection(event.data) }); }
    catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not read this collection.' }); }
};
