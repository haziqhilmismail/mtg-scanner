import { Icon } from '../../components/Icon.tsx';
import { Money } from '../../components/Money.tsx';
import { plural } from '../../i18n/index.ts';
import { formatMyr, isLive } from '../../utils.ts';
import type { T } from '../../hooks/useLang.ts';
import type { Settings } from '../../types.ts';
import type { PhotoActions } from './usePhotoActions.ts';
import type { Folder } from './usePosts.ts';
import type { ExportJob } from './exportFiles.ts';
import { postStatus } from './status.ts';
import type { usePostExport } from './usePostExport.ts';

interface Props {
  photos: PhotoActions;
  // The post's pricing.
  settings: Settings;
  t: T;
  folder: Folder;
  // Another mode holds the page's one primary button (Save order).
  quiet: boolean;
  // The photos Share and Download all send, and those two actions.
  jobs: ExportJob[];
  exp: ReturnType<typeof usePostExport>;
}

// The post's total and its one primary action (Add all to post, or Finish
// post for a price-on-photo post), then Share photos and Download all.
export function PostSummary({ photos, settings, t, folder, quiet, jobs, exp }: Props) {
  const { finishing, runFinishAll, explainFinish } = photos;
  const live = isLive(settings);
  const { items } = folder;
  // Cards with no price can't go in the post until they get one.
  const { saved, cards, unpriced, priced, waiting, pending, total } = postStatus(items);
  const busy = finishing === folder.key;

  const finish = async () => {
    if (live || await explainFinish()) await runFinishAll(folder.key, waiting.map(s => s.batch), folder.postId);
  };
  const shareLine = !jobs.length ? (!live && saved ? t('post_share_none') : '')
    : !live && jobs.length < saved ? t('post_share_line_some', { n: jobs.length })
    : plural(t, live ? 'post_share_line_live' : 'post_share_line_photo', jobs.length);

  return (
    <>
      <section className="ui-card post-summary" aria-label={t('total')}>
        <span className="post-summary-label">{t('total')}</span>
        <span className="post-total" aria-live="polite"><Money live={live}>{formatMyr(total, settings)}</Money></span>
        <span className="post-summary-meta">
          {[t(live ? 'kind_live' : 'kind_photo'), plural(t, 'photos', items.length), plural(t, 'cards', cards)].join(' · ')}
        </span>
        {live ? <span className="post-summary-meta">{t('post_live_note')}</span> : null}
        {saved ? (
          <div className="post-summary-status">
            {waiting.length ? (
              <>
                <span className="post-summary-line"><span className="dot" aria-hidden="true" />
                  {live ? plural(t, 'post_not_added', pending) : plural(t, 'post_unfinished', waiting.length)}
                </span>
                <button type="button" className={`ui-btn ui-btn--block ui-btn--lg${quiet ? '' : ' ui-btn--primary'}`} disabled={finishing != null} onClick={finish}>
                  <Icon name={live ? 'addList' : 'lock'} size={18} />{busy ? t('post_busy') : t(live ? 'add_all_to_post' : 'post_finish')}
                </button>
              </>
            ) : !live || priced ? (
              <span className="post-summary-line is-done"><Icon name="check" size={16} />
                {live ? plural(t, 'post_all_added', priced) : t('post_finished')}
              </span>
            ) : null}
            {unpriced ? <span className="post-summary-line is-warn"><Icon name="warning" size={16} />{plural(t, 'post_needs_price', unpriced)}</span> : null}
          </div>
        ) : null}
      </section>
      <div className="post-share">
        <button type="button" className="ui-btn" disabled={!jobs.length || exp.busy || !!exp.preparing} onClick={exp.share}>
          <Icon name="share" size={18} />{exp.preparing ? t('post_preparing', exp.preparing) : t('post_share')}
        </button>
        <button type="button" className="ui-btn" disabled={!jobs.length || exp.busy} onClick={() => exp.download(jobs)}>
          <Icon name="download" size={18} />{exp.busy ? t('post_busy') : t('post_download_all')}
        </button>
      </div>
      {shareLine ? <p className="post-share-line">{shareLine}</p> : null}
    </>
  );
}
