# ProITbridge — Payment & Enrollment Automation Platform

Internal web application for a three-stage payment workflow:

> **Sales** captures leads & payments → **Data Management (Nandhiya)** verifies each
> payment against its proof (Level-1 audit) → **Finance (Rajesh)** reviews approved
> payments, read-only. One **Super Admin** sits above all three with controlled
> override authority.

**Read [`CLAUDE.md`](./CLAUDE.md) first** — it is the project constitution (the ten
inviolable rules, the RBAC matrix, the money rule, coding conventions). The full spec
is [`docs/FRD_v1.2.pdf`](./docs/FRD_v1.2.pdf); phase-by-phase build prompts are in
[`docs/ProITbridge_ClaudeCode_Build_Prompt_Pack.md`](./docs/ProITbridge_ClaudeCode_Build_Prompt_Pack.md).

## Stack

Next.js 15 (App Router, TypeScript strict) · PostgreSQL 16 + Prisma · Tailwind CSS +
shadcn/ui · TanStack Table · Zod · next-safe-action · Vitest · Playwright · pnpm ·
Docker Compose (Postgres + MinIO).

## Getting started

```bash
cp .env.example .env      # then fill in real values (see FR-SEC-12 — never commit .env)
pnpm install
pnpm db:up                # start Postgres + MinIO via Docker  (requires Docker)
pnpm dev                  # http://localhost:3000
```

Prisma schema, migrations and seed data arrive in **Phase 1** (`pnpm db:migrate`,
`pnpm db:seed`).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (`eslint-config-next`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest unit tests |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm db:up` / `pnpm db:down` | Start / stop Docker Postgres + MinIO |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio` | Prisma (Phase 1+) |

## Build phases

This repo is built in 13 phases (0–12). See the **Phase status** checklist at the
bottom of [`CLAUDE.md`](./CLAUDE.md) and the mapping in
[`docs/REQUIREMENTS_INDEX.md`](./docs/REQUIREMENTS_INDEX.md).

## Repository layout

```
src/app/            role-grouped routes: (auth) (sales) (datamgmt) (finance) (superadmin) + api
src/server/         db · services · auth · audit · money · storage · ocr · notifications · jobs
src/components/     ui (shadcn) · shared
src/lib/            zod schemas, constants, formatters
tests/              unit (Vitest) · e2e (Playwright)
prisma/             schema, migrations, seed (Phase 1+)
docs/               FRD, build prompt pack, requirements index
```
