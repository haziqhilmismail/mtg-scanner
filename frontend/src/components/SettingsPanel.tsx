import { useEffect, useState } from 'react';
import type { T } from '../hooks/useLang.ts';
import { pricingSummary } from '../lib/pricing.ts';
import type { Route } from '../routes.ts';
import type { Settings } from '../types.ts';
import { applyRounding, formatMyr, pillLabel } from '../utils.ts';
import { Icon } from './Icon.tsx';
import { Link } from './Link.tsx';

interface RowProps {
  title: string;
  // For the one-line summary.
  settings: Settings;
  t: T;
  // The pricing page.
  to: Route;
}

// A pricing in one line, linking to its page: set once per market night.
export function PricingRow({ title, settings, t, to }: RowProps) {
  return (
    <Link className="pricing-row" to={to}>
      <Icon name="tag" size={18} />
      <span className="pricing-row-text">
        <span className="pricing-row-title">{title}</span>
        <span className="pricing-row-summary">{pricingSummary(settings, t)}</span>
      </span>
      <span className="pricing-row-change">{t('pricing_edit')}</span>
    </Link>
  );
}

// The example card, at fixed Card Kingdom prices so it shows only what the
// settings change.
const SAMPLE = { name: 'Lord Skitter, Sewer King', usd: 4.99, usdFoil: 4.49 };

// One card priced with these settings: the labels printed on a price-on-photo
// post, or for a live post the rate, today's price and when it gets set.
export function PricingExample({ settings, t }: { settings: Settings; t: T }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const cur = settings.currencyLabel.trim() || 'RM';
  const rows = [
    { foil: false, usd: SAMPLE.usd, mult: settings.multNormal },
    { foil: true, usd: SAMPLE.usdFoil, mult: settings.multFoil },
  ].map(r => ({ ...r, price: applyRounding(r.usd * r.mult, settings), label: r.foil ? t('foil_on') : t('pricing_nonfoil') }));
  const caption = t('pricing_caption_text', { m: settings.multNormal, f: settings.multFoil });

  if (settings.priceMode === 'photo') {
    return (
      <div className="pricing-example">
        <p className="pricing-example-title">{t('pricing_example', { card: SAMPLE.name })}</p>
        {rows.map(r => (
          <div className="pricing-example-row" key={r.label}>
            <span className="pricing-example-text">
              <span className={r.foil ? 'pricing-example-kind is-foil' : 'pricing-example-kind'}>{r.label}</span>
              <span>USD {r.usd.toFixed(2)} × {r.mult} = {cur} {(r.usd * r.mult).toFixed(2)}</span>
            </span>
            <span className={r.foil ? 'price-pill is-foil' : 'price-pill'} style={{ fontSize: `${15 * settings.labelFontScale}px` }}>
              {pillLabel({ unitPrice: r.price, isFoil: r.foil, qty: 1 }, settings)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const today = (r: typeof rows[number]) => {
    const [before, after] = t('pricing_live_today', { price: '\u0000', usd: r.usd.toFixed(2) }).split('\u0000');
    return <>{before}<strong>≈{formatMyr(r.price, settings)}</strong>{after}</>;
  };
  const steps: Array<[string, string]> = [['pricing_step_post', 'pricing_step_post_sub'], ['pricing_step_claim', 'pricing_step_claim_sub'], ['pricing_step_send', 'pricing_step_send_sub']];
  return (
    <>
      <div className="pricing-example">
        <p className="pricing-example-title">{t('pricing_example', { card: SAMPLE.name })}</p>
        {rows.map((r, i) => (
          <div className="pricing-example-live" key={r.label}>
            <div className="pricing-example-row">
              <span className={r.foil ? 'pricing-example-kind is-foil' : 'pricing-example-kind'}>{r.label}</span>
              <span className={r.foil ? 'pricing-example-rate is-foil' : 'pricing-example-rate'}><span className="ui-chip">CK</span> × {r.mult}</span>
            </div>
            <p className="pricing-example-note">{today(r)}{i === 0 ? ` ${t('pricing_live_change')}` : ''}</p>
          </div>
        ))}
        <ol className="pricing-steps">
          {steps.map(([title, sub], i) => (
            <li key={title} className={i === steps.length - 1 ? 'is-set' : undefined}>
              <span className="pricing-step-dot" aria-hidden="true">{i === steps.length - 1 ? <Icon name="lock" size={12} /> : null}</span>
              <span className="pricing-step-title">{t(title)}</span>
              <span className="pricing-step-sub">{t(sub)}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="pricing-caption">
        <span className="pricing-caption-text">
          <span>{t('pricing_caption')}</span>
          <strong>“{caption}”</strong>
        </span>
        <button
          type="button" className={copied ? 'ui-btn is-copied' : 'ui-btn'} aria-live="polite"
          onClick={() => navigator.clipboard?.writeText(caption).then(() => setCopied(true), () => { /* stays Copy */ })}
        >
          {copied ? <><Icon name="check" size={16} />{t('pricing_copied')}</> : <><Icon name="copy" size={16} />{t('pricing_copy')}</>}
        </button>
      </div>
    </>
  );
}
