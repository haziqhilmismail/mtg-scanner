import type { ReactNode } from 'react';

// A live price is today's: it carries ≈ until the buyer's total is sent
// (DESIGN.md section 7). As text, for a sentence: "auto ≈RM13".
export const approxText = (amount: string, live: boolean) => (live ? `≈${amount}` : amount);

export function Money({ live, children }: { live: boolean; children: ReactNode }) {
  return <>{live ? <span className="approx">≈</span> : null}{children}</>;
}
