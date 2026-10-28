import { useLayoutEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { isComposingKey } from '../utils/keyboard';

type Props = {
  children: ReactNode;
  initialFocus: 'first' | 'last';
  openerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
};

export function BoardActionMenu({ children, initialFocus, openerRef, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef({ text: '', time: 0 });
  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  const focusItem = (item: HTMLButtonElement | undefined) => {
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const opener = openerRef.current;
    const actions = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const item = initialFocus === 'last' ? actions.at(-1) : actions[0];
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return () => {
      // Return focus only while it still belongs to this menu. A dialog or
      // note editor that has claimed it must keep it.
      if (menu?.contains(document.activeElement)) opener?.focus({ preventScroll: true });
    };
  }, [initialFocus, openerRef]);

  return <div id="mobile-board-action-menu" className="mobile-board-action-menu"
    ref={menuRef} role="menu" aria-label="More board actions"
    onBlur={event => {
      // A pointer click on the opener must reach its own toggle handler.
      if (event.relatedTarget !== openerRef.current
        && !event.currentTarget.contains(event.relatedTarget)) onClose();
    }}
    onKeyDown={event => {
      if (event.defaultPrevented || isComposingKey(event.nativeEvent)
        || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        openerRef.current?.focus({ preventScroll: true });
        onClose();
        return;
      }
      if (event.shiftKey && event.key.length !== 1) return;
      const actions = items();
      const index = actions.indexOf(document.activeElement as HTMLButtonElement);
      let next: HTMLButtonElement | undefined;
      switch (event.key) {
        case 'ArrowDown': next = actions[(index + 1) % actions.length]; break;
        case 'ArrowUp': next = actions[(index - 1 + actions.length) % actions.length]; break;
        case 'Home': next = actions[0]; break;
        case 'End': next = actions.at(-1); break;
        case 'ArrowLeft': case 'ArrowRight': break;
        case 'Escape':
          event.preventDefault();
          openerRef.current?.focus({ preventScroll: true });
          onClose();
          return;
        default: {
          if (event.key.length !== 1 || event.key === ' ') return;
          const now = performance.now();
          const text = (now - typeaheadRef.current.time < 600 ? typeaheadRef.current.text : '') + event.key.toLocaleLowerCase();
          typeaheadRef.current = { text, time: now };
          const query = Array.from(text).every(letter => letter === text[0]) ? text[0] : text;
          next = actions.slice(index + 1).concat(actions.slice(0, index + 1))
            .find(action => action.textContent?.trim().toLocaleLowerCase().startsWith(query));
        }
      }
      event.preventDefault();
      if (event.key.length > 1) typeaheadRef.current = { text: '', time: 0 };
      focusItem(next);
    }}>
    {children}
  </div>;
}
