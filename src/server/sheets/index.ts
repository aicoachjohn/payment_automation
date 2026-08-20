/**
 * Google Sheets mirror (business decision — see CLAUDE.md).
 *
 * Every lead is also written to a shared Google Sheet so Sales, Data Management, Finance and
 * the Super Admin can read the book of business in a spreadsheet. The sheet is a ONE-WAY
 * mirror for visibility: Postgres remains the system of record, which is what keeps the
 * globally-unique Transaction ID, exact Decimal money, the append-only audit trail and
 * per-request RBAC. Nothing is ever read back from the sheet.
 *
 * Selected by SHEETS_PROVIDER, the same adapter shape as storage / OCR / notifications:
 *   · `noop` (default) — does nothing, so dev and tests never call out to Google
 *   · `google`         — the real Sheets API
 *
 * Credentials come ONLY from env (FR-SEC-12), exactly like the SendGrid key: a service
 * account, so nobody signs in with a personal Google account. Share the spreadsheet with the
 * service-account email as an Editor, and share it read-only with the people who need to
 * read it — never "anyone with the link", because these rows carry learner PII.
 */
import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { SHEET_COLUMNS, columnLetter } from "@/server/sheets/rows";

export interface SheetsProvider {
  readonly name: string;
  /**
   * Upsert rows keyed by the lead id in column A: existing rows are overwritten in place,
   * new ones appended. Returns how many were written.
   */
  upsertLeadRows(rows: string[][]): Promise<number>;
}

/** Does nothing. The default, so a machine without credentials behaves normally. */
class NoopSheetsProvider implements SheetsProvider {
  readonly name = "noop";
  async upsertLeadRows(): Promise<number> {
    return 0;
  }
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The real Sheets API over `fetch` + node:crypto — no SDK, keeping the fixed stack. A service
 * account authenticates by signing a JWT and exchanging it for an access token.
 */
class GoogleSheetsProvider implements SheetsProvider {
  readonly name = "google";

  private token: { value: string; expiresAt: number } | null = null;

  /**
   * Credentials come from the service-account JSON file (preferred) or, failing that, from
   * inline env vars.
   *
   * The file is better: the key material stays in one file with its own permissions instead
   * of being pasted into a shell-sourced env file, and it is the format Google actually hands
   * you. Only the PATH goes in .env, which is not a secret. Read on each use rather than
   * cached, so rotating the key needs no redeploy.
   */
  private config() {
    const spreadsheetId = process.env.SHEETS_SPREADSHEET_ID;
    const sheetName = process.env.SHEETS_TAB_NAME ?? "Leads";
    if (!spreadsheetId) throw new Error("SHEETS_SPREADSHEET_ID is not set.");

    const file = process.env.SHEETS_CREDENTIALS_FILE ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (file) {
      let parsed: { client_email?: string; private_key?: string };
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        // Never echo the path's contents — only that it could not be used.
        throw new Error("The service-account key file could not be read. Check SHEETS_CREDENTIALS_FILE.");
      }
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error("The service-account key file is missing client_email or private_key.");
      }
      return { email: parsed.client_email, key: parsed.private_key, spreadsheetId, sheetName };
    }

    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    // Env vars cannot hold real newlines, so an inline PEM carries literal \n.
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!email || !key) {
      throw new Error(
        "The Google Sheets mirror has no credentials. Set SHEETS_CREDENTIALS_FILE to the service-account JSON.",
      );
    }
    return { email, key, spreadsheetId, sheetName };
  }

  /** Signed JWT → access token, cached until a minute before it expires. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const { email, key } = this.config();

    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64url(
      JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
    );
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const signature = base64url(signer.sign(key));

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${header}.${claim}.${signature}`,
      }),
    });
    if (!res.ok) throw new Error(`Google rejected the service-account sign-in (${res.status}).`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return body.access_token;
  }

  private async api(path: string, init: RequestInit): Promise<Response> {
    const token = await this.accessToken();
    const res = await fetch(`${SHEETS_API}/${this.config().spreadsheetId}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      // Google explains itself in the body; a bare status code sends people hunting. The two
      // that actually happen are "not shared with the service account" and "Sheets API not
      // enabled", and they are indistinguishable without this.
      const detail = await res.text().catch(() => "");
      const reason = (() => {
        try {
          return (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? "";
        } catch {
          return detail.slice(0, 200);
        }
      })();
      const hint =
        res.status === 403
          ? ` Share the spreadsheet with ${this.config().email} as an Editor, and make sure the Google Sheets API is enabled for the project.`
          : "";
      throw new Error(`Google Sheets refused the request (${res.status}).${reason ? ` ${reason}` : ""}${hint}`);
    }
    return res;
  }

  async upsertLeadRows(rows: string[][]): Promise<number> {
    if (rows.length === 0) return 0;
    const { sheetName } = this.config();
    const lastCol = columnLetter(SHEET_COLUMNS.length);

    // Column A holds the lead id. One read tells us which rows already exist, so a re-run
    // updates in place instead of appending a duplicate.
    const idsRes = await this.api(`/values/${encodeURIComponent(`${sheetName}!A:A`)}`, { method: "GET" });
    const existing = ((await idsRes.json()) as { values?: string[][] }).values ?? [];
    const rowByLeadId = new Map<string, number>();
    existing.forEach((cells, i) => {
      const id = cells[0];
      if (id) rowByLeadId.set(id, i + 1); // 1-based sheet rows
    });

    // Write the header if the sheet is empty, so a fresh spreadsheet is self-describing.
    const updates: { range: string; values: string[][] }[] = [];
    if (existing.length === 0) {
      updates.push({ range: `${sheetName}!A1:${lastCol}1`, values: [[...SHEET_COLUMNS]] });
    }

    const appends: string[][] = [];
    for (const row of rows) {
      const at = rowByLeadId.get(row[0]);
      if (at) updates.push({ range: `${sheetName}!A${at}:${lastCol}${at}`, values: [row] });
      else appends.push(row);
    }

    if (updates.length > 0) {
      await this.api(`/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: updates }),
      });
    }
    if (appends.length > 0) {
      await this.api(
        `/values/${encodeURIComponent(`${sheetName}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: JSON.stringify({ values: appends }) },
      );
    }
    return rows.length;
  }
}

let provider: SheetsProvider | null = null;

export function getSheetsProvider(): SheetsProvider {
  if (provider) return provider;
  provider = process.env.SHEETS_PROVIDER === "google" ? new GoogleSheetsProvider() : new NoopSheetsProvider();
  return provider;
}

/** Whether the mirror is switched on at all — used to skip queue work entirely. */
export function sheetsMirrorEnabled(): boolean {
  return process.env.SHEETS_PROVIDER === "google";
}
