# Google Sheets mirror — setup

Every lead is written to a shared Google Sheet, one row each, so Sales, Data Management,
Finance and the Super Admin can read the book of business in a spreadsheet.

**The sheet is a one-way mirror, not the database.** Postgres remains the system of record.
That is what keeps the globally-unique Transaction ID, exact Decimal money, the append-only
audit trail and per-request RBAC — none of which a spreadsheet can enforce. Nothing is ever
read back from the sheet, so edits made there are overwritten on the next sync.

Switched **off** by default (`SHEETS_PROVIDER` unset), so a machine without credentials
behaves normally and tests never call out to Google.

---

## 1. Create the spreadsheet

Create a Google Sheet and note its id from the URL:

```
https://docs.google.com/spreadsheets/d/<THIS-PART-IS-THE-ID>/edit
```

Name the first tab `Leads` (or set `SHEETS_TAB_NAME`). Leave it empty — the header row is
written automatically on the first sync.

## 2. Create a service account

A service account lets the server write on its own behalf. Nobody signs in with a personal
Google account, and no one's password is involved.

1. <https://console.cloud.google.com> → create (or pick) a project.
2. **APIs & Services → Library → Google Sheets API → Enable.**
3. **APIs & Services → Credentials → Create credentials → Service account.** Give it a name
   like `proitbridge-sheets`. No roles are needed.
4. Open the service account → **Keys → Add key → Create new key → JSON.** A file downloads.
5. From that file you need two values: `client_email` and `private_key`.

## 3. Share the sheet

- Share the spreadsheet with the service account's `client_email` as **Editor**. Without
  this the API returns 403 — the account can authenticate but cannot see your file.
- Share it **read-only**, person by person, with Nandhiya, Rajesh and the Super Admin.

> Share with named people, never "anyone with the link". These rows carry learner names,
> addresses, phone numbers and email addresses.

## 4. Configure the server

Add to `.env` (never commit it — keys come only from the environment, FR-SEC-12):

```bash
SHEETS_PROVIDER=google
SHEETS_SPREADSHEET_ID=<the id from step 1>
SHEETS_TAB_NAME=Leads
GOOGLE_SERVICE_ACCOUNT_EMAIL=proitbridge-sheets@<project>.iam.gserviceaccount.com
# The whole private_key from the JSON, on ONE line, newlines written as \n
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

## 5. Backfill and run

`enqueueFullBackfill()` queues every live lead; the next sync writes them all. After that the
mirror keeps itself in step — the daily automation job drains the queue, and the Super Admin
console's job runner reports how many rows were synced.

---

## How it behaves

- **A save never waits on Google.** Changing a lead writes a row to `sheet_sync_outbox` in
  the *same database transaction*; the sheet is written later, out of band. If Google is slow
  or down, the queue simply grows.
- **An outage retries.** A failed drain leaves rows `PENDING`, increments `attempts` and
  records `lastError`. The next run picks them up.
- **Repeated edits cost one write.** The drain coalesces by lead: a lead touched ten times is
  written once, from its current state.
- **Re-runs never duplicate.** Rows are matched on the lead id in column A and overwritten in
  place; only genuinely new leads are appended.

## Columns

`Lead ID · Created · Salesperson · Learner Name · Mobile · Email · Date of Birth · Address ·
District · State · Pincode · Program · Plan · Combo Mode · Commencing Date · Final Fee ·
Total Approved · Balance · Payments · Lead Status · Approval Status · Last Synced`

Money is written as a plain decimal (`34999.00`) so Sheets stores a real number that sums
correctly — never a `₹`-formatted string, which would land as text. Mobiles are written with
a leading apostrophe so `+91…` stays text instead of being read as a formula.

## Limits worth knowing

- A spreadsheet caps at ~10 million cells. At 22 columns that is a few hundred thousand
  leads — far beyond this workload, but it is a ceiling, not a warning.
- The Sheets API allows roughly 60 write requests per minute per user. The drain batches, so
  a whole run is normally two requests regardless of how many leads changed.
- Learner personal data leaves the database for Google Drive. That matters for the FRD's
  retention and privacy rules; keep the sharing list short and reviewed.
