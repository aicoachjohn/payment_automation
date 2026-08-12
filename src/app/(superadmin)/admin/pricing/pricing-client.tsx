"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Program, Plan, ComboMode } from "@prisma/client";
import { formatINR, formatDate } from "@/lib/format";
import { FeeBreakdown } from "@/components/shared/fee-breakdown";
import { calculateFeeAction } from "@/app/_actions/fee";
import {
  createPricingAction,
  deactivatePricingAction,
  setThresholdAction,
  setReasonCodesAction,
} from "./actions";

export interface PricingRow {
  id: string;
  program: Program;
  plan: Plan | null;
  advancedFee: string | null;
  premiumFee: string | null;
  singleShotFee: string | null;
  doubleShotFee: string | null;
  gstPercent: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  specialPricingName: string | null;
}

type Thresholds = Record<string, { amount: string; percent: string }>;

interface NewPricing {
  program: Program;
  plan?: Plan;
  advancedFee?: string;
  premiumFee?: string;
  singleShotFee?: string;
  doubleShotFee?: string;
}

const input =
  "rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800";
const btn =
  "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";
const money = (v: string | null) => (v ? formatINR(v) : "—");

export function PricingClient({
  pricing,
  thresholds,
  reasonCodes,
}: {
  pricing: PricingRow[];
  thresholds: Thresholds;
  reasonCodes: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ serverError?: string; validationErrors?: unknown } | undefined>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res?.serverError) setError(res.serverError);
      else if (res?.validationErrors) setError("Please check the values entered.");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-10">
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <FeeCalculator />

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Pricing entries</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2">Program</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Advanced / Premium</th>
                <th className="px-3 py-2">Single / Double</th>
                <th className="px-3 py-2">GST</th>
                <th className="px-3 py-2">Effective</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pricing.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">{r.program}</td>
                  <td className="px-3 py-2">{r.plan ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">{money(r.advancedFee)} / {money(r.premiumFee)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{money(r.singleShotFee)} / {money(r.doubleShotFee)}</td>
                  <td className="px-3 py-2">{String(r.gstPercent).replace(/\.0+$/, "")}%</td>
                  <td className="px-3 py-2 text-xs">
                    {formatDate(r.effectiveFrom)}
                    {r.effectiveTo ? ` → ${formatDate(r.effectiveTo)}` : " → open"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={r.status === "ACTIVE" && !r.effectiveTo ? "text-green-700" : "text-slate-400"}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.status === "ACTIVE" && !r.effectiveTo && (
                      <button
                        className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                        disabled={pending}
                        onClick={() => run(() => deactivatePricingAction({ pricingId: r.id }))}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CreatePricing pending={pending} onSubmit={(data) => run(() => createPricingAction(data))} />
      </div>

      <ThresholdEditor thresholds={thresholds} pending={pending} onSubmit={(plan, amount, percent) => run(() => setThresholdAction({ plan, amount, percent }))} />

      <ReasonCodeEditor reasonCodes={reasonCodes} pending={pending} onSubmit={(codes) => run(() => setReasonCodesAction({ codes }))} />
    </div>
  );
}

function FeeCalculator() {
  const [program, setProgram] = useState<Program>(Program.COMBO_ALL_THREE);
  const [plan, setPlan] = useState<Plan>(Plan.PREMIUM);
  const [comboMode, setComboMode] = useState<ComboMode>(ComboMode.DOUBLE_SHOT);
  const [quote, setQuote] = useState<{ baseFee: string; gstAmount: string; gstPercent: string; standardFee: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isCombo = program === Program.COMBO_ALL_THREE;

  function calc() {
    setError(null);
    start(async () => {
      const res = await calculateFeeAction({ program, plan, comboMode: isCombo ? comboMode : null });
      if (res?.serverError) { setError(res.serverError); setQuote(null); return; }
      if (res?.data) setQuote(res.data);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="text-lg font-semibold">Fee calculator (BR-01)</h2>
      <p className="text-sm text-slate-500">The engine computes the fee from selections — no fee is ever hand-typed.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Program
          <select className={input} value={program} onChange={(e) => setProgram(e.target.value as Program)}>
            {Object.values(Program).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">Plan
          <select className={input} value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
            {Object.values(Plan).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {isCombo && (
          <label className="flex flex-col gap-1 text-xs text-slate-500">Combo mode
            <select className={input} value={comboMode} onChange={(e) => setComboMode(e.target.value as ComboMode)}>
              {Object.values(ComboMode).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
        <button type="button" className={btn} disabled={pending} onClick={calc}>Calculate</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {quote && (
        <div className="max-w-sm">
          <FeeBreakdown baseFee={quote.baseFee} gstAmount={quote.gstAmount} gstPercent={quote.gstPercent} standardFee={quote.standardFee} finalApprovedFee={quote.standardFee} />
        </div>
      )}
    </div>
  );
}

function CreatePricing({ pending, onSubmit }: { pending: boolean; onSubmit: (data: NewPricing) => void }) {
  const [program, setProgram] = useState<Program>(Program.DATA_ANALYST);
  const [plan, setPlan] = useState<Plan>(Plan.ADVANCED);
  const [advancedFee, setAdvancedFee] = useState("");
  const [premiumFee, setPremiumFee] = useState("");
  const [singleShotFee, setSingleShotFee] = useState("");
  const [doubleShotFee, setDoubleShotFee] = useState("");
  const isCombo = program === Program.COMBO_ALL_THREE;

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          isCombo
            ? { program, plan, singleShotFee, doubleShotFee }
            : { program, advancedFee, premiumFee },
        );
      }}
    >
      <span className="w-full text-sm font-medium">Add a pricing entry</span>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Program
        <select className={input} value={program} onChange={(e) => setProgram(e.target.value as Program)}>
          {Object.values(Program).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      {isCombo ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-slate-500">Plan
            <select className={input} value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
              {Object.values(Plan).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">Single Shot
            <input className={input} value={singleShotFee} onChange={(e) => setSingleShotFee(e.target.value)} placeholder="31999" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">Double Shot
            <input className={input} value={doubleShotFee} onChange={(e) => setDoubleShotFee(e.target.value)} placeholder="34999" />
          </label>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-xs text-slate-500">Advanced Fee
            <input className={input} value={advancedFee} onChange={(e) => setAdvancedFee(e.target.value)} placeholder="24999" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">Premium Fee
            <input className={input} value={premiumFee} onChange={(e) => setPremiumFee(e.target.value)} placeholder="74999" />
          </label>
        </>
      )}
      <button type="submit" className={btn} disabled={pending}>Add entry</button>
    </form>
  );
}

function ThresholdEditor({ thresholds, pending, onSubmit }: { thresholds: Thresholds; pending: boolean; onSubmit: (plan: Plan, amount: string, percent: string) => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Concession thresholds (per plan)</h2>
      <p className="text-sm text-slate-500">A concession at or below the lower of the amount cap and the percent cap is auto-approved; above it needs Manager/Admin approval.</p>
      <div className="flex flex-wrap gap-6">
        {Object.values(Plan).map((plan) => (
          <ThresholdRow key={plan} plan={plan} value={thresholds[plan] ?? { amount: "2000", percent: "10" }} pending={pending} onSubmit={onSubmit} />
        ))}
      </div>
    </div>
  );
}

function ThresholdRow({ plan, value, pending, onSubmit }: { plan: Plan; value: { amount: string; percent: string }; pending: boolean; onSubmit: (plan: Plan, amount: string, percent: string) => void }) {
  const [amount, setAmount] = useState(String(value.amount));
  const [percent, setPercent] = useState(String(value.percent));
  return (
    <form
      className="flex items-end gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
      onSubmit={(e) => { e.preventDefault(); onSubmit(plan, amount.trim(), percent.trim()); }}
    >
      <span className="text-sm font-medium">{plan}</span>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Amount ₹
        <input className={`${input} w-24`} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Percent %
        <input className={`${input} w-20`} value={percent} onChange={(e) => setPercent(e.target.value)} />
      </label>
      <button type="submit" className={btn} disabled={pending}>Save</button>
    </form>
  );
}

function ReasonCodeEditor({ reasonCodes, pending, onSubmit }: { reasonCodes: string[]; pending: boolean; onSubmit: (codes: string[]) => void }) {
  const [text, setText] = useState(reasonCodes.join("\n"));
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Audit reason codes</h2>
      <p className="text-sm text-slate-500">One per line. Used by the L1 audit for Correction/Rejection reasons (FR-ADM-09).</p>
      <form
        className="flex flex-col items-start gap-2"
        onSubmit={(e) => { e.preventDefault(); onSubmit(text.split("\n").map((s) => s.trim()).filter(Boolean)); }}
      >
        <textarea className={`${input} h-32 w-full max-w-md`} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className={btn} disabled={pending}>Save reason codes</button>
      </form>
    </div>
  );
}
