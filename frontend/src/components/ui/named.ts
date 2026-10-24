// Every control gets exactly one name: a visible label, an aria-label, or
// the id of the element that names it.
export type Named =
  | { label: string; 'aria-label'?: never; 'aria-labelledby'?: never }
  | { label?: never; 'aria-label': string; 'aria-labelledby'?: never }
  | { label?: never; 'aria-label'?: never; 'aria-labelledby': string };

// A group named from outside it: by a heading's id, or an aria-label.
export type GroupNamed =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-label'?: never; 'aria-labelledby': string };

// The native attributes these types replace.
export type NativeName = 'aria-label' | 'aria-labelledby';
