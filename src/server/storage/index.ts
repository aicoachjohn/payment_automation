/**
 * Payment-proof storage (FR-SEC-20..26). Private storage only — not publicly browsable,
 * not guessable by URL, no direct public link. Access is via a SHORT-LIVED SIGNED token
 * issued only after role + record access are verified (see the payments service and the
 * /api/proofs route). Files are stored under system-generated keys; the original
 * filename is metadata only, never the path (FR-SEC-24).
 *
 * Default provider is the local filesystem (Docker/MinIO is not required for dev); an S3
 * provider stub carries the shape for Phase 12. No provider name leaks outside this dir.
 */
import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface StorageProvider {
  readonly name: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T = unknown>(key: string): Promise<T | null>;
}

/** Local filesystem provider — private dir outside the web root, gitignored. */
class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private base = resolve(process.cwd(), process.env.PROOF_STORAGE_DIR ?? ".proof-storage");

  private path(key: string): string {
    // Keys are system-generated ("proofs/<uuid>"); reject traversal defensively.
    if (key.includes("..")) throw new Error("Invalid storage key.");
    return join(this.base, key);
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    void _contentType;
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async putJson(key: string, value: unknown): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(value));
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    try {
      return JSON.parse(new TextDecoder().decode(await this.get(key))) as T;
    } catch {
      return null;
    }
  }
}

/** S3 / MinIO provider — shape only; wired in Phase 12. Selected by STORAGE_PROVIDER=s3. */
class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private fail(): never {
    // TODO-INTEGRATION (Phase 12): implement with @aws-sdk/client-s3 against S3_ENDPOINT
    // (MinIO), private bucket S3_BUCKET, using PutObject/GetObject. Issue native
    // presigned URLs instead of the local HMAC token below.
    throw new Error("S3 storage is not configured in this environment.");
  }
  async put(): Promise<void> { this.fail(); }
  async get(): Promise<Uint8Array> { this.fail(); }
  async putJson(): Promise<void> { this.fail(); }
  async getJson(): Promise<null> { this.fail(); }
}

let provider: StorageProvider | null = null;
export function getStorageProvider(): StorageProvider {
  if (provider) return provider;
  provider = (process.env.STORAGE_PROVIDER ?? "local") === "s3" ? new S3StorageProvider() : new LocalStorageProvider();
  return provider;
}

/** A fresh, unguessable storage key for a proof (system-generated, FR-SEC-24). */
export function newProofKey(): string {
  return `proofs/${randomUUID()}`;
}

// ── Short-lived signed proof tokens (mimic S3 presigned URLs) ──────────────────

function signingSecret(): string {
  const secret = process.env.PROOF_SIGNING_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("Proof signing secret is not configured.");
  return secret;
}

/** Sign a token for proofId valid until `expiresAtMs`. Returns "<exp>.<hmac>". */
export function signProofToken(proofId: string, expiresAtMs: number): string {
  const mac = createHmac("sha256", signingSecret()).update(`${proofId}.${expiresAtMs}`).digest("hex");
  return `${expiresAtMs}.${mac}`;
}

/** Verify a proof token: not expired AND signature valid. */
export function verifyProofToken(proofId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAtMs = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  const expected = createHmac("sha256", signingSecret()).update(`${proofId}.${expiresAtMs}`).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
