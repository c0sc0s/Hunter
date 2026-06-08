export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="hunter-metric-card">
      <span className="hunter-metric-label">{label}</span>
      <strong className="hunter-metric-value">{value}</strong>
    </div>
  );
}
