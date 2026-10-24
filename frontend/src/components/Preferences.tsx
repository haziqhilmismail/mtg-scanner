import { useT } from '../hooks/useLang.ts';
import type { Appearance, Lang } from '../types.ts';
import { Segmented } from './ui/Segmented.tsx';

interface Props {
  lang: Lang;
  setLang: (l: Lang) => void;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
}

// Language and appearance, on Profile and on the sign-in page.
export function Preferences({ lang, setLang, appearance, setAppearance }: Props) {
  const t = useT();
  return (
    <>
      <Segmented
        label={t('menu_language')} value={lang} onChange={setLang}
        options={[{ value: 'en', label: <span lang="en">English</span> }, { value: 'ms', label: <span lang="ms">Melayu</span> }]}
      />
      <Segmented
        label={t('menu_appearance')} value={appearance} onChange={setAppearance}
        options={(['auto', 'light', 'dark'] as const).map(a => ({ value: a, label: t(`appearance_${a}`) }))}
      />
    </>
  );
}
