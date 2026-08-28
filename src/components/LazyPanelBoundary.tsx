import { Component, type ReactNode } from 'react';
import './LazyPanelBoundary.css';

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * The library panel is a lazily loaded chunk behind a `Suspense`, and Suspense
 * does not catch errors — only pending promises. A chunk that fails to fetch
 * therefore reached `AppErrorBoundary` and replaced the whole app: board, move
 * tree, engine panel, because one panel could not load.
 *
 * The ordinary way that happens is a tab left open across a deploy, where the
 * old chunk filenames are gone from the server, so the first time the library
 * is opened after a release it fails. web-katrain hit this and added the
 * equivalent boundary; web-chess has the same containment now.
 *
 * Stays failed until a reload: the missing chunk would throw again on the next
 * render and loop.
 */
export class LazyPanelBoundary extends Component<Props, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.warn('A lazily loaded panel failed to load; the rest of the app is unaffected.', error);
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div className="lazy-panel-error" role="alert">
                This panel could not be loaded. Reload the page to get it back —
                the game on the board is unaffected.
            </div>
        );
    }
}
