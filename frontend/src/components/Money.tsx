import type { ReactNode } from 'react';

// A live price is today's: it carries ≈ until the buyer's total is sent
// (DESIGN.md section 7). approxText (lib/money.ts) is the same mark as text.
export function Money({ live, children }: { live: boolean; children: ReactNode }) {
  return <>{live ? <span className="approx">≈</span> : null}{children}</>;
}
