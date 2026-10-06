import { AlertCircle } from "lucide-react";
import { OccupancyGauge } from "@/components/occupancy-gauge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { explainTotal, hasCapacityMismatch, type HistoryEntry } from "@/lib/client/history";
import { computeOccupancy, STATUS } from "@/lib/occupancy";

/** Occupancy of the latest upload: gauge, status, the three counts and where the total comes from. */
export function OccupancyCard({ latest, className }: { latest: HistoryEntry | undefined; className?: string }) {
  const occupancy = latest ? computeOccupancy(latest.vehicles, latest.totalSpaces) : null;
  return (
  <Card className={className}>
    <CardHeader>
      <CardTitle>Occupancy</CardTitle>
      <CardDescription>
        {latest
          ? `Latest upload: ${latest.fileName} · ${new Date(latest.timestamp).toLocaleString()}`
          : "Shown after your first upload."}
      </CardDescription>
    </CardHeader>
    {latest && occupancy && (
      <CardContent className="space-y-4">
        <OccupancyGauge occupancy={occupancy} />
        <p
          className="flex items-center justify-center gap-2 text-sm font-medium"
          data-testid="status"
          data-status={occupancy.status}
        >
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: STATUS[occupancy.status].color }}
            aria-hidden
          />
          {STATUS[occupancy.status].label}
        </p>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              ["Total", occupancy.total],
              ["Occupied", occupancy.occupied],
              ["Free", occupancy.free],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-muted px-2 py-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums" data-testid={`stat-${label.toLowerCase()}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground" data-testid="total-source">
          {explainTotal(latest)}
        </p>
        {occupancy.overflow > 0 ? (
          <Alert>
            <AlertCircle aria-hidden />
            <span>
              {latest.vehicles} cars were detected but you entered {occupancy.total} spaces,
              so occupancy is capped at 100%. Check the capacity, or the photo shows cars
              outside the lot.
            </span>
          </Alert>
        ) : (
          hasCapacityMismatch(latest) && (
            <Alert>
              <AlertCircle aria-hidden />
              <span>
                The capacity you entered and what the photo shows differ by more than 10%.
                Either the photo covers only part of the lot, the capacity is off, or the
                model missed or invented bays.
              </span>
            </Alert>
          )
        )}
      </CardContent>
    )}
  </Card>
  );
}
