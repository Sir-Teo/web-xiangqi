import { withLibraryMutation, LIBRARY_LOCK_ERROR } from '../../utils/libraryMutation';
import { useEffect, useRef, useState } from 'react';
import {
  exportLibraryBackup, loadLibraryState, MAX_LIBRARY_JSON_LENGTH,
  previewLibraryRestore, restoreLibraryBackup,
  type LibraryRestorePreview, type LibraryState,
} from '../../utils/gameLibrary';
import { downloadTextFile } from '../../utils/gameExport';

export function LibraryTransfer({ state, onChange }: { state: LibraryState; onChange: () => void }) {
  const [pending, setPending] = useState<{ text: string; preview: LibraryRestorePreview } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const restoringRef = useRef(false);
  const [restoring, setRestoring] = useState(false);
  useEffect(() => () => { generation.current += 1; }, []);

  function download(recovery: boolean) {
    setError('');
    setMessage('');
    const text = recovery ? loadLibraryState().raw : exportLibraryBackup();
    if (text === null) {
      setError('The library could not be read. No download was created.');
      onChange();
      return;
    }
    const filename = `xiangqi-library-${recovery ? 'recovery-' : ''}${new Date().toISOString().slice(0, 10)}.json`;
    if (downloadTextFile(filename, text, 'application/json;charset=utf-8')) {
      setMessage(recovery ? 'Recovery download started. Keep this original file before repairing the data.' : 'Backup download started. Keep the file somewhere safe.');
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
      else setPending({ text, preview });
    } catch {
      if (current === generation.current) setError('This file could not be read. Please try again.');
    }
  }

  async function restore() {
    if (!pending || restoringRef.current) return;
    restoringRef.current = true; setRestoring(true);
    const request = generation.current;
    const result = await withLibraryMutation(() => restoreLibraryBackup(pending.text), { added: 0, duplicates: 0, error: LIBRARY_LOCK_ERROR });
    restoringRef.current = false; setRestoring(false);
    onChange();
    if (request !== generation.current) return;
    setPending(null);
    if (result.error) setError(result.error);
    else setMessage(`Restored ${result.added} games. Skipped ${result.duplicates} identical games.`);
  }

  return (
    <section className="lib-transfer" aria-label="Library backup and recovery">
      {state.mutationBlocked && (
        <div className="lib-action-error" role="alert">
          Your saved library could not be fully read. Its original data has been preserved. Saving, renaming, deleting, and restoring are paused.
          {state.raw !== null && <button type="button" onClick={() => download(true)}>Download recovery file</button>}
        </div>
      )}
      <details>
        <summary>Backup and restore</summary>
        <p>Keep a copy of all saved games, variations, notes, and reviews, or move them to another browser.</p>
        <button type="button" disabled={state.mutationBlocked} onClick={() => download(false)}>Download library backup</button>
        <label className="lib-backup-file">
          Restore library backup
          <input type="file" accept=".json,application/json" disabled={state.mutationBlocked} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            void selectFile(file);
          }} />
        </label>
        {pending && (
          <div className="lib-restore-preview">
            <p role="status">Ready to add {pending.preview.added} games and skip {pending.preview.duplicates} identical games. Existing games will be kept.</p>
            <div className="lib-transfer-actions">
              <button type="button" disabled={restoring || state.mutationBlocked || pending.preview.added === 0} onClick={restore}>Restore {pending.preview.added} games</button>
              <button type="button" onClick={() => { generation.current += 1; setPending(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </details>
      {error && <p className="lib-action-error" role="alert">{error}</p>}
      <p className="lib-transfer-status" role="status">{message}</p>
    </section>
  );
}
