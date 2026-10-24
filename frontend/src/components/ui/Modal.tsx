import { useLayoutEffect, useRef, useState, useSyncExternalStore, type DialogHTMLAttributes, type ReactNode } from 'react';
import { useBackClose } from '../../hooks/useBackClose.ts';
import { hideEl, showEl } from './motion.ts';

const stack: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
function track(el: HTMLDialogElement, open: boolean) {
  const at = stack.indexOf(el);
  if (open === at >= 0) return;
  if (open) stack.push(el);
  else stack.splice(at, 1);
  listeners.forEach(l => l());
}
// The newest open modal dialog. A toast moves into it, because everything
// outside it is inert; the move mounts the toast again, which restarts it.
export const useTopModal = () => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => stack[stack.length - 1] ?? null,
);

export interface ModalProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, 'open' | 'onClose' | 'onCancel' | 'onClick' | 'onPointerDown' | 'onKeyDown' | 'tabIndex'> {
  open: boolean;
  // Cancel: Esc, a click on the backdrop, the phone's Back.
  onClose: () => void;
  onExited?: () => void;  // after the exit transition, once it is closed
  children: ReactNode;
}

// A native modal <dialog> driven by `open`. Its content mounts when it opens
// and unmounts after it has closed, so state inside starts fresh each time.
// While its exit transition runs it keeps showing the content it had when it
// was open; then focus goes back to whatever opened it.
export function Modal({ open, onExited, ...rest }: ModalProps) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  return present ? <ModalBox open={open} onExited={() => { setPresent(false); onExited?.(); }} {...rest} /> : null;
}

function ModalBox({ open, onClose, onExited, children, ...rest }: Omit<ModalProps, 'onExited'> & { onExited: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const shown = useRef(children);
  if (open) shown.current = children;
  const latest = useRef({ onClose, onExited });
  latest.current = { onClose, onExited };
  const opener = useRef<Element | null>(null);
  const openCount = useRef(0);
  const pressedBackdrop = useRef(false);
  useBackClose(open, onClose);

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current!;
    const thisOpen = ++openCount.current;
    if (!el.open) {
      opener.current = document.activeElement;
      el.showModal();
      const first = el.querySelector<HTMLElement>('[data-autofocus]');
      first?.focus();
      if (first instanceof HTMLInputElement) first.select();
    }
    showEl(el);
    track(el, true);
    return () => {
      track(el, false);
      const finish = () => {
        if (openCount.current !== thisOpen) return;
        el.close();
        const back = opener.current;
        const lost = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
        if (back instanceof HTMLElement && back.isConnected && lost) back.focus();
        latest.current.onExited();
      };
      hideEl(el).then(finish, finish);
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      // Page shortcuts out of this branch's reach (Scanner.tsx's own selector
      // list, legacy dialogs that close on Esc at document level) must not see
      // keys typed here, so they stop at the dialog. tabIndex makes a click on
      // text focus the dialog, not <body>, so later keys still pass through it.
      tabIndex={-1}
      onKeyDown={e => e.stopPropagation()}
      {...rest}
      onCancel={e => { e.preventDefault(); latest.current.onClose(); }}
      onPointerDown={e => { pressedBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressedBackdrop.current && e.target === e.currentTarget) latest.current.onClose(); }}
    >
      {shown.current}
    </dialog>
  );
}
