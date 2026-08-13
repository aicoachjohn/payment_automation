/**
 * OCR provider interface + implementations (FR-SAL-39..42/47). Extraction gives speed;
 * mandatory human confirmation (enforced in the payment service) keeps it safe. No
 * provider name is referenced anywhere outside this folder — callers use getOcrProvider.
 */
import { PaymentMethod, Plan } from "@prisma/client";

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
  text?: string; // the full recognised text (for lead auto-fill, FR-SAL-08 assist)
}

export interface OcrProvider {
  readonly name: string;
  extract(fileBuffer: Uint8Array, mimeType: string): Promise<OcrResult>;
}

/** Lead contact details extracted from an uploaded doc / pasted text (auto-fill assist). */
export interface LeadOcrFields {
  fullName?: string;
  mobile?: string;
  email?: string;
  leadSource?: string;
}

const SOURCE_WORDS = ["Instagram", "Facebook", "WhatsApp", "LinkedIn", "YouTube", "Referral", "Google", "Website", "Walk-in", "Twitter", "Telegram"];

/** Find the first valid 10-digit Indian mobile (starts 6–9), tolerating +91/0 and separators. */
function extractMobile(text: string): string | undefined {
  const candidates = text.match(/(?:\+?91[\s.-]?|0)?[6-9][\d\s.-]{9,15}/g) ?? [];
  for (const c of candidates) {
    const digits = c.replace(/\D/g, "");
    const ten = digits.length > 10 ? digits.slice(-10) : digits; // drop 91/0 prefix
    if (ten.length === 10 && /^[6-9]/.test(ten)) return ten;
  }
  return undefined;
}

/**
 * Parse lead contact details from free text — a WhatsApp message, an enquiry note, or the
 * text an OCR engine read off a screenshot. Pure + deterministic, so it is unit-testable
 * and used identically for pasted text and uploaded documents. Assistive only: the
 * salesperson reviews and confirms before the lead is created.
 */
export function parseLeadText(text: string): LeadOcrFields {
  const out: LeadOcrFields = {};

  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text);
  if (email) out.email = email[0].toLowerCase();

  const mobile = extractMobile(text);
  if (mobile) out.mobile = mobile;

  // Name — prefer an explicit "Name: X" label; else the first plausible name line.
  const labelled = /\b(?:name|student|learner|candidate)\s*[:\-]\s*([A-Za-z][A-Za-z .]{1,48})/i.exec(text);
  if (labelled) {
    out.fullName = labelled[1].trim().replace(/\s+/g, " ");
  } else {
    for (const rawLine of text.split(/[\n,;|]/)) {
      const line = rawLine.trim();
      // 1–4 words, letters only, not a source keyword, not obviously a label.
      if (/^[A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*){0,3}$/.test(line) && line.length >= 3 && line.length <= 48) {
        if (SOURCE_WORDS.some((s) => s.toLowerCase() === line.toLowerCase())) continue;
        if (/^(name|mobile|phone|email|source|enquiry|hi|hello|dear|regards|thanks|number)$/i.test(line)) continue;
        out.fullName = line.replace(/\s+/g, " ");
        break;
      }
    }
  }

  // Lead source — an explicit label, else a recognised platform keyword.
  const srcLabel = /\bsource\s*[:\-]\s*([A-Za-z][A-Za-z .-]{1,30})/i.exec(text);
  if (srcLabel) {
    out.leadSource = srcLabel[1].trim();
  } else {
    const word = SOURCE_WORDS.find((s) => new RegExp(`\\b${s}\\b`, "i").test(text));
    if (word) out.leadSource = word;
  }

  return out;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Month-name alternation (full or 3-letter) — restricts date regexes to real months. */
const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const monthIndex = (name: string): number => MONTHS[name.slice(0, 3).toLowerCase()];
const isoDate = (year: number, month0: number, day: number): string =>
  new Date(Date.UTC(year, month0, day)).toISOString();

function mapMethod(text: string): PaymentMethod | undefined {
  if (/\bUPI\b|paytm|gpay|phonepe/i.test(text)) return PaymentMethod.UPI;
  if (/\bNEFT\b/i.test(text)) return PaymentMethod.NEFT;
  if (/\bIMPS\b/i.test(text)) return PaymentMethod.IMPS;
  if (/\bRTGS\b/i.test(text)) return PaymentMethod.RTGS;
  if (/\bcard\b/i.test(text)) return PaymentMethod.CARD;
  if (/\bcash\b/i.test(text)) return PaymentMethod.CASH;
  return undefined;
}

