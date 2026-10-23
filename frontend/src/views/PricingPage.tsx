import type { Health } from '../api.ts';
import { Breadcrumbs, type Crumb } from '../components/Breadcrumbs.tsx';
import { PricingFields } from '../components/SettingsPanel.tsx';
import type { T } from '../hooks/useLang.ts';
import type { PricingStore } from '../hooks/usePricing.ts';

interface Props {
  // The post whose pricing this is; null for the user's default.
  postId: number | null;
  title: string;
  crumbs: Crumb[];
  pricing: PricingStore;
  health: Health | null;
  t: T;
}

// A post's pricing, or the default that new posts start with. The fields
// save as they change (see usePricing).
export function PricingPage({ postId, title, crumbs, pricing, health, t }: Props) {
  const { pricingFor } = pricing;
  return (
    <>
      <Breadcrumbs items={crumbs} />
      <div className="review-head">
        <div className="review-title"><h2>{title}</h2></div>
      </div>
      {postId == null ? <p className="claims-hint">{t('pricing_default_sub')}</p> : null}
      {pricing.pricingKnown(postId) ? (
        <section className="panel">
          {postId != null ? (
            <div className="post-type-row">
              <div className="segmented" role="group" aria-label={t('post_type_title')}>
                {(['photo', 'live'] as const).map(mode => (
                  <button key={mode} type="button" className={pricingFor(postId).priceMode === mode ? 'active' : ''} aria-pressed={pricingFor(postId).priceMode === mode}
                    onClick={() => pricing.update(postId, 'priceMode', mode)}>{t(`post_type_${mode}`)}</button>
                ))}
              </div>
              <p>{t(`post_type_${pricingFor(postId).priceMode}_desc`)}</p>
            </div>
          ) : null}
          <PricingFields
            settings={pricingFor(postId)}
            update={(key, value) => pricing.update(postId, key, value)}
            t={t}
            health={health}
          />
          {postId != null ? (
            <div className="pricing-default-row">
              <button type="button" disabled={pricing.isDefault(postId)} onClick={() => pricing.makeDefault(postId)}>
                {pricing.isDefault(postId) ? t('pricing_is_default') : t('pricing_set_default')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
