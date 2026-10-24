export interface Rect { left: number; top: number; width: number; height: number }
export interface Size { width: number; height: number }

export function placeMenu(button: Rect, menu: Size, viewport: Size, gap = 4, margin = 8) {
  const below = viewport.height - (button.top + button.height) - gap - margin;
  const above = button.top - gap - margin;
  const up = menu.height > below && above > below;
  const alignRight = button.left + button.width / 2 > viewport.width / 2;
  const left = clamp(alignRight ? button.left + button.width - menu.width : button.left, margin, viewport.width - margin - menu.width);
  const top = clamp(up ? button.top - gap - menu.height : button.top + button.height + gap, margin, viewport.height - margin - menu.height);
  const originX = clamp(button.left + button.width / 2 - left, 0, menu.width);
  return { left, top, origin: `${Math.round(originX)}px ${up ? menu.height : 0}px` };
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(x, hi));
