export function showEl(el: HTMLElement) {
  el.getBoundingClientRect();  // apply the hidden state first, so there is something to transition from
  el.dataset.shown = '';
}

// Settles when the exit transitions end; rejects when a showEl() interrupts them.
export function hideEl(el: HTMLElement): Promise<void> {
  delete el.dataset.shown;
  const exits = el.getAnimations().filter(a => a instanceof CSSTransition);
  return Promise.all(exits.map(a => a.finished)).then(() => undefined);
}
