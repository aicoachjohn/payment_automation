/**
 * OCR provider interface + implementations (FR-SAL-39..42/47). Extraction gives speed;
 * mandatory human confirmation (enforced in the payment service) keeps it safe. No
 * provider name is referenced anywhere outside this folder — callers use getOcrProvider.
 */
import { PaymentMethod } from "@prisma/client";

export interface OcrFields {
  receivedAmount?: string; // normalised, e.g. "34999" / "50000"
  paymentDate?: string; // ISO date
  transactionId?: string; // UTR / Ref No, whitespace stripped
  payerName?: string;
  paymentMethod?: PaymentMethod;
}

export interface OcrResult {
  fields: OcrFields;
  confidence: Record<string, number>; // 0..1 per field
  raw: unknown;
}

export interface OcrProvider {
  readonly name: string;
  extract(fileBuffer: Uint8Array, mimeType: string): Promise<OcrResult>;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function mapMethod(text: string): PaymentMethod | undefined {
  if (/\bUPI\b|paytm|gpay|phonepe/i.test(text)) return PaymentMethod.UPI;
  if (/\bNEFT\b/i.test(text)) return PaymentMethod.NEFT;
  if (/\bIMPS\b/i.test(text)) return PaymentMethod.IMPS;
  if (/\bRTGS\b/i.test(text)) return PaymentMethod.RTGS;
  if (/\bcard\b/i.test(text)) return PaymentMethod.CARD;
  if (/\bcash\b/i.test(text)) return PaymentMethod.CASH;
  return undefined;
}

/**
 * Deterministic receipt parser — pure. Handles the real ProITbridge proof formats:
 * Paytm/UPI screenshots ("₹34,999", "Ref No: 3122 4582 5686") and bank NEFT receipts
 * ("Amount : Rs.50000", "Reference No: 2DHERX1J5191").
 */
export function parseReceiptText(text: string): OcrResult {
  const fields: OcrFields = {};
  const confidence: Record<string, number> = {};

  const amount = /(?:₹|Rs\.?|INR\.?)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  if (amount) {
    fields.receivedAmount = amount[1].replace(/,/g, "");
    confidence.receivedAmount = 0.95;
  }

  const txn = /(?:Ref(?:erence)?\s*No\.?|UTR(?:\s*No\.?)?|Transaction\s*ID|Txn\s*ID)\s*[:\-]?\s*([A-Z0-9][A-Z0-9 ]{5,})/i.exec(text);
  if (txn) {
    fields.transactionId = txn[1].replace(/\s+/g, "").trim();
    confidence.transactionId = 0.9;
  }

  // Date: "11 Aug 2026" or "08/11/2026" (DD/MM/YYYY).
  const dMon = /(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})/.exec(text);
  const dSlash = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (dMon && MONTHS[dMon[2].slice(0, 3).toLowerCase()] !== undefined) {
    const d = new Date(Date.UTC(Number(dMon[3]), MONTHS[dMon[2].slice(0, 3).toLowerCase()], Number(dMon[1])));
    fields.paymentDate = d.toISOString();
    confidence.paymentDate = 0.85;
  } else if (dSlash) {
    const d = new Date(Date.UTC(Number(dSlash[3]), Number(dSlash[2]) - 1, Number(dSlash[1])));
    fields.paymentDate = d.toISOString();
    confidence.paymentDate = 0.7;
  }

  const method = mapMethod(text);
  if (method) {
    fields.paymentMethod = method;
    confidence.paymentMethod = 0.8;
  }

  // Payer name: the name after "From", else the first Title/UPPER 2–3 word name line.
  const from = /From\s*[:\n]?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){1,3})/.exec(text);
  const caps = /^([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){1,3})$/m.exec(text);
  const name = from?.[1] ?? caps?.[1];
  if (name) {
    fields.payerName = name.trim();
    confidence.payerName = from ? 0.7 : 0.4;
  }

  return { fields, confidence, raw: { text: text.slice(0, 2000) } };
}

/** Deterministic mock, used in dev and tests. Decodes the buffer and parses it. */
class MockOcrProvider implements OcrProvider {
  readonly name = "mock";
  async extract(fileBuffer: Uint8Array): Promise<OcrResult> {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(fileBuffer);
    return parseReceiptText(text);
  }
}

/**
 * Google Cloud Vision text detection over its REST API using `fetch` (no SDK — keeps the
 * fixed stack). Selected by OCR_PROVIDER=vision; the key comes ONLY from env (FR-SEC-12).
 * The raw text is mapped by the SAME deterministic parser used in dev, so no field logic
 * moved. A quota error or timeout propagates and `runOcr` falls back to manual entry
 * (FR-SAL-47, NFR-02). To use AWS Textract / Azure DI instead, add a sibling provider —
 * the interface and the manual-entry fallback are unchanged.
 */
class GoogleVisionProvider implements OcrProvider {
  readonly name = "vision";
  async extract(fileBuffer: Uint8Array, mimeType: string): Promise<OcrResult> {
    void mimeType;
    const apiKey = process.env.OCR_API_KEY;
    if (!apiKey) throw new Error("OCR provider is not configured.");
    const base64 = Buffer.from(fileBuffer).toString("base64");
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] }),
    });
    if (!res.ok) throw new Error(`OCR request failed (${res.status}).`);
    const json = (await res.json()) as { responses?: { fullTextAnnotation?: { text?: string } }[] };
    const text = json.responses?.[0]?.fullTextAnnotation?.text ?? "";
    return { ...parseReceiptText(text), raw: { provider: "vision" } };
  }
}

let provider: OcrProvider | null = null;
export function getOcrProvider(): OcrProvider {
  if (provider) return provider;
  provider = (process.env.OCR_PROVIDER ?? "mock") === "vision" ? new GoogleVisionProvider() : new MockOcrProvider();
  return provider;
}

export interface OcrRun {
  ok: boolean; // false when OCR failed/timed out → allow full manual entry (FR-SAL-47, NFR-02)
  fields: OcrFields;
  confidence: Record<string, number>;
  raw: unknown;
}

/** Run OCR with a hard timeout (default 10s, NFR-02). Never blocks the caller beyond it. */
export async function runOcr(fileBuffer: Uint8Array, mimeType: string, timeoutMs = 10_000): Promise<OcrRun> {
  try {
    const result = await Promise.race([
      getOcrProvider().extract(fileBuffer, mimeType),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OCR timeout")), timeoutMs)),
    ]);
    return { ok: Object.keys(result.fields).length > 0, ...result };
  } catch {
    return { ok: false, fields: {}, confidence: {}, raw: null };
  }
}
