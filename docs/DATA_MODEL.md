# Data Model (Phase 1)

The schema lives in [`prisma/schema.prisma`](../prisma/schema.prisma). The guiding
principle (FRD §10): **all three dashboards read from the same lead-and-payment
record — data is never copied between teams.**

## The four key relationships

```
User ──(salesperson)──< Lead ──1:1── Enrollment ──1:*── Payment ──1:*── PaymentProof
                                          │
                                          └──*:1── PricingMaster   (snapshot at fee-lock)
```

1. **Lead → Enrollment (1:1).** A lead that converts has exactly one enrollment
   (`Enrollment.lead_id` is `UNIQUE`). The enrollment carries the program, plan, combo
   mode, the locked fee components and the payment schedule.

2. **Enrollment → Payment (1:many).** Each enrollment collects its fee over one or more
   payments (Course Holding/Starting → Down Payment → Final Payment). `payment_number`
   is unique per enrollment (`@@unique([enrollment_id, payment_number])`), and
   `transaction_id` is **globally** unique (`UNIQUE` at the DB level — BR-06, FR-REC-01).

3. **Payment → PaymentProof (1:many, versioned).** A proof is never overwritten; a
   replaced proof during a correction cycle becomes a new `version`
   (`@@unique([payment_id, version])`). Every version stays viewable in history
   (FR-SEC-26).

4. **Enrollment → PricingMaster (many:1, at fee-lock).** When the fee is locked the
   enrollment records `pricing_id` — the exact effective-dated Pricing Master row used.
   A later Pricing Master change therefore can never retroactively move a locked lead's
   fee (FR-ADM-03, FR-SAL-23).

All four foreign keys use **`ON DELETE RESTRICT`** — nothing structural can be
hard-deleted out from under a child row (BR-26). Records are *voided* (with a reason),
never deleted (BR-21).

## Why balance is never stored

Balance is **always computed server-side** from the individual approved payment records
(BR-22, BR-28, FR-REC-06). There is deliberately **no `balance` column** on
`Enrollment`.

> **Balance = `final_approved_fee` − Σ (APPROVED, non-voided) `received_amount`.**
> Pending, correction-required, resubmitted and rejected payments never reduce it.

The single implementation is [`calculateBalance`](../src/server/money/index.ts), which
filters to `APPROVED && !voided` defensively so an unapproved amount can never leak into
a total. Storing a balance would let it drift out of sync with the audited records and
would be an editable financial figure — both forbidden. (Reconciliation in Phase 11
asserts `approved + balance == final_approved_fee`, BR-30.)

## Money, always Decimal

Every monetary column is `NUMERIC(12,2)` (`@db.Decimal(12,2)`) and every amount is a
`Prisma.Decimal` in code — never a JS `number`/float (BR-29, FR-REC-07). All arithmetic,
rounding (half-up, once, at the end — FR-REC-08) and INR formatting live in
[`src/server/money`](../src/server/money/index.ts) and nowhere else. Brochure prices are
GST-inclusive, so base/GST are derived by extraction.

CHECK constraints back this at the DB: `received_amount >= 0`, `expected_amount >= 0`,
and `final_approved_fee > 0` when present.

## Append-only audit & least-privilege access

- **`AuditTrail`** records one row per changed field (actor, role, entity, field,
  old/new value, timestamp, IP). **`SuperAdminActivity`** records every override.
- Both are **append-only**, enforced twice: a Prisma client extension blocks
  update/delete/upsert at runtime ([`src/server/db`](../src/server/db/index.ts)), and the
  migration `REVOKE`s `UPDATE, DELETE` on both tables from the app role at the database
  level (FR-AUD-02, FR-SEC-11).
- The application connects as a **least-privilege role** (`proitbridge_app`, via
  `DATABASE_URL`) that holds DML but no schema-alteration rights. Migrations run as the
  owner via `DIRECT_URL`. This is the FR-SEC-11 dedicated application account.

## Entity map

| Entity | Purpose |
|---|---|
| `User` | Individual accounts, five roles, lockout & 2FA fields (deactivated, never deleted). |
| `Lead` | Learner basic details, pipeline `status`, owned by a salesperson. |
| `Enrollment` | Program/plan/combo, locked fee components, payment schedule (1:1 with Lead). |
| `Payment` | An instalment: amounts, method, unique Txn ID, `audit_status` lifecycle. |
| `PaymentProof` | Versioned proof files (checksum, OCR raw output, scan status). |
| `PricingMaster` | Effective-dated brochure & combo pricing (referenced at fee-lock). |
| `PaymentDraft` | Versioned generated enrollment messages + field snapshot. |
| `AuditTrail` | Immutable field-level change log. |
| `SuperAdminActivity` | Immutable override log, read-only to Finance. |
| `Notification` | Email / in-app messages to users. |
| `FollowUpTask` | Sales follow-ups against a lead. |
| `OperationsHandover` | Consolidated handover record (manual / auto day-15). |
| `SystemConfig` | Configuration-driven business parameters (BR-13, NFR-16). |
| `SecurityEvent` | Login/logout/failed-login and other security events. |
