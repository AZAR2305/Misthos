"use client";

import { useId } from "react";
import { discountOf, formatUsd } from "@/lib/core";

/**
 * The one memorable element (CLAUDE.md 10.7): the price of waiting, drawn. For each rate it plots the discount the buyer
 * would keep if the invoice were paid on a given day. The further left (earlier), the larger the discount. When an invoice
 * has settled, its rate is the bold line and the day it was paid is marked. No data is invented: every point is the contract's
 * formula applied to this invoice's real amount and due date.
 */
export interface CurveProps {
  face: bigint;
  dueSec: number;
  /** Start of the plotted window, unix seconds (when it was registered or approved). */
  startSec: number;
  nowSec: number;
  /** Rates in basis points to draw. */
  rates: number[];
  settled?: { rateBps: number; paidSec: number; discount: bigint };
}

const W = 640;
const H = 280;
const M = { l: 56, r: 18, t: 16, b: 38 };

export function DiscountCurve({ face, dueSec, startSec, nowSec, rates, settled }: CurveProps) {
  const id = useId();
  const span = Math.max(1, Math.round(dueSec - startSec));
  const maxRate = Math.max(...rates, 1);
  const yMaxMinor = discountOf(face, maxRate, BigInt(span)) || 1n;
  const yMax = Number(yMaxMinor) * 1.08;
  const x = (t: number) => M.l + ((t - startSec) / span) * (W - M.l - M.r);
  const y = (minor: bigint) => H - M.b - (Number(minor) / yMax) * (H - M.t - M.b);
  const at = (rate: number, t: number) => discountOf(face, rate, BigInt(Math.max(0, Math.round(dueSec - t))));
  const days = Math.max(1, Math.round(span / 86_400));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(startSec + f * span));
  const yTicks = [0, 0.5, 1].map((f) => BigInt(Math.round(Number(yMaxMinor) * f)));
  const pts = (rate: number) => [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => { const t = startSec + f * span; return `${x(t).toFixed(1)},${y(at(rate, t)).toFixed(1)}`; }).join(" ");
  const showNow = nowSec > startSec && nowSec < dueSec && !settled;

  return (
    <figure className="curve" aria-labelledby={`${id}-cap`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Discount by payment day">
        {yTicks.map((v, i) => (
          <g key={i}>
            <line className="grid" x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end">{formatUsd(v, 0)}</text>
          </g>
        ))}
        <line className="axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
        {ticks.map((t, i) => (
          <text key={i} x={x(t)} y={H - M.b + 18} textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}>
            {i === ticks.length - 1 ? "due date" : `${Math.round(((dueSec - t) / 86_400))}d before`}
          </text>
        ))}
        {rates.map((r) => {
          const bold = settled ? r === settled.rateBps : false;
          return (
            <g key={r} opacity={settled && !bold ? 0.35 : 1}>
              <polyline className="line" points={pts(r)} style={{ strokeWidth: bold ? 3.5 : 1.8, opacity: bold ? 1 : 0.65 }} />
              <text x={W - M.r} y={y(at(r, startSec + span * 0.97)) - 6} textAnchor="end" style={{ fill: "var(--accent)" }}>
                {(r / 100).toFixed(r % 100 ? 1 : 0)}%
              </text>
            </g>
          );
        })}
        {showNow && (
          <g>
            <line className="axis" x1={x(nowSec)} x2={x(nowSec)} y1={M.t} y2={H - M.b} strokeDasharray="4 4" />
            <text x={x(nowSec)} y={M.t + 8} textAnchor="middle">today</text>
          </g>
        )}
        {settled && (
          <g>
            <circle className="pt pt-hot pulse" cx={x(settled.paidSec)} cy={y(settled.discount)} r={7} />
            <circle className="pt pt-hot" cx={x(settled.paidSec)} cy={y(settled.discount)} r={5} />
            <text x={x(settled.paidSec)} y={y(settled.discount) - 14} textAnchor="middle" style={{ fill: "var(--color-text)" }}>
              paid early: {formatUsd(settled.discount)}
            </text>
          </g>
        )}
      </svg>
      <figcaption id={`${id}-cap`} className="muted tiny">
        Discount by payment day over the {days} days before the due date. Each line is one rate (annual). Earlier means a larger discount. These
        are the contract&apos;s own numbers for this invoice.
      </figcaption>
    </figure>
  );
}
