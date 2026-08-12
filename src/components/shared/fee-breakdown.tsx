import { formatINR } from "@/lib/format";

/**
 * Reusable fee breakdown (FR-SAL-22): Base Fee, GST, Standard Fee (inclusive),
 * Concession Amount and Final Approved Fee. Pure presentation — it receives already
 * computed string values (server-computed; the browser never supplies a fee) and formats
 * them for display. Phase 4 embeds this in the lead form.
 */
export interface FeeBreakdownProps {
  baseFee: string;
  gstAmount: string;
  gstPercent: string;
  standardFee: string;
  concessionAmount?: string | null;
  finalApprovedFee?: string | null;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${strong ? "font-semibold" : ""}`}>
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

export function FeeBreakdown(props: FeeBreakdownProps) {
  const hasConcession = props.concessionAmount != null && Number(props.concessionAmount) > 0;
  const gstPct = Number(props.gstPercent).toFixed(0);
  return (
    <div className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
      <Row label="Base Fee" value={formatINR(props.baseFee)} />
      <Row label={`GST (${gstPct}%)`} value={formatINR(props.gstAmount)} />
      <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
      <Row label="Standard Fee (inclusive)" value={formatINR(props.standardFee)} strong />
      {hasConcession && (
        <Row label="Concession" value={`− ${formatINR(props.concessionAmount!)}`} />
      )}
      {props.finalApprovedFee != null && (
        <>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <Row label="Final Approved Fee" value={formatINR(props.finalApprovedFee)} strong />
        </>
      )}
    </div>
  );
}
