# Deploying to Vercel

The other hosting option is a self-managed Docker host — see `DEPLOYMENT.md`. This file
covers Vercel + Neon Postgres + Vercel Blob, and only that.

Vercel runs the app as serverless functions. Three things follow from that, and they are
the whole reason this document exists:

1. **The filesystem is read-only** apart from a per-instance `/tmp` that is wiped between
   invocations. Payment proofs therefore CANNOT use `STORAGE_PROVIDER=local` — an upload
   would appear to succeed and then 404 on the next request, from a different instance.
2. **Every invocation opens its own database connection**, so `DATABASE_URL` must point at
   a pooler or Postgres runs out of connections under ordinary use.
3. **Nothing long-running exists between requests**, so the daily automation is driven by
   Vercel Cron rather than by a process the app owns.

---

## 1. Database — Neon

Create a project at <https://neon.tech> (region close to your users; `ap-south-1`/Mumbai
for an India-based team). From the connection-details panel take **both** strings:

| Vercel env var | Which Neon string | Why |
|---|---|---|
| `DATABASE_URL` | the **pooled** one — its host contains `-pooler` | Runtime queries. Serverless opens a connection per invocation; the pooler is what keeps that survivable. |
| `DIRECT_URL` | the **direct** one — no `-pooler` | `prisma migrate deploy`. Migrations run DDL and advisory locks, which a transaction pooler cannot carry. |

> **If the build fails with `P1012 … You must provide a nonempty direct URL`**, no direct
> connection string is reaching the build. Hosts name it inconsistently — the Neon-Vercel
> integration provisions it as `DATABASE_URL_UNPOOLED`, other setups as
> `POSTGRES_URL_NON_POOLING` — so `scripts/vercel-build.sh` tries `DIRECT_URL`, then those
> two, then `DATABASE_URL`, and stops with an explicit message naming what to set if all
> four are empty. Prisma validates BOTH urls whenever it reads the schema, including during
> `generate`, which is why an empty one fails before anything else runs.
>
> Setting `DIRECT_URL` yourself is still the right fix: falling back to `DATABASE_URL` means
> migrations run through the pooler, which can fail on advisory locks (the script warns when
> it detects a `-pooler` host).
>
> Check the variable is enabled for the environment you are deploying. A value saved only
> for Production does not exist in a Preview build, which fails exactly the same way.

Append `?sslmode=require` to both if Neon has not already.

## 2. Proof storage — Vercel Blob

In the Vercel dashboard: **Storage → Create → Blob**, then connect the store to this
project. That sets `BLOB_READ_WRITE_TOKEN` automatically. Set `STORAGE_PROVIDER=blob`.

**What this changes about proof security.** Vercel Blob has no private-object mode: every
object has a public URL. That URL is unguessable — a random store host plus a system-
generated UUID key — and the application never hands it to a browser. Proofs are still
streamed through `/api/proofs` behind the short-lived signed token and the same role and
record-ownership checks as before (FR-SEC-20..26), and the blob URL never leaves
`src/server/storage/index.ts`. But it is a genuine softening of "no direct public link":
anyone holding that URL could open it without a session. If that is not acceptable, use a
private S3/R2 bucket instead — `S3StorageProvider` in the same file is the place to
implement it, and nothing else in the app has to change.

## 3. Environment variables

Set these in **Project → Settings → Environment Variables** (Production, and Preview if
you use preview deployments). `.env.example` documents every one of them.

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string |
| `DIRECT_URL` | Neon **direct** connection string |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `PROOF_SIGNING_SECRET` | `openssl rand -base64 32` (a different one) |
| `APP_URL` | `https://<your-project>.vercel.app`, or your custom domain |
| `STORAGE_PROVIDER` | `blob` |
| `BLOB_READ_WRITE_TOKEN` | set for you when you connect the Blob store |
| `CRON_SECRET` | `openssl rand -base64 32` — Vercel Cron sends it as a bearer token |
| `OCR_PROVIDER` | `vision` with an `OCR_API_KEY`, or `mock`. **Not `local`** — see below |
| `OCR_API_KEY` | Google Cloud Vision key, if `OCR_PROVIDER=vision` |
| `EMAIL_PROVIDER` / `EMAIL_API_KEY` / `EMAIL_FROM` | your mail provider; `console` sends nothing |
| `SESSION_TIMEOUT_MINUTES` / `SUPERADMIN_SESSION_TIMEOUT_MINUTES` | `30` / `15` |

