import type { CommandPaletteModal } from './CommandPaletteModal';
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode, type ComponentProps } from 'react';
import type { BoardEditorProps } from './Board/BoardEditor';
import { keepTabWithin } from '../utils/focusTrap';
import { LazyPanelBoundary } from './LazyPanelBoundary';
import './DeferredDialogs.css';

const Commands = lazy(() => import('./CommandPaletteModal').then(module => ({ default: module.CommandPaletteModal })));
const Editor = lazy(() => import('./Board/BoardEditor').then(module => ({ default: module.BoardEditor })));
const Lessons = lazy(() => import('./RuleLessons').then(module => ({ default: module.RuleLessons })));

function DialogNotice({ title, onClose, failed = false }: { title: string; onClose: () => void; failed?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.querySelector('button')?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      keepTabWithin(dialog.current, event);
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [onClose]);
  return <>
    <div className="dialog-load-backdrop" onClick={onClose} aria-hidden="true" />
    <div className="dialog-load" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="dialog-load">
      <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose}>Close</button></header>
      <p role={failed ? 'alert' : 'status'}>{failed
        ? 'This tool could not be loaded. Your board is unchanged. Close this window to continue, or reload the page to try again.'
        : 'Loading… You can close this window while you wait.'}</p>
    </div>
  </>;
}

function DeferredDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => () => { if (previous.current?.isConnected) previous.current.focus({ preventScroll: true }); }, []);
  return <div style={{ display: 'contents' }} onFocusCapture={event => {
    // Observe the first focus entering this tool, after the command palette
    // has restored its launcher. Keep it through pending/loaded replacements.
    if (!previous.current && event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) {
      previous.current = event.relatedTarget;
    }
  }}>
    <LazyPanelBoundary fallback={<DialogNotice title={title} onClose={onClose} failed />}>
      <Suspense fallback={<DialogNotice title={title} onClose={onClose} />}>{children}</Suspense>
    </LazyPanelBoundary>
  </div>;
}

export function DeferredBoardEditor(props: BoardEditorProps) {
  // Preserve the position the user opened, even if an AI reply changes the
  // main board before the editor finishes downloading. Boards are immutable.
  const [position] = useState(() => ({ initialBoard: props.initialBoard, initialSide: props.initialSide }));
  return <DeferredDialog title="Set up a position" onClose={props.onCancel}><Editor {...props} {...position} /></DeferredDialog>;
}

export function DeferredRuleLessons(props: ComponentProps<typeof Lessons>) {
  return <DeferredDialog title="Learn the rules" onClose={props.onClose}><Lessons {...props} /></DeferredDialog>;
}

export function DeferredCommandPalette(props: ComponentProps<typeof CommandPaletteModal>) {
  if (!props.open) return null;
  return <DeferredDialog title="Commands" onClose={props.onClose}><Commands {...props} /></DeferredDialog>;
}
