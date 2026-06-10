import { useState } from 'react';
import type { Post } from '../api/checklist.ts';

interface Props {
  // Number of scanned images whose cards will be added.
  count: number;
  posts: Post[];
  onClose: () => void;
  onConfirm: (postId: number | null) => void;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

// Confirmation + post picker for the page-level "Add all to checklist" bulk
// action. The chosen post (or none) is applied to every image's cards. Mounted
// only while open (Scanner renders it conditionally), so the select resets to
// "no post" each time it's reopened.
export function AddAllChecklistModal({ count, posts, onClose, onConfirm, t }: Props) {
  const [postId, setPostId] = useState<number | null>(null);

  return (
    <div
      className="dlg-shade"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-all-title"
    >
      <div className="dlg-card" onClick={e => e.stopPropagation()}>
        <h3 id="add-all-title" className="dlg-title">{t('bulk_add_all_title')}</h3>
        <p className="dlg-msg">{t('bulk_add_all_msg', { n: count })}</p>

        <div className="finalize-picker-row" style={{ marginBottom: 4 }}>
          <span className="scan-post-label">{t('scanner_post_label')}</span>
          <select
            className="scan-post-select"
            value={postId ?? ''}
            onChange={e => setPostId(e.target.value === '' ? null : parseInt(e.target.value, 10))}
          >
            <option value="">{t('scanner_post_none')}</option>
            {posts.map(p => (
              <option key={p.id} value={p.id}>
                {p.title || `#${p.id}`}
                {p.fb_url ? ' · 🔗' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="dlg-actions">
          <button className="ghost" onClick={onClose}>{t('cancel')}</button>
          <button className="accent" onClick={() => onConfirm(postId)}>{t('bulk_add_all_ok')}</button>
        </div>
      </div>
    </div>
  );
}
