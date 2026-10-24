import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useT } from '../hooks/useLang.ts';
import { PhotoViewer } from './ui/PhotoViewer.tsx';

// One full-screen viewer any page can open with useImageZoom().open(src,
// caption), without passing it down.

interface ZoomApi {
  open: (src: string, caption?: string) => void;
  close: () => void;
}

const Ctx = createContext<ZoomApi | null>(null);

export function ImageZoomProvider({ children }: { children: ReactNode }) {
  const t = useT();
  // The last picture stays set while the viewer closes, so it shows through its exit.
  const [zoom, setZoom] = useState<{ src: string; caption: string; open: boolean } | null>(null);
  const open = useCallback((src: string, caption = '') => setZoom({ src, caption, open: true }), []);
  const close = useCallback(() => setZoom(z => (z ? { ...z, open: false } : z)), []);
  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {zoom ? (
        <PhotoViewer open={zoom.open} onClose={close} label={zoom.caption || t('photo_viewer_label')} closeLabel={t('voucher_close')} image={{ src: zoom.src, alt: zoom.caption }}>
          {zoom.caption ? <p className="ui-viewer-caption">{zoom.caption}</p> : null}
        </PhotoViewer>
      ) : null}
    </Ctx.Provider>
  );
}

export function useImageZoom(): ZoomApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useImageZoom must be used inside <ImageZoomProvider>');
  return ctx;
}