/** A line that is clearly a receipt label/header, not a person's name. */
const NAME_NOISE =
  /^(transaction|payment|account|paid|success|from|to|payee|payer|beneficiary|sender|amount|reference|ref|utr|date|bank|status|nick\s*name|ifsc|micr|remarks|frequency|disclaimer|paytm|gpay|phonepe|google\s*pay|mode|balance|available)\b/i;
/** The payee is always ProITbridge / a bank — never the payer we want. */
const PAYEE_NOISE = /proitbridge|proit\s*bridge|kotak|mahindra|indian\s+bank|axis|hdfc|\bsbi\b|icici|yes\s*bank/i;
/** One line, 2–4 Title/UPPER-case words, initials allowed (e.g. "Ms S Nirmala", "MEGALA SEGAR"). */
const NAME_LINE = /^[A-Z][A-Za-z.]*(?:[ \t]+[A-Z][A-Za-z.]*){1,3}$/;

const NUM_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUM_SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000,
  crore: 10000000, crores: 10000000, million: 1000000, billion: 1000000000,
};
const isNumWord = (w: string): boolean => NUM_WORDS[w] !== undefined || NUM_SCALES[w] !== undefined || w === "and";

/**
 * Recover an amount spelled out in words ("Thirty Four Thousand Nine Hundred Ninety Nine
 * Rupees" → 34999). Paytm/UPI screenshots always print this line, and it survives when the
 * big stylized ₹ figure defeats image OCR entirely. Only a run of number-words anchored to
 * "Rupees"/"Only" is accepted, so it never mis-fires on account/reference numbers.
 */
function amountFromWords(text: string): number | null {
  const tokens = text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  let best: string[] | null = null;
  for (let i = 0; i < tokens.length; ) {
    if (!isNumWord(tokens[i])) { i++; continue; }
    let j = i;
    while (j < tokens.length && isNumWord(tokens[j])) j++;
    const anchor = (w: string | undefined) => w === "rupees" || w === "rupee" || w === "only";
    if (anchor(tokens[j]) || anchor(tokens[j + 1])) best = tokens.slice(i, j).filter((w) => w !== "and");
    i = j;
  }
  if (!best || best.length === 0) return null;
  let total = 0, current = 0;
  for (const w of best) {
    if (NUM_WORDS[w] !== undefined) current += NUM_WORDS[w];
    else if (w === "hundred") current = (current || 1) * 100;
    else if (NUM_SCALES[w] !== undefined) { total += (current || 1) * NUM_SCALES[w]; current = 0; }
  }
  const value = total + current;
  return value > 0 ? value : null;
}

/**
 * Deterministic receipt parser — pure. Handles the real ProITbridge proof formats:
 * Paytm/UPI screenshots ("₹34,999", "Ref No: 3122 4582 5686", a YEARLESS date like
 * "11 Aug, 06:45 PM") and bank NEFT receipts ("Amount : Rs.50000",
 * "Reference No: 2DHERX1J5191"). `fallbackYear` supplies the year for a yearless proof
 * date (the caller passes the enrollment / current year); without it a yearless date is
 * left unset rather than guessed.
 */