**Google Sheets mirror** (optional — see `GOOGLE_SHEETS_MIRROR.md`). Vercel has no
`.secrets/` directory, so the file-based credential path does not exist there. Leave
`SHEETS_CREDENTIALS_FILE` **unset** and use the inline pair instead:

| Var | Value |
|---|---|
| `SHEETS_PROVIDER` | `google` |
| `SHEETS_SPREADSHEET_ID` | the id from the spreadsheet URL |
| `SHEETS_TAB_NAME` | `Leads` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `…@…iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | the PEM from the service-account JSON, newlines written as literal `\n` |

**Why not `OCR_PROVIDER=local`.** On-device OCR downloads a ~11 MB Tesseract language
model to the working directory on first use and runs it in a worker thread. The working
directory is read-only on Vercel and the model would be re-fetched on every cold start
even if it were not. Use `vision` (cloud) or `mock` (no extraction; salespeople type the
figures, which the app already supports as the fallback path).

## 4. Deploy

Import the GitHub repository at <https://vercel.com/new>. Vercel detects Next.js and pnpm
from the lockfile. `vercel.json` in the repo root supplies the rest:

- **Build command** — `scripts/vercel-build.sh`, which resolves the direct database URL
  (see above), generates the Prisma Client, applies pending migrations and builds.
  `prisma generate` is explicit because Vercel restores `node_modules` from cache without
  re-running install scripts, so the generated client would otherwise go stale.
  `prisma migrate deploy` applies pending migrations against `DIRECT_URL` on every deploy.
- **Cron** — a daily `GET /api/jobs/tick` at `03:30 UTC` (`09:00 IST`), which runs the
  reminder/ageing automation. The route accepts the Vercel Cron bearer token, an
  `x-cron-secret` header for any other scheduler, or a Super Admin session for the
  "run now" button. It is idempotent per IST day, so an extra call sends nothing twice.
  Vercel's Hobby plan permits daily crons only; this one is daily.

## 5. Seed the first users

The database starts empty and there is no self-signup — user creation is Super Admin only,
so someone has to exist first. Run the seed **from your machine against the Neon direct
URL**, once:

```bash
SEED_TEMP_PASSWORD='ProITbridge@2026' \
DIRECT_URL="<neon-direct-url>" DATABASE_URL="<neon-direct-url>" pnpm db:seed
```

This creates the eight team accounts, all sharing that one temporary password — the simplest
thing to roll out, because there is a single value to tell everybody. **Users sign in with
their full email address as the username**, in any capitalisation.

Drop `SEED_TEMP_PASSWORD` and the seed instead generates a **different random password per
account** and prints them. That is the safer option — one leaked password does not expose the
other seven — at the cost of distributing eight separate values.

Whichever you pick, the value must satisfy the password policy (8+ characters, an uppercase
letter, a number and a symbol). The seed refuses to run rather than create an account whose
temporary password would be rejected the moment the user tried to replace it.

Either way the passwords are printed to your terminal. That printout is the only place those passwords ever exist — they are not written
to a file and not stored anywhere but as a hash in the database. Capture it, give each person
their own line over a channel you trust, and do not forward the whole block to everyone.

Every account is created with `must_change_password = true`, so each password is good for
exactly one sign-in before the app forces a replacement.

Re-running the seed is safe: an account that already exists is left completely alone, and no
password is reprinted or reset. To reset one afterwards, use Super Admin → User Management.

## 6. After the first deploy — check these four

1. `GET /api/health` returns ok.
2. Sign in as the Super Admin and change the seeded password.
3. Upload a payment proof on a test lead, then reopen it. If it renders, Blob storage is
   wired correctly — this is the single most likely thing to be wrong.
4. **Deployment Protection.** Vercel puts preview deployments behind an SSO wall but
   leaves production open to the internet. This app holds learner PII and payment records
   and has no IP allowlist of its own, so decide deliberately: either add a custom domain
   with your own access control in front, or turn on Vercel Authentication for production
   too (Settings → Deployment Protection).

## 7. What Vercel does not solve

Carried over from `GO_LIVE_READINESS.md` — hosting choice does not close any of these:
an independent penetration test, an executed restore drill (now covering **Neon backups
plus the Blob store**, which `scripts/restore-test.sh` does not yet know about), load
testing at target volume, and infrastructure encryption evidence.
