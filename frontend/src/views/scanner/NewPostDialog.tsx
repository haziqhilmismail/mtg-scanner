import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { RadioCards } from '../../components/ui/RadioCards.tsx';
import type { T } from '../../hooks/useLang.ts';
import { photosOf } from '../../lib/photoFiles.ts';
import type { PriceMode } from '../../types.ts';

// A phone opens its camera for Take photo; a computer would only open the
// same file picker again, so there Choose photos is the one button.
const hasCamera = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

interface Props {
  open: boolean;
  onClose: () => void;
  // The kind the seller's default pricing has; picked to start with.
  defaultKind: PriceMode;
  onStart: (photos: File[], kind: PriceMode) => void;
  t: T;
}

// New post: what kind of post, then its photos (chosen, taken, or dropped
// onto the dialog on a computer).
export function NewPostDialog({ open, onClose, defaultKind, onStart, t }: Props) {
  const [picked, setPicked] = useState<PriceMode | null>(null);
  const kind = picked ?? defaultKind;
  const choose = useRef<HTMLInputElement>(null);
  const take = useRef<HTMLInputElement>(null);
  const close = () => { setPicked(null); onClose(); };
  const start = (files: FileList | File[]) => {
    const photos = photosOf(files);
    if (!photos.length) return;
    close();
    onStart(photos, kind);
  };
  const input = (ref: typeof choose, camera: boolean) => (
    <input
      ref={ref} type="file" accept="image/*" hidden multiple={!camera} capture={camera ? 'environment' : undefined}
      onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; start(files); }}
    />
  );
  const option = (value: PriceMode) => ({
    value,
    title: value === defaultKind ? <>{t(`kind_${value}`)} <span className="ui-chip">{t('kind_default')}</span></> : t(`kind_${value}`),
    description: t(`kind_${value}_desc`),
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('new_post')}
      closeLabel={t('cancel')}
      className="new-post"
      footer={(
        <>
          <button type="button" className={hasCamera ? 'ui-btn' : 'ui-btn ui-btn--primary'} onClick={() => choose.current?.click()}>
            <Icon name="photo" size={18} />{t('new_post_choose')}
          </button>
          {hasCamera ? (
            <button type="button" className="ui-btn ui-btn--primary" onClick={() => take.current?.click()}>
              <Icon name="scan" size={18} />{t('new_post_take')}
            </button>
          ) : null}
        </>
      )}
    >
      <div
        className="new-post-body"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); start(e.dataTransfer.files); }}
      >
        <p id="new-post-kind" className="ui-label">{t('new_post_kind')}</p>
        <RadioCards aria-labelledby="new-post-kind" value={kind} onChange={setPicked} options={[option('photo'), option('live')]} />
        <p className="new-post-tip"><Icon name="bolt" size={16} />{t('new_post_tip')}</p>
      </div>
      {input(choose, false)}
      {input(take, true)}
    </Dialog>
  );
}