export function parseReceiptText(text: string, fallbackYear?: number): OcrResult {
  const fields: OcrFields = {};
  const confidence: Record<string, number> = {};

  // Amount, most reliable first: (1) a currency-prefixed figure (₹34,999 / Rs.50000);
  // (2) a comma-grouped number even when OCR dropped the ₹ glyph ("34,999"); (3) the amount
  // spelled out before "Rupees"/"Only" — the only form that survives when the big stylized
  // figure defeats image OCR entirely (real Paytm screenshots).
  const amtCurrency = /(?:₹|Rs\.?|INR\.?)\s*([\d,]+(?:\.\d{1,2})?)/i.exec(text);
  const amtGrouped = /(?:^|[^\w.])(\d{1,2}(?:,\d{2,3})+(?:\.\d{1,2})?)(?!\d)/.exec(text);
  if (amtCurrency) {
    fields.receivedAmount = amtCurrency[1].replace(/,/g, "");
    confidence.receivedAmount = 0.95;
  } else if (amtGrouped) {
    fields.receivedAmount = amtGrouped[1].replace(/,/g, "");
    confidence.receivedAmount = 0.75;
  } else {
    const words = amountFromWords(text);
    if (words != null) {
      fields.receivedAmount = String(words);
      confidence.receivedAmount = 0.6;
    }
  }

  const txn = /(?:Ref(?:erence)?\s*No\.?|UTR(?:\s*No\.?)?|Transaction\s*ID|Txn\s*ID)\s*[:\-]?\s*([A-Z0-9][A-Z0-9 ]{5,})/i.exec(text);
  if (txn) {
    fields.transactionId = txn[1].replace(/\s+/g, "").trim();
    confidence.transactionId = 0.9;
  }

  // Date, most-specific first: "11 Aug 2026" → "08/11/2026" (DD/MM) → yearless "11 Aug".
  const dMonYr = new RegExp(`\\b(\\d{1,2})[ \\t]+(${MONTH_ALT})\\.?[ \\t]*,?[ \\t]*(\\d{4})\\b`, "i").exec(text);
  const dSlash = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  const dMonNoYr = new RegExp(`\\b(\\d{1,2})[ \\t]+(${MONTH_ALT})\\b`, "i").exec(text);
  if (dMonYr) {
    fields.paymentDate = isoDate(Number(dMonYr[3]), monthIndex(dMonYr[2]), Number(dMonYr[1]));
    confidence.paymentDate = 0.85;
  } else if (dSlash) {
    // Indian day-first convention (DD/MM/YYYY) — genuinely ambiguous for day ≤ 12.
    fields.paymentDate = isoDate(Number(dSlash[3]), Number(dSlash[2]) - 1, Number(dSlash[1]));
    confidence.paymentDate = 0.7;
  } else if (dMonNoYr && fallbackYear !== undefined) {
    fields.paymentDate = isoDate(fallbackYear, monthIndex(dMonNoYr[2]), Number(dMonNoYr[1]));
    confidence.paymentDate = 0.55; // year inferred → lower confidence
  }

  const method = mapMethod(text);
  if (method) {
    fields.paymentMethod = method;
    confidence.paymentMethod = 0.8;
  }

  // Payer name: prefer "From <name>" (but not "From Account …"); else the first name-shaped
  // line that is not a header/label and not the payee (ProITbridge / a bank).
  let payerName: string | undefined;
  let payerConfidence = 0;
  const from = /From\b[ \t]*[:\n]?[ \t]*((?:[A-Z][A-Za-z.]*)(?:[ \t]+[A-Z][A-Za-z.]*){0,3})/.exec(text);
  if (from && !/^(account|a\/c|bank|upi)\b/i.test(from[1].trim())) {
    payerName = from[1].trim();
    payerConfidence = 0.7;
  }
  if (!payerName) {
    for (const rawLine of text.split(/\n/)) {
      const line = rawLine.trim();
      if (NAME_LINE.test(line) && !NAME_NOISE.test(line) && !PAYEE_NOISE.test(line)) {
        payerName = line;
        payerConfidence = 0.4;
        break;
      }
    }
  }
  if (payerName) {
    fields.payerName = payerName;
    confidence.payerName = payerConfidence;
  }

  return { fields, confidence, raw: { text: text.slice(0, 2000) } };
}

/** Learner + program fields extracted from the WhatsApp "Enrollment Confirmation" message. */
export interface EnrollmentOcrFields {
  fullName?: string;
  dob?: string; // ISO date (day-first / DD-MM convention assumed)
  fullAddress?: string;
  pincode?: string;
  email?: string;
  mobile?: string; // digits, international "+…" preserved
  plan?: Plan;
  programName?: string; // free-text marketing name
  courseFee?: string; // digits — a CROSS-CHECK only, never authoritative (rule #3)
  commencingDate?: string; // ISO date
}

/**
 * Parse the learner + program details from the pasted "Enrollment Confirmation" message.
 * Pure + deterministic (unit-testable, identical for pasted text and OCR'd document text).
 * Assistive only: every field is reviewed and confirmed by the salesperson before anything
 * is created. Dates use the Indian day-first (DD/MM) convention; the review screen is the
 * human backstop for the day≤12 ambiguity.
 */
