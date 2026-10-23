import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTopModal } from './Modal.tsx';
import { hideEl, showEl } from './motion.ts';
import { pausableTimer } from './pausableTimer.ts';

export interface ToastUndo {
  undoLabel: string;
  onUndo: () => void;
}
type ShowToast = (message: string, undo?: ToastUndo) => void;

const ToastContext = createContext<ShowToast | null>(null);

// toast('Post archived', { undoLabel, onUndo }) from anywhere under the
// provider. One toast at a time: a new one replaces the one showing.
export function useToast(): ShowToast {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used inside <ToastProvider> (DialogProvider mounts one)');
  return toast;
}

interface Shown { id: number; message: string; undo?: ToastUndo }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const show = useCallback<ShowToast>((message, undo) => setShown(s => ({ id: (s?.id ?? 0) + 1, message, undo })), []);
  // Everything outside an open modal dialog is inert, so the region moves
  // into the newest one: a toast over a dialog keeps a working Undo.
  const host = useTopModal();
  const region = (
    <div className="ui-toasts" role="status">
      {shown ? <ToastBar key={shown.id} toast={shown} onGone={() => setShown(s => (s?.id === shown.id ? null : s))} /> : null}
    </div>
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      {host ? createPortal(region, host) : region}
    </ToastContext.Provider>
  );
}

function ToastBar({ toast, onGone }: { toast: Shown; onGone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof pausableTimer> | null>(null);
  const leave = useRef(() => {});
  leave.current = () => {
    timer.current?.stop();
    hideEl(ref.current!).then(onGone, onGone);
  };

  useLayoutEffect(() => showEl(ref.current!), []);
  useEffect(() => {
    // About 2.2s for a plain toast, 3s for one with Undo; the clock stops
    // while it is pointed at, holds focus, or the tab is hidden.
    const t = pausableTimer(toast.undo ? 3000 : 2200, () => leave.current());
    timer.current = t;
    const onVisibility = () => (document.hidden ? t.hold('hidden') : t.release('hidden'));
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { t.stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [toast.undo]);

  return (
    <div
      ref={ref}
      className="ui-toast"
      onPointerEnter={() => timer.current?.hold('pointer')}
      onPointerLeave={() => timer.current?.release('pointer')}
      onFocus={() => timer.current?.hold('focus')}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) timer.current?.release('focus'); }}
    >
      <span className="ui-toast-text">{toast.message}</span>
      {toast.undo ? (
        <button type="button" className="ui-btn ui-btn--plain" onClick={() => { toast.undo?.onUndo(); leave.current(); }}>
          {toast.undo.undoLabel}
        </button>
      ) : null}
    </div>
  );
}
