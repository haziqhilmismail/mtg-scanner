interface Props {
  // Optional caption shown under the wheel (e.g. "Loading your scans…").
  label?: string;
}

// Centred loading wheel for full-section data fetches (past scans, checklist).
// role="status" so screen readers announce the loading state.
export function Spinner({ label }: Props) {
  return (
    <div className="loading-wheel" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="loading-wheel-label">{label}</span> : null}
    </div>
  );
}