export function parseEnrollmentText(text: string): EnrollmentOcrFields {
  const out: EnrollmentOcrFields = {};
  const labelled = (labels: string[]): string | undefined => {
    const re = new RegExp(`\\b(?:${labels.join("|")})\\s*(?:No\\.?|ID)?\\s*[:\\-]\\s*(.+)`, "i");
    const m = re.exec(text);
    return m ? m[1].trim() : undefined;
  };

  const name = labelled(["Full Name", "Name", "Student", "Learner", "Candidate"]);
  if (name) out.fullName = name.replace(/["'*]/g, "").trim().replace(/\s+/g, " ");

  const dobRaw = labelled(["DOB", "Date of Birth", "D\\.O\\.B", "Birth Date"]);
  if (dobRaw) {
    const m = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(dobRaw);
    if (m) out.dob = isoDate(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  const addr = labelled(["Full Address", "Address", "Residential Address"]);
  if (addr) out.fullAddress = addr.replace(/\*/g, "").trim();

  const pinRaw = labelled(["Pincode", "Pin Code", "PIN", "Postal Code", "Zip"]);
  if (pinRaw) {
    const p = /\b(\d{6})\b/.exec(pinRaw);
    if (p) out.pincode = p[1];
  }

  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text);
  if (email) out.email = email[0].toLowerCase();

  // Mobile: labelled value first (allows an international +country prefix, e.g. "+1 480…");
  // else the deterministic Indian-mobile finder.
  const mobRaw = labelled(["Mobile", "Phone", "Contact", "Whatsapp", "Mob", "Cell"]);
  if (mobRaw) {
    const m = /(\+?\d[\d\s.\-]{6,17}\d)/.exec(mobRaw);
    if (m) out.mobile = m[1].replace(/[\s.\-]/g, "");
  }
  if (!out.mobile) {
    const m = extractMobile(text);
    if (m) out.mobile = m;
  }

  // Plan — prefer the header tag ("Enrollment Confirmation - PREMIUM") or a quoted plan,
  // else the first plan keyword anywhere.
  const planTag =
    /Enrollment Confirmation\s*[-–]\s*([A-Za-z]+)/i.exec(text) ??
    /["'“”]\s*(PREMIUM|ADVANCED)\s*["'“”]/i.exec(text) ??
    /\b(premium|advanced)\b/i.exec(text);
  if (planTag) out.plan = /premium/i.test(planTag[1]) ? Plan.PREMIUM : Plan.ADVANCED;

  const prog = labelled(["Program Name", "Programme Name", "Course Name", "Program", "Course"]);
  if (prog) {
    out.programName = prog
      .replace(/\*/g, "")
      .replace(/["'“”][A-Za-z ]+["'“”]\s*$/, "") // drop a trailing quoted plan tag
      .trim();
  }

  const fee = /(?:Course\s*fee|Total\s*fee|Program\s*fee|Fee)\s*[:\-]?\s*\*?\s*(?:₹|Rs\.?|INR\.?)\s*([\d,]+)/i.exec(text);
  if (fee) out.courseFee = fee[1].replace(/,/g, "");

  const cm = new RegExp(
    `Commenc\\w*\\s*Date\\s*[:\\-]?\\s*\\*?\\s*(\\d{1,2})(?:st|nd|rd|th)?[ \\t]+(${MONTH_ALT})[ \\t]+(\\d{4})`,
    "i",
  ).exec(text);
  if (cm) out.commencingDate = isoDate(Number(cm[3]), monthIndex(cm[2]), Number(cm[1]));

  return out;
}

/** Deterministic mock, used in dev and tests. Decodes the buffer and parses it. */
class MockOcrProvider implements OcrProvider {
  readonly name = "mock";
  async extract(fileBuffer: Uint8Array): Promise<OcrResult> {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(fileBuffer);
    return { ...parseReceiptText(text, new Date().getUTCFullYear()), text };
  }
}

// ── On-device OCR: PDF text-layer (unpdf) + image OCR (tesseract.js) ───────────
// No cloud key, works offline (OCR_PROVIDER=local). PDFs with a text layer extract
// exactly; image screenshots go through Tesseract (best-effort — the mandatory review
// screen confirms/corrects every field, so imperfect OCR never means lost data, BR-20).

/** Extract a PDF's text layer via unpdf (pdf.js under the hood). Empty for scanned PDFs. */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : (text ?? "");
}

// One shared Tesseract worker, created lazily and reused (per-call creation is very slow).
type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let tesseractWorker: Promise<TesseractWorker> | null = null;
function getTesseractWorker(): Promise<TesseractWorker> {
  if (!tesseractWorker) {
    tesseractWorker = import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
  }
  return tesseractWorker;
}

async function ocrImage(bytes: Uint8Array): Promise<string> {
  const worker = await getTesseractWorker();
  const { data } = await worker.recognize(Buffer.from(bytes));
  return data.text ?? "";
}

class LocalOcrProvider implements OcrProvider {
  readonly name = "local";
  async extract(fileBuffer: Uint8Array, mimeType: string): Promise<OcrResult> {
    let text = "";
    try {
      if (mimeType === "application/pdf") text = await extractPdfText(fileBuffer);
      else if (mimeType.startsWith("image/")) text = await ocrImage(fileBuffer);
    } catch {
      text = ""; // extraction failed → fall through to the UTF-8 fallback / manual entry
    }
    // Fallback for embedded-text files (and scanned PDFs whose text layer was empty).
    if (!text.trim()) {
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(fileBuffer);
      if (/[\x20-\x7e]{3,}/.test(decoded)) text = decoded;
    }
    return { ...parseReceiptText(text, new Date().getUTCFullYear()), raw: { provider: "local" }, text };
  }
}

/**
 * Google Cloud Vision DOCUMENT_TEXT_DETECTION over its REST API using `fetch` (no SDK —
 * keeps the fixed stack). The key comes ONLY from env (OCR_API_KEY, FR-SEC-12). Vision reads
 * stylized screenshots (₹ figures, colour logos) far better than on-device OCR. Throws on a
 * missing key / non-2xx / per-image API error so the caller can fall back.
 */
async function visionImageOcr(bytes: Uint8Array): Promise<string> {
  const apiKey = process.env.OCR_API_KEY;
  if (!apiKey) throw new Error("Vision OCR is not configured (OCR_API_KEY missing).");
  const base64 = Buffer.from(bytes).toString("base64");
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ image: { content: base64 }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] }] }),
  });
  if (!res.ok) throw new Error(`Vision request failed (${res.status}).`);
  const json = (await res.json()) as { responses?: { fullTextAnnotation?: { text?: string }; error?: { message?: string } }[] };
  const r0 = json.responses?.[0];
  if (r0?.error?.message) throw new Error(`Vision error: ${r0.error.message}`);
  return r0?.fullTextAnnotation?.text ?? "";
}

