import { useCallback, useLayoutEffect, useMemo, useRef, type FocusEvent } from 'react';

/** Pause Undo while the tab is hidden or its notice is being used. */
export function useUndoTimeout(duration: number, onExpire: () => void) {
  const element = useRef<HTMLDivElement>(null);
  const timeout = useRef<number | null>(null);
  const remaining = useRef<number | null>(null);
  const started = useRef(0);
  const held = useRef({ focus: false, pointer: false });
  const expire = useRef(onExpire);
  useLayoutEffect(() => { expire.current = onExpire; }, [onExpire]);

  const cancel = useCallback(() => {
    if (timeout.current !== null) window.clearTimeout(timeout.current);
    timeout.current = null;
    remaining.current = null;
  }, []);
  useLayoutEffect(() => cancel, [cancel]);

  const pause = useCallback(() => {
    if (timeout.current === null || remaining.current === null) return;
    window.clearTimeout(timeout.current);
    timeout.current = null;
    remaining.current = Math.max(1, remaining.current - (Date.now() - started.current));
  }, []);
  const resume = useCallback(() => {
    if (timeout.current !== null || remaining.current === null || held.current.focus || held.current.pointer || document.hidden) return;
    started.current = Date.now();
    timeout.current = window.setTimeout(() => {
      timeout.current = null;
      remaining.current = null;
      expire.current();
    }, remaining.current);
  }, []);
  useLayoutEffect(() => {
    const onVisibilityChange = () => { if (document.hidden) pause(); else resume(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [pause, resume]);
  const start = useCallback(() => {
    cancel();
    remaining.current = duration;
    // A replacement notice can retain its predecessor's focused button.
    held.current = {
      focus: element.current?.contains(document.activeElement) ?? false,
      pointer: element.current?.matches(':hover') ?? false,
    };
    resume();
  }, [cancel, duration, resume]);
  const bindings = useMemo(() => ({
    ref: element,
    onFocusCapture: () => { held.current.focus = true; pause(); },
    onBlurCapture: (event: FocusEvent<HTMLDivElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      held.current.focus = false; resume();
    },
    onPointerEnter: () => { held.current.pointer = true; pause(); },
    onPointerLeave: () => { held.current.pointer = false; resume(); },
  }), [pause, resume]);
  return useMemo(() => ({ start, cancel, bindings }), [start, cancel, bindings]);
}
