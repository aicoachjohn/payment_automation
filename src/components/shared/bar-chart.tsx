/**
 * Minimal, accessible, dependency-free bar chart (server component). We do NOT add a
 * charting library — the stack is fixed — so this renders plain inline SVG with labelled
 * axes and a visually-hidden data table for screen readers (NFR-10 mobile-first, a11y).
 * All currency labels are pre-formatted by the caller through money.formatINR.
 */
export interface BarDatum {
  label: string;
  /** Numeric magnitude for the bar height. */
  value: number;
  /** Pre-formatted display value (e.g. ₹1,24,999.00). */
  display: string;
}

export function BarChart({
  data,
  title,
  height = 200,
}: {
  data: BarDatum[];
  title: string;
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barGap = 12;
  const barWidth = 44;
  const chartW = Math.max(data.length * (barWidth + barGap) + barGap, 240);
  const chartH = height;
  const axisH = 28;

  return (
    <figure className="space-y-2">
      <figcaption className="text-sm font-medium text-slate-700 dark:text-slate-300">{title}</figcaption>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`${title}. ${data.map((d) => `${d.label}: ${d.display}`).join(", ")}`}
          width={chartW}
          height={chartH + axisH}
          viewBox={`0 0 ${chartW} ${chartH + axisH}`}
          className="max-w-full"
        >
          {/* baseline */}
          <line x1="0" y1={chartH} x2={chartW} y2={chartH} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth="1" />
          {data.map((d, i) => {
            const h = Math.round((d.value / max) * (chartH - 8));
            const x = barGap + i * (barWidth + barGap);
            const y = chartH - h;
            return (
              <g key={d.label}>
                <rect x={x} y={y} width={barWidth} height={h} rx="3" className="fill-sky-500 dark:fill-sky-600">
                  <title>{`${d.label}: ${d.display}`}</title>
                </rect>
                <text x={x + barWidth / 2} y={chartH + 16} textAnchor="middle" className="fill-slate-500 text-[10px]">
                  {d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Screen-reader table mirror */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Category</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{d.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
