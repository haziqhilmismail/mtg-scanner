import type { CardRowData } from '../types.ts';
import { rarityKey } from '../utils.ts';
import type { T } from '../hooks/useLang.ts';

interface Props {
  cd: CardRowData;
  t: T;
}

// "Pill with set code + #collector_number + rarity dot" — visible at a glance
export function VersionBadge({ cd, t }: Props) {
  const isManual = cd.isManual;
  const setStr = isManual
    ? t('manual_entry_meta')
    : cd.sel.set ? `${cd.sel.set} · #${cd.sel.collector_number || '?'}`
      : t('no_set_match');

  if (isManual || !cd.sel.set) {
    return (
      <div className="version-line">
        <span className="set-name">{setStr}</span>
      </div>
    );
  }

  const rarity = rarityKey(cd.sel.rarity);
  const setCode = (cd.sel.set || '').toUpperCase();
  const cn = cd.sel.collector_number || '?';
  const setName = cd.sel.set_name || '';

  return (
    <div className="version-line">
      <span className="set-badge">
        {rarity ? <span className={`rarity ${rarity}`} title={t('zoom_match')} /> : null}
        {setCode}
        <span className="cn">#{cn}</span>
      </span>
      {setName ? <span className="set-name">{setName}</span> : null}
    </div>
  );
}
