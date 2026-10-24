// Feedback goes through the bug reporter with its own exception_type, so the
// Telegram push renders as "💬 Feedback" instead of "🚨 Error".

import { useId, useState } from 'react';
import type { T } from '../hooks/useLang.ts';
import { reportBug } from '../lib/bugReporter.ts';
import { TextArea } from './ui/Field.tsx';
import { Dialog } from './ui/Dialog.tsx';
import { useToast } from './ui/Toast.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  t: T;
}

const MAX = 2000;

export function FeedbackModal({ open, onClose, t }: Props) {
  const formId = useId();
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true); setError('');
    try {
      await reportBug({ message: text, exception_type: 'UserFeedback' });
      onClose();
      toast(t('feedback_thanks'));
    } catch (e) {
      setError(t('feedback_error', { err: (e as Error).message || 'unknown error' }));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onExited={() => { setMessage(''); setError(''); }}
      title={t('feedback_title')}
      closeLabel={t('feedback_close')}
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn--ink" onClick={onClose}>{t('cancel')}</button>
          <button type="submit" form={formId} className="ui-btn ui-btn--primary" disabled={!message.trim() || sending}>
            {t(sending ? 'feedback_sending' : 'feedback_send')}
          </button>
        </>
      )}
    >
      <form id={formId} onSubmit={e => { e.preventDefault(); send(); }}>
        <TextArea
          label={t('feedback_sub')}
          hint={t('feedback_count', { n: message.length })}
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={t('feedback_placeholder')}
          rows={6}
          maxLength={MAX}
          data-autofocus=""
        />
        {error ? <p className="ui-error feedback-failed" role="alert">{error}</p> : null}
      </form>
    </Dialog>
  );
}
