"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryEntry } from "@/lib/client/history";
import { computeOccupancy, formatPercent, STATUS } from "@/lib/occupancy";

interface Point {
  label: string;
  percent: number;
  color: string;
  when: string;
  detail: string;
}

function toPoints(history: HistoryEntry[]): Point[] {
  // History is stored newest first; the chart reads left to right in upload order.
  return [...history].reverse().map((entry, index) => {
    const occupancy = computeOccupancy(entry.vehicles, entry.totalSpaces);
    return {
      label: `#${index + 1}`,
      percent: occupancy.percent,
      color: STATUS[occupancy.status].color,
      when: new Date(entry.timestamp).toLocaleString(),
      detail: `${occupancy.occupied} of ${occupancy.total} spaces`,
    };
  });
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">
        {point.label} · {formatPercent(point.percent)}
      </p>
      <p className="text-muted-foreground">{point.detail}</p>
      <p className="text-muted-foreground">{point.when}</p>
    </div>
  );
}

function StatusDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: Point }) {
  if (cx == null || cy == null || !payload) return null;
  return <circle cx={cx} cy={cy} r={4} fill={payload.color} stroke="hsl(var(--card))" strokeWidth={1.5} />;
}

export function TrendChart({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        The trend appears after your first upload.
      </p>
    );
  }
  return (
    <div className="h-56" data-testid="trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={toPoints(history)} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 12 }}
            tickLine={false}
          />
          <ReferenceLine y={50} stroke={STATUS.yellow.color} strokeDasharray="4 4" />
          <ReferenceLine y={80} stroke={STATUS.red.color} strokeDasharray="4 4" />
          <Tooltip content={<TrendTooltip />} />
          <Line
            type="monotone"
            dataKey="percent"
            stroke="hsl(var(--foreground))"
            strokeWidth={2}
            dot={<StatusDot />}
            activeDot={{ r: 6 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