/**
 * Hybrid cloud provider (OCR_PROVIDER=vision): PDFs go through the text layer (unpdf) — exact
 * and free, no need to pay Vision for text receipts — and images go through Google Vision.
 * If Vision is unconfigured or errors (no key, quota, network), it degrades gracefully to the
 * on-device engine so nothing is ever lost. The SAME deterministic parser maps the text.
 */
class GoogleVisionProvider implements OcrProvider {
  readonly name = "vision";
  async extract(fileBuffer: Uint8Array, mimeType: string): Promise<OcrResult> {
    let text = "";
    try {
      if (mimeType === "application/pdf") {
        text = await extractPdfText(fileBuffer);
      } else if (mimeType.startsWith("image/")) {
        text = process.env.OCR_API_KEY
          ? await visionImageOcr(fileBuffer)
          : await ocrImage(fileBuffer); // no key configured → on-device
      }
    } catch (err) {
      // Vision failed → on-device fallback for images (surfaced in logs, never lost).
      console.warn("[ocr] Vision failed, falling back to on-device OCR:", err instanceof Error ? err.message : err);
      try {
        if (mimeType.startsWith("image/")) text = await ocrImage(fileBuffer);
      } catch {
        text = "";
      }
    }
    if (!text.trim()) {
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(fileBuffer);
      if (/[\x20-\x7e]{3,}/.test(decoded)) text = decoded;
    }
    return { ...parseReceiptText(text, new Date().getUTCFullYear()), raw: { provider: "vision" }, text };
  }
}

let provider: OcrProvider | null = null;
export function getOcrProvider(): OcrProvider {
  if (provider) return provider;
  const kind = process.env.OCR_PROVIDER ?? "mock";
  provider =
    kind === "vision" ? new GoogleVisionProvider() : kind === "local" ? new LocalOcrProvider() : new MockOcrProvider();
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
