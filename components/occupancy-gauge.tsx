"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";
import { formatPercent, STATUS, type Occupancy } from "@/lib/occupancy";

export function OccupancyGauge({ occupancy }: { occupancy: Occupancy }) {
  const { color, label } = STATUS[occupancy.status];
  return (
    <div
      className="relative h-44"
      role="img"
      aria-label={`Occupancy ${formatPercent(occupancy.percent)}: ${label}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={[{ value: occupancy.percent }]}
          startAngle={210}
          endAngle={-30}
          innerRadius="78%"
          outerRadius="100%"
          barSize={16}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar
            dataKey="value"
            fill={color}
            background={{ fill: "hsl(var(--muted))" }}
            cornerRadius={8}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums" data-testid="gauge-percent">
          {formatPercent(occupancy.percent)}
        </span>
        <span className="text-xs text-muted-foreground">full</span>
      </div>
    </div>
  );
}
