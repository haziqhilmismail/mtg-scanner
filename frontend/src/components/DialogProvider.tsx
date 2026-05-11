import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// Promise-based replacement for window.confirm / prompt / alert. Single
// dialog visible at a time. Components call useDialog() and `await` the
// answer — no more native popups.

interface AlertOpts {
  title?: string;
  message: string;
  okLabel?: string;
}

interface ConfirmOpts {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;  // styles the OK button as a warning action
}

interface PromptOpts {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
}

interface DialogApi {
  alert: (opts: AlertOpts) => Promise<void>;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
}

const Ctx = createContext<DialogApi | null>(null);

type Pending =
  | { kind: 'alert'; opts: AlertOpts; resolve: () => void }
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (value: string | null) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const alert = useCallback((opts: AlertOpts) =>
    new Promise<void>(resolve => setPending({ kind: 'alert', opts, resolve })), []);
  const confirm = useCallback((opts: ConfirmOpts) =>
    new Promise<boolean>(resolve => setPending({ kind: 'confirm', opts, resolve })), []);
  const prompt = useCallback((opts: PromptOpts) =>
    new Promise<string | null>(resolve => setPending({ kind: 'prompt', opts, resolve })), []);

  const api: DialogApi = { alert, confirm, prompt };

  // Resolve + close. Wrapping ensures we always clear state.
  const closeWith = useCallback((value: unknown) => {
    if (!pending) return;
    if (pending.kind === 'alert') (pending.resolve as () => void)();
    else if (pending.kind === 'confirm') (pending.resolve as (b: boolean) => void)(value as boolean);
    else (pending.resolve as (v: string | null) => void)(value as string | null);
    setPending(null);
  }, [pending]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {pending && <DialogShade pending={pending} onClose={closeWith} />}
    </Ctx.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

function DialogShade({ pending, onClose }: { pending: Pending; onClose: (value: unknown) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const okBtnRef = useRef<HTMLButtonElement>(null);
  const [promptValue, setPromptValue] = useState(
    pending.kind === 'prompt' ? (pending.opts.defaultValue ?? '') : '',
  );

  // Lock body scroll + Escape to dismiss + initial focus on the right field.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pending.kind === 'alert') onClose(undefined);
        else if (pending.kind === 'confirm') onClose(false);
        else onClose(null);
      }
    };
    document.addEventListener('keydown', onKey);
    // Defer focus so the modal mounts first
    setTimeout(() => {
      if (pending.kind === 'prompt') inputRef.current?.select();
      else okBtnRef.current?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const okLabel = pending.opts.okLabel ?? 'OK';
  const cancelLabel = (pending.kind !== 'alert' && pending.opts.cancelLabel) || 'Cancel';
  const destructive = pending.kind === 'confirm' && pending.opts.destructive;

  const submit = () => {
    if (pending.kind === 'alert') onClose(undefined);
    else if (pending.kind === 'confirm') onClose(true);
    else onClose(promptValue);
  };

  return (
    <div
      className="dlg-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          if (pending.kind === 'alert') onClose(undefined);
          else if (pending.kind === 'confirm') onClose(false);
          else onClose(null);
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={pending.opts.title ? 'dlg-title' : undefined}
    >
      <div className="dlg-card" onClick={e => e.stopPropagation()}>
        {pending.opts.title ? <h3 id="dlg-title" className="dlg-title">{pending.opts.title}</h3> : null}

        {pending.kind === 'prompt' ? (
          <>
            {pending.opts.message ? <p className="dlg-msg">{pending.opts.message}</p> : null}
            <input
              ref={inputRef}
              className="dlg-input"
              value={promptValue}
              onChange={e => setPromptValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submit(); }
              }}
              placeholder={pending.opts.placeholder}
            />
          </>
        ) : (
          <p className="dlg-msg">{pending.opts.message}</p>
        )}

        <div className="dlg-actions">
          {pending.kind !== 'alert' && (
            <button
              className="ghost"
              onClick={() => onClose(pending.kind === 'confirm' ? false : null)}
            >{cancelLabel}</button>
          )}
          <button
            ref={okBtnRef}
            className={destructive ? 'warn' : 'accent'}
            onClick={submit}
          >{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
