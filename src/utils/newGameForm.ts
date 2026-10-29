import { createFormStore } from './selectorStore';
import type { GameMode } from './gameModes';

export type NewGameFormState = {
    pendingGameMode: GameMode;
    fenInput: string;
    fenError: string | null;
    directImportBusy: boolean;
    moveLineFileDragActive: boolean;
    moveLineInput: string;
    moveLineFileName: string;
    moveLineFileUndo: { text: string; name: string } | null;
    moveLineError: string | null;
};

export function createNewGameForm() {
    return createFormStore<NewGameFormState>({ pendingGameMode: 'PvP', fenInput: '', fenError: null,
        directImportBusy: false, moveLineFileDragActive: false, moveLineInput: '', moveLineFileName: '',
        moveLineFileUndo: null, moveLineError: null });
}
export type NewGameFormStore = ReturnType<typeof createNewGameForm>;
