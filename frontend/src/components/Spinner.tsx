interface Props {
  label?: string;
}

export function Spinner({ label }: Props) {
  return (
    <div className="loading-wheel" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="loading-wheel-label">{label}</span> : null}
    </div>
  );
}
