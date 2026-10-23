// Enter and exit for a part styled with a base (hidden) state and a
// [data-shown] state, with CSS transitions between them. Transitions, not
// keyframes, so an exit that starts mid-enter turns around smoothly.

export function showEl(el: HTMLElement) {
  el.getBoundingClientRect();  // apply the hidden state first, so there is something to transition from
  el.dataset.shown = '';
}

// Settles when the exit transition ends: at once with no transition (reduced
// motion), rejects when a showEl() interrupts it.
export function hideEl(el: HTMLElement): Promise<void> {
  delete el.dataset.shown;
  el.getBoundingClientRect();  // start the transitions, so getAnimations() sees them
  return Promise.all(el.getAnimations().map(a => a.finished)).then(() => undefined);
}
