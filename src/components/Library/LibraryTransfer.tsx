import { withLibraryMutation, LIBRARY_LOCK_ERROR } from '../../utils/libraryMutation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  exportLibraryBackup, loadLibraryState, MAX_LIBRARY_JSON_LENGTH,
  previewLibrarySalvage, salvageLibrary, latestLibraryRecovery,
  previewLibraryRestore, restoreLibraryBackup,
  type LibraryRestorePreview, type LibraryRestoreChoices, type LibraryState,
} from '../../utils/gameLibrary';
import { downloadTextFile } from '../../utils/gameExport';

export function LibraryTransfer({ state, onChange }: { state: LibraryState; onChange: () => void }) {
  const salvage = useMemo(() => state.mutationBlocked ? previewLibrarySalvage(state.raw) : null, [state]);
  const originalRecovery = latestLibraryRecovery();
  const [pending, setPending] = useState<{ text: string; preview: LibraryRestorePreview; choices: LibraryRestoreChoices } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const restoreInput = useRef<HTMLInputElement>(null);
  const restorePreview = useRef<HTMLDivElement>(null);
  const backupSummary = useRef<HTMLElement>(null);
  const restoringRef = useRef(false);
  const [restoring, setRestoring] = useState(false);
  const initiatingControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (restoring) return;
    const target = initiatingControl.current;
    initiatingControl.current = null;
    // Chromium blurs a focused button as soon as it becomes disabled. Keep it
    // ready for retry, or continue to backups when successful repair removes it.
    if (target && document.activeElement === document.body) {
      (target.isConnected ? target : backupSummary.current)?.focus();
    }
  }, [restoring]);
  useEffect(() => () => { generation.current += 1; }, []);

  function download(kind: 'backup' | 'recovery' | 'archived') {
    setError('');
    setMessage('');
    const text = kind === 'archived' ? latestLibraryRecovery() : kind === 'recovery' ? loadLibraryState().raw : exportLibraryBackup();
    if (text === null) {
      setError('The library could not be read. No download was created.');
      onChange();
      return;
    }
    const filename = kind === 'archived' ? 'xiangqi-library-original-recovery.json'
      : `xiangqi-library-${kind === 'recovery' ? 'recovery-' : ''}${new Date().toISOString().slice(0, 10)}.json`;
    if (downloadTextFile(filename, text, 'application/json;charset=utf-8')) {
      setMessage(kind === 'archived' ? 'Archived original download started. Keep this file before making further repairs.'
        : kind === 'recovery' ? 'Recovery download started. Keep this original file before repairing the data.' : 'Backup download started. Keep the file somewhere safe.');
    } else setError('The download could not start. Please try again.');
  }

  async function selectFile(file: File | undefined) {
    const current = ++generation.current;
    setPending(null);
    setMessage('');
    setError('');
    if (!file) return;
    // UTF-8 can use three bytes per UTF-16 code unit. Bound allocation before reading.
    if (file.size > (MAX_LIBRARY_JSON_LENGTH + 1024) * 3) {
      setError('This backup is too large.');
      return;
    }
    try {
      const text = await file.text();
      if (current !== generation.current) return;
      const preview = previewLibraryRestore(text);
      if (preview.error) setError(preview.error);
      else setPending({ text, preview, choices: Object.fromEntries((preview.conflicts ?? []).map(conflict => [conflict.id, { choice: 'keep', expected: JSON.stringify(conflict.current) }])) });
    } catch {
      if (current === generation.current) setError('This file could not be read. Please try again.');
    }
  }

  function closePreview(restoreLostFocus = false) {
    if (restorePreview.current?.contains(document.activeElement) || (restoreLostFocus && document.activeElement === document.body)) restoreInput.current?.focus();
    setPending(null);
  }

  async function restore() {
    if (!pending || restoringRef.current) return;
    const focused = document.activeElement;
    initiatingControl.current = focused instanceof HTMLElement && restorePreview.current?.contains(focused) ? focused : null;
    const restoreLostFocus = Boolean(initiatingControl.current);
    restoringRef.current = true; setRestoring(true); setError('');
    const request = generation.current;
    // Another tab may hold the lock. Canceling or replacing this file must
    // invalidate the action before it writes, as well as its eventual UI result.
    const result: LibraryRestorePreview = await withLibraryMutation(() => request === generation.current
      ? restoreLibraryBackup(pending.text, pending.choices)
      : { added: 0, duplicates: 0, error: null }, { added: 0, duplicates: 0, error: LIBRARY_LOCK_ERROR });
    restoringRef.current = false; setRestoring(false);
    onChange();
    if (request !== generation.current) return;
    if (result.error) setError(result.error);
    else {
      closePreview(restoreLostFocus);
      setMessage(`Restored ${result.added} ${result.added === 1 ? 'game' : 'games'}. Skipped ${result.duplicates} identical ${result.duplicates === 1 ? 'game' : 'games'}.${result.conflicts?.length ? ` Replaced ${result.replaced ?? 0}; kept ${result.kept ?? 0} current studies.` : ''}`);
    }
  }

  async function repair(control: HTMLButtonElement) {
    if (!state.raw || restoringRef.current) return;
    initiatingControl.current = document.activeElement === control ? control : null;
    restoringRef.current = true; setRestoring(true); setError('');
    const result = await withLibraryMutation(() => salvageLibrary(state.raw!), { restored: 0, error: LIBRARY_LOCK_ERROR });
    restoringRef.current = false; setRestoring(false); onChange();
    if (result.error) setError(result.error);
    else setMessage(`Recovered ${result.restored} ${result.restored === 1 ? 'study' : 'studies'}. The original data is archived in this browser and can be downloaded below.`);
  }

  return (
    <section className="lib-transfer" aria-label="Library backup and recovery">
      {state.mutationBlocked && (
        <div className="lib-action-error" role="alert">
          Your saved library could not be fully read. Its original data has been preserved. Saving, renaming, deleting, and restoring are paused.
          {state.raw !== null && <button type="button" onClick={() => download('recovery')}>Download recovery file</button>}
          {salvage && <details>
            <summary>Review readable studies for recovery</summary>
            {salvage.error ? <p>{salvage.error}</p> : <>
              <p>Keep {salvage.games.length} readable {salvage.games.length === 1 ? 'study' : 'studies'}; skip {salvage.skipped} invalid or identical {salvage.skipped === 1 ? 'entry' : 'entries'}. Preserve {salvage.copies} conflicting {salvage.copies === 1 ? 'ID as a separate copy' : 'IDs as separate copies'}. The original data will be archived before replacement.</p>
              <ul>{salvage.games.slice(0, 10).map(game => <li key={game.id}>{game.label || game.opening || `${game.moves.length} ${game.moves.length === 1 ? 'move' : 'moves'}`}</li>)}</ul>
              {salvage.games.length > 10 && <p>And {salvage.games.length - 10} more readable {salvage.games.length === 11 ? 'study' : 'studies'}.</p>}
              <button type="button" disabled={restoring} onClick={event => { void repair(event.currentTarget); }}>Keep {salvage.games.length} readable {salvage.games.length === 1 ? 'study' : 'studies'}</button>
            </>}
          </details>}
        </div>
      )}
      <details>
        <summary ref={backupSummary}>Backup and restore</summary>
        {originalRecovery && <button type="button" onClick={() => download('archived')}>Download archived original</button>}
        <p>Keep a copy of all saved games, variations, notes, and reviews, or move them to another browser.</p>
        <button type="button" disabled={state.mutationBlocked} onClick={() => download('backup')}>Download library backup</button>
        <label className="lib-backup-file">
          Restore library backup
          <input ref={restoreInput} type="file" accept=".json,application/json" disabled={state.mutationBlocked} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void selectFile(file);
          }} />
        </label>
        {pending && (
          <div className="lib-restore-preview" ref={restorePreview}>
            <p role="status">Ready to add {pending.preview.added} {pending.preview.added === 1 ? 'game' : 'games'} and skip {pending.preview.duplicates} identical {pending.preview.duplicates === 1 ? 'game' : 'games'}. Replacements: {pending.preview.replaced ?? 0}. Current versions kept: {pending.preview.kept ?? 0}.</p>
            {pending.preview.conflicts?.map(conflict => <fieldset key={conflict.id} className="lib-restore-conflict">
              <legend>{conflict.current.label || conflict.incoming.label || "Conflicting study"}</legend>
              <p>Current: {conflict.current.moves.length} {conflict.current.moves.length === 1 ? 'ply' : 'plies'}, {new Date(conflict.current.modifiedAt ?? conflict.current.savedAt).toLocaleString()}. Backup: {conflict.incoming.moves.length} {conflict.incoming.moves.length === 1 ? 'ply' : 'plies'}, {new Date(conflict.incoming.modifiedAt ?? conflict.incoming.savedAt).toLocaleString()}.</p>
              <details><summary>Compare notes and players</summary>
                <p>Current: {[conflict.current.metadata?.redPlayer, conflict.current.metadata?.blackPlayer, conflict.current.rootComment, conflict.current.moveTree?.[0]?.comment].filter(Boolean).join(" · ") || "No player names or opening notes"}</p>
                <p>Backup: {[conflict.incoming.metadata?.redPlayer, conflict.incoming.metadata?.blackPlayer, conflict.incoming.rootComment, conflict.incoming.moveTree?.[0]?.comment].filter(Boolean).join(" · ") || "No player names or opening notes"}</p>
              </details>
              <label>Resolve {conflict.current.label || conflict.id}
                <select disabled={restoring} value={pending.choices[conflict.id]?.choice ?? "keep"} onChange={event => {
                  const choices = { ...pending.choices, [conflict.id]: { expected: JSON.stringify(conflict.current), choice: event.target.value as "keep" | "replace" | "copy" } };
                  const preview = previewLibraryRestore(pending.text, choices);
                  setPending({ ...pending, choices, preview: preview.error ? { ...pending.preview, error: preview.error } : preview });
                }}>
                  <option value="keep">Keep current</option><option value="replace">Replace with backup</option><option value="copy">Import backup as a copy</option>
                </select>
              </label>
            </fieldset>)}
            {pending.preview.error && <p role="alert">{pending.preview.error}</p>}
            <div className="lib-transfer-actions">
              <button type="button" disabled={restoring || state.mutationBlocked || (pending.preview.added === 0 && !pending.preview.conflicts?.length) || Boolean(pending.preview.error)} onClick={restore}>Restore {pending.preview.added} {pending.preview.added === 1 ? 'game' : 'games'}</button>
              <button type="button" onClick={() => { generation.current += 1; closePreview(); setError(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </details>
      {error && <p className="lib-action-error" role="alert">{error}</p>}
      <p className="lib-transfer-status" role="status">{message}</p>
    </section>
  );
}
