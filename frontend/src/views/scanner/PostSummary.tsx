import { Icon } from '../../components/Icon.tsx';
import { Money } from '../../components/ScanGallery.tsx';
import type { Area, Folder } from './area.tsx';
import type { ExportJob } from './exportFiles.ts';
import type { usePostExport } from './usePostExport.ts';

interface Props {
  area: Area;
  folder: Folder;
  // Another mode holds the page's one primary button (Save order).
  quiet: boolean;
  // The photos Share and Download all send, and those two actions.
  jobs: ExportJob[];
  exp: ReturnType<typeof usePostExport>;
}

// The post's total and its one primary action (Add all to post, or Finish
// post for a price-on-photo post), then Share photos and Download all.
export function PostSummary({ area, folder, quiet, jobs, exp }: Props) {
  const { t, pricingFor, finishing, runFinishAll, explainFinish } = area;
  const settings = pricingFor(folder.postId);
  const live = settings.priceMode === 'live';
  const { items } = folder;
  const saved = items.filter(s => s.batch.response && s.batch.scanId != null);
  const cards = items.reduce((n, s) => n + s.cards, 0);
  const unpriced = items.reduce((n, s) => n + (s.batch.response ? s.needs : 0), 0);
  const notAdded = saved.reduce((n, s) => n + s.pending, 0);
  const unfinished = saved.filter(s => !s.batch.lockedAt);
  const busy = finishing === folder.key;

  const finish = async () => {
    if (live) await runFinishAll(folder.key, saved.filter(s => s.pending > 0).map(s => s.batch), folder.postId);
    else if (await explainFinish()) await runFinishAll(folder.key, unfinished.map(s => s.batch), folder.postId);
  };
  const waiting = live ? notAdded > 0 : unfinished.length > 0;
  const n = (key: string, count: number) => t(count === 1 ? `${key}_one` : key, { n: count });
  const shareLine = !jobs.length ? (!live && saved.length ? t('post_share_none') : '')
    : !live && jobs.length < saved.length ? t('post_share_line_some', { n: jobs.length })
    : n(live ? 'post_share_line_live' : 'post_share_line_photo', jobs.length);

  return (
    <>
      <section className="ui-card post-summary" aria-label={t('post_total')}>
        <span className="post-summary-label">{t('post_total')}</span>
        <span className="post-total" aria-live="polite"><Money amount={folder.total} settings={settings} /></span>
        <span className="post-summary-meta">
          {[t(live ? 'kind_live' : 'kind_photo'), n('post_photos_count', items.length), n('post_cards', cards)].join(' · ')}
        </span>
        {live ? <span className="post-summary-meta">{t('post_live_note')}</span> : null}
        {saved.length ? (
          <div className="post-summary-status">
            {waiting ? (
              <>
                <span className="post-summary-line"><span className="dot" aria-hidden="true" />
                  {live ? n('post_not_added', notAdded) : n('post_unfinished', unfinished.length)}
                </span>
                <button type="button" className={`ui-btn ui-btn--block ui-btn--lg${quiet ? '' : ' ui-btn--primary'}`} disabled={finishing != null} onClick={finish}>
                  <Icon name={live ? 'addList' : 'lock'} size={18} />{busy ? t('post_busy') : t(live ? 'post_add_all' : 'post_finish')}
                </button>
              </>
            ) : (
              <span className="post-summary-line is-done"><Icon name="check" size={16} />
                {live ? n('post_all_added', cards) : t('post_finished')}
              </span>
            )}
            {unpriced ? <span className="post-summary-line is-warn"><Icon name="warning" size={16} />{n('post_needs_price', unpriced)}</span> : null}
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
