import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from './ui/Dialog.tsx';
import { TextField } from './ui/Field.tsx';
import { ToastProvider } from './ui/Toast.tsx';

// Promise-based replacement for window.alert / confirm / prompt. Components
// call useDialog() and `await` the answer. It also mounts the toast region,
// so useToast() works anywhere under it.

interface AlertOpts {
  title: string;
  message: string;
  okLabel?: string;
}

interface ConfirmOpts {
  title: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PromptOpts {
  title: string;
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

type Request = { id: number; settle: (ok: boolean, text: string) => void } & (
  | { kind: 'alert'; opts: AlertOpts }
  | { kind: 'confirm'; opts: ConfirmOpts }
  | { kind: 'prompt'; opts: PromptOpts }
);

// One question at a time. A call made while another is showing waits its
// turn: the answered one leaves the queue only once its dialog has gone, and
// the next one opens in a dialog of its own.
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const [answered, setAnswered] = useState(false);
  const api = useMemo<DialogApi>(() => {
    let id = 0;
    const ask = (request: Request) => setQueue(q => [...q, request]);
    return {
      alert: opts => new Promise(resolve => ask({ id: ++id, kind: 'alert', opts, settle: () => resolve() })),
      confirm: opts => new Promise(resolve => ask({ id: ++id, kind: 'confirm', opts, settle: ok => resolve(ok) })),
      prompt: opts => new Promise(resolve => ask({ id: ++id, kind: 'prompt', opts, settle: (ok, text) => resolve(ok ? text : null) })),
    };
  }, []);
  const head = queue[0];

  return (
    <Ctx.Provider value={api}>
      <ToastProvider>{children}</ToastProvider>
      {head ? (
        <RequestDialog
          key={head.id}
          request={head}
          open={!answered}
          onAnswer={(ok, text = '') => { head.settle(ok, text); setAnswered(true); }}
          onExited={() => { setQueue(q => q.slice(1)); setAnswered(false); }}
        />
      ) : null}
    </Ctx.Provider>
  );
}

export function useDialog(): DialogApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

interface RequestDialogProps {
  request: Request;
  open: boolean;
  onAnswer: (ok: boolean, text?: string) => void;
  onExited: () => void;
}

function RequestDialog({ request, open, onAnswer, onExited }: RequestDialogProps) {
  const formId = useId();
  const okLabel = request.opts.okLabel ?? 'OK';
  const cancelLabel = (request.kind !== 'alert' && request.opts.cancelLabel) || 'Cancel';
  const cancel = <button type="button" className="ui-btn ui-btn--ink" onClick={() => onAnswer(false)}>{cancelLabel}</button>;

  if (request.kind === 'prompt') {
    return (
      <Dialog
        open={open}
        onClose={() => onAnswer(false)}
        onExited={onExited}
        title={request.opts.title}
        closeLabel={cancelLabel}
        footer={<>{cancel}<button type="submit" form={formId} className="ui-btn ui-btn--primary">{okLabel}</button></>}
      >
        <PromptForm id={formId} opts={request.opts} onSubmit={text => onAnswer(true, text)} />
      </Dialog>
    );
  }
  const destructive = request.kind === 'confirm' && request.opts.destructive;
  return (
    <Dialog
      variant="alert"
      open={open}
      onClose={() => onAnswer(false)}
      onExited={onExited}
      title={request.opts.title}
      footer={(
        <>
          {request.kind === 'confirm' ? cancel : null}
          <button type="button" className={`ui-btn ${destructive ? 'ui-btn--danger-fill' : 'ui-btn--primary'}`} onClick={() => onAnswer(true)}>{okLabel}</button>
        </>
      )}
    >
      {request.opts.message}
    </Dialog>
  );
}

function PromptForm({ id, opts, onSubmit }: { id: string; opts: PromptOpts; onSubmit: (text: string) => void }) {
  const [text, setText] = useState(opts.defaultValue ?? '');
  return (
    <form id={id} onSubmit={e => { e.preventDefault(); onSubmit(text); }}>
      <TextField
        {...(opts.message ? { label: opts.message } : { 'aria-label': opts.title })}
        placeholder={opts.placeholder}
        value={text}
        onChange={e => setText(e.target.value)}
        data-autofocus=""
      />
    </form>
  );
}
