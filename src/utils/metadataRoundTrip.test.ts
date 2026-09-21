import { describe, expect, it } from 'vitest';
import { exportPgnFromMoveTree } from './gameExport';
import { parsePgnCollection } from './pgnCollection';
import { normalizeGameMetadata, type GameMetadata } from './gameMetadata';
import type { SavedMoveTreeNode } from './gameLibrary';

/**
 * Tournament details out to PGN and back.
 *
 * `docs/audit-2026-09-07.md` lists this as an open P1 -- "Tournament metadata
 * is not preserved end to end; `SavedGame` has no red/black player, event,
 * round, or original game date fields" -- and names the criterion: import,
 * edit, save, reload, export, with players, event, date, round, site and
 * result intact, "including escaped names". `SavedGame` has carried
 * `metadata` for some time now, so this checks whether the recommendation is
 * still open or merely unclosed.
 *
 * The escaping half is the part worth having either way: a player called
 * `Wang "Tiger" Lei` puts a quote inside a PGN tag value, and a name ending in
 * a backslash puts an escape at the very edge of one.
 */
const TREE: SavedMoveTreeNode[] = [{ uci: 'h2e2', children: [{ uci: 'h9g7' }] }];

function roundTrip(metadata: GameMetadata) {
    const pgn = exportPgnFromMoveTree(TREE, { metadata, mainLineMoves: ['h2e2', 'h9g7'] });
    expect(pgn, 'the exporter refused a legal tree').not.toBeNull();
    const [game] = parsePgnCollection(pgn!);
    expect(game, 'the strict reader refused our own export').toBeTruthy();
    return game.metadata;
}

describe('tournament details survive export and re-import', () => {
    it('keeps every field the editor offers', () => {
        const metadata: GameMetadata = {
            redPlayer: 'Hu Ronghua', blackPlayer: 'Yang Guanlin',
            redRating: '2650', blackRating: '2600',
            event: 'National Championship', site: 'Guangzhou',
            date: '1977.10.02', round: '7',
            timeControl: '90+30', annotator: 'Qa',
        };
        const read = roundTrip(metadata);
        for (const [field, value] of Object.entries(normalizeGameMetadata(metadata)!)) {
            expect(read?.[field as keyof GameMetadata], `field ${field}`).toBe(value);
        }
    });

    it('keeps a name that contains a quote', () => {
        const read = roundTrip({ redPlayer: 'Wang "Tiger" Lei', event: 'Club "Open" Night' });
        expect(read?.redPlayer).toBe('Wang "Tiger" Lei');
        expect(read?.event).toBe('Club "Open" Night');
    });

    it('keeps a name that ends in a backslash', () => {
        // The escape at the very edge of a tag value: written wrong it escapes
        // the closing quote and swallows the rest of the tag pair.
        const read = roundTrip({ redPlayer: 'Lee\\', blackPlayer: 'Chen' });
        expect(read?.redPlayer).toBe('Lee\\');
        expect(read?.blackPlayer).toBe('Chen');
    });
});
