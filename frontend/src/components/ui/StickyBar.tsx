import { useLayoutEffect, useRef, type ReactNode } from 'react';

// The bar docked to the bottom edge for a page form (status, Cancel, Save)
// or a mode (Select: Download, Delete). Render it only while it applies.
// It publishes its height as --sticky-bar-h: the spacer it leaves where it
// is rendered keeps the page's end clear of it, and the toast sits above it.
export function StickyBar({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const bar = ref.current!;
    const root = document.documentElement.style;
    const observer = new ResizeObserver(() => root.setProperty('--sticky-bar-h', `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => { observer.disconnect(); root.removeProperty('--sticky-bar-h'); };
  }, []);
  return (
    <>
      <div className="ui-sticky-spacer" aria-hidden="true" />
      <div ref={ref} className={className ? `ui-sticky-bar ${className}` : 'ui-sticky-bar'}>{children}</div>
    </>
  );
}
