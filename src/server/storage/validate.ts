/**
 * Server-side file validation by ACTUAL CONTENT — magic bytes, not the file extension
 * (FR-SEC-22, NFR-15). Only JPG, PNG and PDF are accepted, up to 10 MB. Pure, so a
 * renamed .exe or an oversized file is rejected before it is ever stored or scanned.
 */
export type ProofFileType = "image/jpeg" | "image/png" | "application/pdf";

/** Detect a proof file's true type from its leading bytes, or null if unsupported. */
export function detectFileType(bytes: Uint8Array): ProofFileType | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  // PDF: 25 50 44 46 2D  ("%PDF-")
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length >= 5 && pdf.every((b, i) => bytes[i] === b)) {
    return "application/pdf";
  }
  return null;
}

export interface FileValidation {
  ok: boolean;
  type?: ProofFileType;
  error?: string;
}

export function validateProofFile(bytes: Uint8Array, maxBytes: number): FileValidation {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > maxBytes) {
    return { ok: false, error: `The file is too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))} MB.` };
  }
  const type = detectFileType(bytes);
  if (!type) {
    return { ok: false, error: "Only JPG, PNG or PDF files are accepted." };
  }
  return { ok: true, type };
}
