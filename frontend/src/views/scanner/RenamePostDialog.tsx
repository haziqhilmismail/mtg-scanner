import { useEffect, useId, useState } from 'react';
import { Dialog } from '../../components/ui/Dialog.tsx';
import { TextField } from '../../components/ui/Field.tsx';
import type { T } from '../../hooks/useLang.ts';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: (title: string) => void;
  t: T;
}

export function RenamePostDialog({ open, title, onClose, onSave, t }: Props) {
  const form = useId();
  const [name, setName] = useState(title);
  useEffect(() => { if (open) setName(title); }, [open, title]);
  const save = () => {
    if (!name.trim()) return;
    onClose();
    onSave(name.trim());
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('rename_post')}
      closeLabel={t('cancel')}
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn--ink" onClick={onClose}>{t('cancel')}</button>
          <button type="submit" form={form} className="ui-btn ui-btn--primary" disabled={!name.trim()}>{t('rename_save')}</button>
        </>
      )}
    >
      <form id={form} onSubmit={e => { e.preventDefault(); save(); }}>
        <TextField
          label={t('rename_label')} hint={t('rename_hint')} value={name} maxLength={255}
          onChange={e => setName(e.target.value)} data-autofocus=""
        />
      </form>
    </Dialog>
  );
}
