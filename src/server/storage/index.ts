/**
 * Payment-proof storage (FR-SEC-20..26). Private storage only — not publicly browsable,
 * not guessable by URL, no direct public link. Access is via a SHORT-LIVED SIGNED token
 * issued only after role + record access are verified (see the payments service and the
 * /api/proofs route). Files are stored under system-generated keys; the original
 * filename is metadata only, never the path (FR-SEC-24).
 *
 * Default provider is the local filesystem (Docker/MinIO is not required for dev). Vercel
 * Blob is the provider for the hosted deployment, because Vercel's filesystem is read-only
 * apart from a per-instance /tmp — a proof written by one lambda is simply not there when
 * the next one serves the read. An S3 provider stub carries the shape for a future move to
 * a private bucket. No provider name leaks outside this dir.
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

  /**
   * This provider is the default, which makes it the one a misconfigured deployment falls
   * back to — and on a serverless host that is the most dangerous outcome in the app: the
   * write SUCCEEDS, the file lands on an instance that is about to disappear, and the proof
   * is gone by the time anyone opens it. Nandhiya would then be auditing a payment against
   * a proof that no longer exists (BR-15), with nothing to indicate anything went wrong.
   *
   * So refuse up front. A blocked upload with a clear message is recoverable; a silently
   * lost payment proof is not.
   */
  private assertUsable(): void {
    if (process.env.VERCEL) {
      throw new Error(
        "Proof storage is not configured for this deployment. Set STORAGE_PROVIDER=blob and " +
          "connect a Blob store, otherwise uploaded proofs would be lost.",
      );
    }
  }

  private path(key: string): string {
    // Keys are system-generated ("proofs/<uuid>"); reject traversal defensively.
    if (key.includes("..")) throw new Error("Invalid storage key.");
    return join(this.base, key);
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    void _contentType;
    this.assertUsable();
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    this.assertUsable();
    return new Uint8Array(await readFile(this.path(key)));
  }

  async putJson(key: string, value: unknown): Promise<void> {
    this.assertUsable();
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

/**
 * Vercel Blob provider (STORAGE_PROVIDER=blob) — the provider for the hosted deployment.
 *
 * Keys stay system-generated ("proofs/<uuid>") and are used verbatim as the blob pathname,
 * so one key always resolves to exactly one object and a re-upload replaces it in place.
 *
 * Vercel Blob has no private-object mode: every object carries a public URL. That URL is
 * unguessable (a random store host plus a UUID key), and — this is the part that matters —
 * the app NEVER hands it to a browser. Proofs are streamed through /api/proofs behind the
 * short-lived signed token and the usual role + record-ownership checks, exactly as they are
 * on local disk, so FR-SEC-20..26 hold. Nothing outside this file ever sees a blob URL.
 *
 * The SDK is imported lazily so a machine with no Blob store (dev, CI, tests) never loads it.
 */
class BlobStorageProvider implements StorageProvider {
  readonly name = "blob";

  private token(): string {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      throw new Error("Proof storage is not configured. Set BLOB_READ_WRITE_TOKEN.");
    }
    return token;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { put } = await import("@vercel/blob");
    await put(key, Buffer.from(bytes), {
      access: "public",
      // The key is already an unguessable UUID; a suffix would make it unaddressable.
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      token: this.token(),
    });
  }

  /**
   * A key alone does not name a URL — the store's host is assigned by Vercel — so resolve it
   * by prefix. An exact pathname match, never the first hit, so "proofs/ab" can never return
   * "proofs/abc".
   */
  private async urlFor(key: string): Promise<string | null> {
    const { list } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: key, limit: 1000, token: this.token() });
    return blobs.find((b) => b.pathname === key)?.downloadUrl ?? null;
  }

  async get(key: string): Promise<Uint8Array> {
    const url = await this.urlFor(key);
    // Safe error (NFR-11): says what is wrong, leaks neither the key nor the blob URL.
    if (!url) throw new Error("The stored file could not be found.");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("The stored file could not be read.");
    return new Uint8Array(await res.arrayBuffer());
  }

  async putJson(key: string, value: unknown): Promise<void> {
    await this.put(key, new TextEncoder().encode(JSON.stringify(value)), "application/json");
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
  switch (process.env.STORAGE_PROVIDER ?? "local") {
    case "blob":
      provider = new BlobStorageProvider();
      break;
    case "s3":
      provider = new S3StorageProvider();
      break;
    default:
      provider = new LocalStorageProvider();
  }
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
