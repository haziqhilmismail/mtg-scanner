// User-initiated feedback modal. Piggybacks on the existing bug-reporter
// pipeline by calling reportBug() with a distinct exception_type so the
// Telegram push renders as "💬 Feedback" instead of "🚨 Error".

import { useEffect, useRef, useState } from 'react';
import { reportBug } from '../lib/bugReporter.ts';
import type { T } from '../hooks/useLang.ts';
import { useBackClose } from '../hooks/useBackClose.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  t: T;
}

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function FeedbackModal({ open, onClose, t }: Props) {
  useBackClose(open, onClose);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errMsg, setErrMsg] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autofocus on open + reset state when closed so the next open is fresh.
  useEffect(() => {
    if (open) {
      setStatus('idle');
      setErrMsg('');
      // Defer focus by a tick so it lands after the modal animates in.
      setTimeout(() => textareaRef.current?.focus(), 50);
    } else {
      setMessage('');
    }
  }, [open]);

  // ESC closes the modal — modal convention; matches the other dialogs in
  // the app (DialogProvider's prompt/confirm/alert all close on ESC too).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = message.trim();
    if (!trimmed || status === 'sending') return;
    setStatus('sending');
    setErrMsg('');
    try {
      await reportBug({
        message: trimmed,
        // Distinct from "Error" / "UnhandledRejection" so the backend's
        // Telegram formatter knows to render this as feedback, not a crash.
        exception_type: 'UserFeedback',
      });
      setStatus('sent');
      setMessage('');
      // Auto-close after a short success beat so users don't have to click
      // dismiss after a clearly-succeeded action.
      setTimeout(() => { onClose(); }, 1200);
    } catch (e) {
      setStatus('error');
      setErrMsg((e as Error).message || 'unknown error');
    }
  };

  return (
    <div className="feedback-overlay" onClick={onClose}>
      <div
        className="feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="feedback-head">
          <h2 id="feedback-title">{t('feedback_title')}</h2>
          <button
            type="button"
            className="feedback-close"
            onClick={onClose}
            aria-label={t('feedback_close')}
          >×</button>
        </div>
        <p className="feedback-sub">{t('feedback_sub')}</p>
        <textarea
          ref={textareaRef}
          className="feedback-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('feedback_placeholder')}
          rows={6}
          maxLength={2000}
          disabled={status === 'sending' || status === 'sent'}
        />
        <div className="feedback-foot">
          <span className="feedback-count">{message.length} / 2000</span>
          {status === 'sent' ? (
            <span className="feedback-success">{t('feedback_sent')}</span>
          ) : status === 'error' ? (
            <span className="feedback-error">{t('feedback_error', { err: errMsg })}</span>
          ) : null}
          <button
            type="button"
            className="accent"
            onClick={submit}
            disabled={!message.trim() || status === 'sending' || status === 'sent'}
          >
            {status === 'sending' ? t('feedback_sending') : t('feedback_send')}
          </button>
        </div>
      </div>
    </div>
  );
}
