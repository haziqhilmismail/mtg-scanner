import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { placeMenu } from './placeMenu.ts';

export interface MenuItem {
  label: string;
  hint?: string;
  destructive?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  label: string;  // the button's aria-label, also the menu's name ("Manage post")
  items: MenuItem[];
  children: ReactNode;
  buttonClassName?: string;
}

export function Menu({ label, items, children, buttonClassName = 'ui-icon-btn' }: MenuProps) {
  const [open, setOpen] = useState<false | 'first' | 'last'>(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current!;
    const button = buttonRef.current!;
    const place = () => {
      const view = document.documentElement;
      const p = placeMenu(button.getBoundingClientRect(), { width: menu.offsetWidth, height: menu.offsetHeight }, { width: view.clientWidth, height: view.clientHeight });
      menu.style.left = `${p.left}px`;
      menu.style.top = `${p.top}px`;
      menu.style.transformOrigin = p.origin;
    };
    place();
    const entries = menu.querySelectorAll<HTMLElement>('[role="menuitem"]');
    entries[open === 'last' ? entries.length - 1 : 0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menu.contains(target) && !button.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const close = () => { setOpen(false); buttonRef.current?.focus(); };

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setOpen(e.key === 'ArrowUp' ? 'last' : 'first');
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();  // as in Modal: page shortcuts never see keys typed in a layer
    if (e.key === 'Tab') { setOpen(false); return; }
    const entries = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: entries.length - 1 }[e.key];
    if (e.key === 'Escape') close();
    else if (to !== undefined) entries[(to + entries.length) % entries.length]?.focus();
    else return;
    e.preventDefault();  // no page scroll, and no Esc for a dialog around the menu
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(o => (o ? false : 'first'))}
        onKeyDown={onButtonKey}
      >
        {children}
      </button>
      {open ? (
        <div ref={menuRef} id={id} role="menu" aria-label={label} className="ui-menu" onKeyDown={onMenuKey}>
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.destructive ? 'ui-menu-item ui-menu-item--danger' : 'ui-menu-item'}
              aria-labelledby={item.hint ? `${id}-${i}` : undefined}
              aria-describedby={item.hint ? `${id}-${i}-hint` : undefined}
              onClick={() => { close(); item.onSelect(); }}
            >
              <span id={`${id}-${i}`} className="ui-menu-label">{item.label}</span>
              {item.hint ? <span id={`${id}-${i}-hint`} className="ui-menu-hint">{item.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
