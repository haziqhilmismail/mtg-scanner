import { useEffect, useRef } from 'react';

// The phone's back button closes the open popup instead of leaving the page.
// While any popup is open there is one extra history entry (marked); back
// lands on the entry below it, and the topmost popup closes. Closing a popup
// any other way removes that entry again. One entry for all popups, so a
// popup that opens another (compare -> printings) still takes one back press.
const MARK = '__popup';
const open: Array<() => void> = [];
let pushed = false;

function sync() {
  if (open.length && !pushed) {
    history.pushState({ ...history.state, [MARK]: true }, '');
    pushed = true;
  } else if (!open.length && pushed) {
    pushed = false;
    // Only when the entry is still on top: a navigation since then has moved on.
    if (history.state?.[MARK]) history.back();
  }
}

window.addEventListener('popstate', () => {
  if (!pushed || history.state?.[MARK]) return;
  pushed = false;
  open[open.length - 1]?.();
});

export function useBackClose(isOpen: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const close = () => closeRef.current();
    open.push(close);
    // After the whole commit, so one popup closing as another opens is no change.
    queueMicrotask(sync);
    return () => {
      open.splice(open.indexOf(close), 1);
      queueMicrotask(sync);
    };
  }, [isOpen]);
}
