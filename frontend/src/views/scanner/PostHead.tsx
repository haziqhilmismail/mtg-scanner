import { useState } from 'react';
import { Breadcrumbs } from '../../components/Breadcrumbs.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Link } from '../../components/Link.tsx';
import { Menu } from '../../components/ui/Menu.tsx';
import { POSTS } from '../../routes.ts';
import type { Area, Folder } from './area.tsx';
import { RenamePostDialog } from './RenamePostDialog.tsx';
import { RepostDialog } from './RepostDialog.tsx';

export type PostPart = 'photos' | 'claims';

// The top of a post, the same on its two parts: the breadcrumbs, the name
// with Rename and Manage post, then the Photos and Claims tabs. The photos
// in no post get the name only: they are not a post, so they have no claims.
export function PostHead({ area, folder, part }: { area: Area; folder: Folder; part: PostPart }) {
  const { t, renamePost, setArchived, deletePost } = area;
  const [renaming, setRenaming] = useState(false);
  const [reposting, setReposting] = useState(false);
  const isPost = folder.postId != null;
  const tab = (id: PostPart, label: string, n: number) => (
    // In place, like a filter: Back leaves the post rather than flipping between its parts.
    <Link
      replace to={{ page: id === 'photos' ? 'post' : 'claims', folder: folder.key }}
      className={`post-tab ${part === id ? 'is-on' : ''}`} aria-current={part === id ? 'page' : undefined}
    >
      {label}{n ? <span className="ui-count">&nbsp;· {n.toLocaleString('en-MY')}</span> : null}
    </Link>
  );

  return (
    <>
      <Breadcrumbs items={[{ label: t('scans_title'), to: POSTS }, { label: folder.title }]} />
      <div className="post-head">
        <h1 className="page-title">{folder.title}</h1>
        {isPost ? (
          <span className="post-head-actions">
            <button type="button" className="ui-icon-btn" aria-label={t('rename_post')} aria-haspopup="dialog" onClick={() => setRenaming(true)}>
              <Icon name="edit" size={18} />
            </button>
            <Menu
              label={t('manage_post')}
              items={[
                { label: t('repost_post'), hint: t('repost_post_hint'), onSelect: () => setReposting(true) },
                folder.archived
                  ? { label: t('restore_post'), hint: t('restore_post_hint'), onSelect: () => setArchived(folder, false) }
                  : { label: t('archive_post'), hint: t('archive_post_hint'), onSelect: () => setArchived(folder, true) },
                { label: t('delete_post'), hint: t('delete_post_hint'), destructive: true, onSelect: () => deletePost(folder) },
              ]}
            >
              <Icon name="more" size={20} />
            </Menu>
          </span>
        ) : null}
      </div>
      {folder.archived ? (
        <div className="post-note">
          <Icon name="archive" size={18} />
          <span>{t('post_archived_note')}</span>
          <button type="button" className="ui-btn" onClick={() => setArchived(folder, false)}>{t('posts_restore')}</button>
        </div>
      ) : null}
      {isPost ? (
        <nav className="post-tabs" aria-label={t('post_parts')}>
          {tab('photos', t('post_photos'), folder.items.length)}
          {tab('claims', t('nav_claims'), folder.buyers)}
        </nav>
      ) : <p className="post-note"><Icon name="folder" size={18} /><span>{t('unfiled_note')}</span></p>}
      <RenamePostDialog open={renaming} title={folder.title} onClose={() => setRenaming(false)} onSave={title => renamePost(folder, title)} t={t} />
      {isPost ? <RepostDialog open={reposting} onClose={() => setReposting(false)} area={area} folder={folder} /> : null}
    </>
  );
}
