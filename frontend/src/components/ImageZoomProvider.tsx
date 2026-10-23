import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ZoomModal } from './ZoomModal.tsx';

// Lifts the ZoomModal up so any view (scanner, kanban, posts, stock cards)
// can call useImageZoom().open(src, caption) without prop-drilling.

interface ZoomApi {
  open: (src: string, caption?: string) => void;
  close: () => void;
}

const Ctx = createContext<ZoomApi | null>(null);

export function ImageZoomProvider({ children }: { children: ReactNode }) {
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);
  const open = useCallback((src: string, caption = '') => setZoom({ src, caption }), []);
  const close = useCallback(() => setZoom(null), []);
  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      <ZoomModal src={zoom?.src ?? null} caption={zoom?.caption ?? ''} onClose={close} />
    </Ctx.Provider>
  );
}

export function useImageZoom(): ZoomApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useImageZoom must be used inside <ImageZoomProvider>');
  return ctx;
}
