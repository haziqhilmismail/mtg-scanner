import { createContext, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from './ui/Dialog.tsx';
import { TextField } from './ui/Field.tsx';
import { ToastProvider } from './ui/Toast.tsx';

// Promise-based replacement for window.alert / confirm / prompt. Components
// call useDialog() and `await` the answer. It also mounts the toast region,
// so useToast() works anywhere under it.

interface AlertOpts {
  title?: string;
  message: string;
  okLabel?: string;
}

interface ConfirmOpts {
  title?: string;  // name the thing: Delete “Friday Post”?
  message: string;  // what goes, in one line
  okLabel?: string;  // what it does: Delete post
  cancelLabel?: string;
  destructive?: boolean;  // the action button is filled red
}

interface PromptOpts {
  title?: string;
  message?: string;  // the text box's label
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

// Every kind answers the same way: OK with the prompt's text, or Cancel.
type Request = { id: number; settle: (ok: boolean, text: string) => void } & (
  | { kind: 'alert'; opts: AlertOpts }
  | { kind: 'confirm'; opts: ConfirmOpts }
  | { kind: 'prompt'; opts: PromptOpts }
);

// One question at a time. A call made while another is showing waits its
// turn, instead of replacing it and leaving the first promise unsettled.
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const api = useMemo<DialogApi>(() => {
    let id = 0;
    const ask = (request: Request) => setQueue(q => [...q, request]);
    return {
      alert: opts => new Promise(resolve => ask({ id: ++id, kind: 'alert', opts, settle: () => resolve() })),
      confirm: opts => new Promise(resolve => ask({ id: ++id, kind: 'confirm', opts, settle: ok => resolve(ok) })),
      prompt: opts => new Promise(resolve => ask({ id: ++id, kind: 'prompt', opts, settle: (ok, text) => resolve(ok ? text : null) })),
    };
  }, []);
  const current = queue[0];
  const answer = (ok: boolean, text = '') => {
    if (!current) return;
    current.settle(ok, text);
    // Only if it is still first: a double click must not answer the next one too.
    setQueue(q => (q[0] === current ? q.slice(1) : q));
  };

  return (
    <Ctx.Provider value={api}>
      <ToastProvider>{children}</ToastProvider>
      <RequestDialog request={current} onAnswer={answer} />
    </Ctx.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

function RequestDialog({ request, onAnswer }: { request?: Request; onAnswer: (ok: boolean, text?: string) => void }) {
  const formId = useId();
  // The last question stays on screen while the dialog's exit runs.
  const last = useRef(request);
  if (request) last.current = request;
  const shown = request ?? last.current;
  if (!shown) return null;
  const okLabel = shown.opts.okLabel ?? 'OK';
  const cancelLabel = (shown.kind !== 'alert' && shown.opts.cancelLabel) || 'Cancel';
  const cancel = <button type="button" className="ui-btn ui-btn--ink" onClick={() => onAnswer(false)}>{cancelLabel}</button>;

  if (shown.kind === 'prompt') {
    return (
      <Dialog
        open={!!request}
        onClose={() => onAnswer(false)}
        title={shown.opts.title ?? shown.opts.message ?? ''}
        closeLabel={cancelLabel}
        footer={<>{cancel}<button type="submit" form={formId} className="ui-btn ui-btn--primary">{okLabel}</button></>}
      >
        <PromptForm key={shown.id} id={formId} opts={shown.opts} onSubmit={text => onAnswer(true, text)} />
      </Dialog>
    );
  }
  const destructive = shown.kind === 'confirm' && shown.opts.destructive;
  return (
    <Dialog
      variant="alert"
      open={!!request}
      onClose={() => onAnswer(false)}
      title={shown.opts.title ?? shown.opts.message}
      footer={(
        <>
          {shown.kind === 'confirm' ? cancel : null}
          <button type="button" className={`ui-btn ${destructive ? 'ui-btn--danger-fill' : 'ui-btn--primary'}`} onClick={() => onAnswer(true)}>{okLabel}</button>
        </>
      )}
    >
      {shown.opts.title ? shown.opts.message : null}
    </Dialog>
  );
}

function PromptForm({ id, opts, onSubmit }: { id: string; opts: PromptOpts; onSubmit: (text: string) => void }) {
  const [text, setText] = useState(opts.defaultValue ?? '');
  return (
    <form id={id} onSubmit={e => { e.preventDefault(); onSubmit(text); }}>
      <TextField
        label={opts.message}
        aria-label={opts.message ? undefined : opts.title}
        placeholder={opts.placeholder}
        value={text}
        onChange={e => setText(e.target.value)}
        data-autofocus=""
      />
    </form>
  );
}
