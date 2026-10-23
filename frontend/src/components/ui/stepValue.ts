// A stepper's next value: one step up or down, kept within min and max, and
// rounded to the step's decimals, so 2.5 + 0.1 is 2.6 and not 2.6000000000000005.
export function stepValue(value: number, direction: 1 | -1, step = 1, min = -Infinity, max = Infinity): number {
  const decimals = (String(step).split('.')[1] ?? '').length;
  const next = Number((value + direction * step).toFixed(decimals));
  return Math.min(max, Math.max(min, next));
}
