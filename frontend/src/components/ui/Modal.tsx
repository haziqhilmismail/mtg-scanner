import { useLayoutEffect, useRef, useState, useSyncExternalStore, type DialogHTMLAttributes, type ReactNode } from 'react';
import { useBackClose } from '../../hooks/useBackClose.ts';
import { hideEl, showEl } from './motion.ts';

// The open modal dialogs, oldest first. Everything outside the newest one is
// inert, so the toast region moves inside it (useTopModal).
const stack: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
function track(el: HTMLDialogElement, open: boolean) {
  const at = stack.indexOf(el);
  if (open === at >= 0) return;
  if (open) stack.push(el);
  else stack.splice(at, 1);
  listeners.forEach(l => l());
}
export const useTopModal = () => useSyncExternalStore(
  listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  () => stack[stack.length - 1] ?? null,
);

export interface ModalProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, 'open' | 'onClose' | 'onCancel'> {
  open: boolean;
  // Cancel: Esc, a click on the backdrop, the phone's Back.
  onClose: () => void;
  children: ReactNode;
}

// A native modal <dialog> driven by `open`. While its exit transition runs it
// stays mounted and keeps showing the content it had when it was open; then
// focus goes back to whatever opened it.
export function Modal({ open, ...rest }: ModalProps) {
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);
  return present ? <ModalBox open={open} onExited={() => setPresent(false)} {...rest} /> : null;
}

function ModalBox({ open, onClose, onExited, children, ...rest }: ModalProps & { onExited: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const shown = useRef(children);
  if (open) shown.current = children;
  const latest = useRef({ open, onClose, onExited });
  latest.current = { open, onClose, onExited };
  const opener = useRef<Element | null>(null);
  const generation = useRef(0);
  const pressedBackdrop = useRef(false);
  useBackClose(open, onClose);

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current!;
    const mine = ++generation.current;
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
        if (generation.current !== mine) return;  // opened again meanwhile
        el.close();
        const back = opener.current;
        const lost = !document.activeElement || document.activeElement === document.body || el.contains(document.activeElement);
        if (back instanceof HTMLElement && back.isConnected && lost) back.focus();
        latest.current.onExited();
      };
      hideEl(el).then(finish, () => { /* interrupted by a reopen */ });
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      // A click on text inside focuses the dialog, not <body>, so keys still
      // pass through it (see onKeyDown).
      tabIndex={-1}
      {...rest}
      onCancel={e => { e.preventDefault(); latest.current.onClose(); }}
      // Closed by the browser itself (a second Esc): tell the owner.
      onClose={() => { if (latest.current.open) latest.current.onClose(); }}
      onPointerDown={e => { pressedBackdrop.current = e.target === e.currentTarget; }}
      onClick={e => { if (pressedBackdrop.current && e.target === e.currentTarget) latest.current.onClose(); }}
      // Keys typed in a dialog are not the page's shortcuts (Scanner's arrows and Esc).
      onKeyDown={e => e.stopPropagation()}
    >
      {shown.current}
    </dialog>
  );
}
