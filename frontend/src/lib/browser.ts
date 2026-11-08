import { popupOpen } from '../utils.ts';

// A key press that belongs to a field or to an open popup, not to the page.
export function keyTaken(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return true;
  return popupOpen();
}
