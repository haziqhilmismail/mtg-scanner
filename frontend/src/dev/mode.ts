// Which data the dev harness answers the app's API calls with. Dev builds only.

export const DATA_MODES = ['live', 'worst', 'empty', 'one', 'many'] as const;
export type DataMode = (typeof DATA_MODES)[number];
export type TestData = Exclude<DataMode, 'live'>;

// sessionStorage key, so a navigation that drops ?data= keeps the tab's mode.
export const MODE_KEY = 'mtg.dev.data';

const isMode = (v: string | null): v is DataMode => DATA_MODES.includes(v as DataMode);

// ?data= in the URL wins, then the tab's last choice, then live.
export function pickMode(search: string, saved: string | null): DataMode {
  return [new URLSearchParams(search).get('data'), saved].find(isMode) ?? 'live';
}
