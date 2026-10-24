export function stepValue(value: number, direction: 1 | -1, step = 1, min = -Infinity, max = Infinity): number {
  const decimals = (String(step).split('.')[1] ?? '').length;
  const next = Number((value + direction * step).toFixed(decimals));
  return Math.min(max, Math.max(min, next));
}
