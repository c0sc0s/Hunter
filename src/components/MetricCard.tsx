import { Card } from "@/components/ui/card";

export function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="gap-1 border-sidebar-border bg-sidebar-accent/45 p-3" size="sm">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <strong className="text-xl leading-none tracking-tight">{value}</strong>
    </Card>
  );
}
