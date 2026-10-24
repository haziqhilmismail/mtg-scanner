import { useId, type ReactNode } from 'react';
import { Icon } from '../Icon.tsx';
import { Modal } from './Modal.tsx';

interface Common {
  open: boolean;
  // Cancel: ×, Esc, a click on the backdrop and the phone's Back all call it.
  onClose: () => void;
  onExited?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  // Cancel (ui-btn ui-btn--ink) first, then the one primary button.
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export type DialogProps = Common & (
  | { variant?: 'default' | 'picker'; closeLabel: string }
  | { variant: 'alert'; closeLabel?: never }
);

// Render it always and switch `open`: its content mounts only while it is
// open, and stays through the exit transition.
export function Dialog({ open, onClose, onExited, title, subtitle, footer, children, className, variant = 'default', closeLabel }: DialogProps) {
  const id = useId();
  const alert = variant === 'alert';
  return (
    <Modal
      open={open}
      onClose={onClose}
      onExited={onExited}
      className={`ui-dialog ui-dialog--${variant}${className ? ` ${className}` : ''}`}
      role={alert ? 'alertdialog' : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={alert ? `${id}-body` : subtitle ? `${id}-sub` : undefined}
    >
      <header className="ui-dialog-head">
        <div className="ui-dialog-titles">
          <h2 id={`${id}-title`} className="ui-dialog-title">{title}</h2>
          {subtitle ? <p id={`${id}-sub`} className="ui-dialog-sub">{subtitle}</p> : null}
        </div>
        {closeLabel ? (
          <button type="button" className="ui-icon-btn ui-icon-btn--sm" aria-label={closeLabel} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </header>
      <div id={`${id}-body`} className="ui-dialog-body">{children}</div>
      {footer ? <footer className="ui-dialog-foot">{footer}</footer> : null}
    </Modal>
  );
}
