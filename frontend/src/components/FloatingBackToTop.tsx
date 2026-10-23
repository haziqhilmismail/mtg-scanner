import { useEffect, useState } from 'react';
import { Icon } from './Icon.tsx';

// Page-level floating "back to top" button. Hidden by default; fades in once
// the user has scrolled more than one viewport down. Sits above the tab bar
// at the bottom-right corner.
export function FloatingBackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      className={`float-back-top ${visible ? 'is-visible' : ''}`}
      aria-label="Back to top"
      aria-hidden={visible ? 'false' : 'true'}
      tabIndex={visible ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <Icon name="up" />
    </button>
  );
}
