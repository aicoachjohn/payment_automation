/**
 * Normalise the database connection variables into the names the app expects.
 *
 * Prisma reads `DATABASE_URL` (runtime) and `DIRECT_URL` (migrations). Hosting platforms do
 * not reliably provide those names:
 *
 *   · Vercel storage integrations can be configured with a "Custom Environment Variable
 *     Prefix", which renames EVERY variable the store provides — `DATABASE_URL` arrives as
 *     `myprefix_DATABASE_URL` and Prisma finds nothing.
 *   · Neon calls the direct connection `DATABASE_URL_UNPOOLED`; other setups call it
 *     `POSTGRES_URL_NON_POOLING`. Neither is `DIRECT_URL`.
 *
 * So map them here, once, before any client is constructed. An explicitly set variable is
 * always left alone — this only fills in what is genuinely empty.
 *
 * Deliberately strict about ambiguity: if two different databases are attached, choosing
 * which one holds the payment records is not a decision this code should make silently.
 */

/** Candidate names for each target, in priority order. Anchored so `_UNPOOLED` never matches. */
const PATTERNS: Record<string, RegExp[]> = {
  DATABASE_URL: [/(^|_)DATABASE_URL$/, /(^|_)POSTGRES_URL$/],
  DIRECT_URL: [/(^|_)DATABASE_URL_UNPOOLED$/, /(^|_)POSTGRES_URL_NON_POOLING$/],
};

function nonEmptyMatches(pattern: RegExp): { name: string; value: string }[] {
  return Object.entries(process.env)
    .filter(([name, value]) => pattern.test(name) && (value ?? "").trim() !== "")
    .map(([name, value]) => ({ name, value: (value as string).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fill `target` from the first pattern that yields exactly one distinct value.
 * Returns the variable name it took the value from, or null if it changed nothing.
 */
function fill(target: string): string | null {
  if ((process.env[target] ?? "").trim() !== "") return null;

  for (const pattern of PATTERNS[target]) {
    const matches = nonEmptyMatches(pattern).filter((m) => m.name !== target);
    if (matches.length === 0) continue;

    const distinct = new Set(matches.map((m) => m.value));
    if (distinct.size > 1) {
      // Names only — a connection string carries credentials and this may reach a log.
      throw new Error(
        `Cannot determine ${target}: several variables define different databases ` +
          `(${matches.map((m) => m.name).join(", ")}). Set ${target} explicitly.`,
      );
    }

    process.env[target] = matches[0].value;
    return matches[0].name;
  }
  return null;
}

let done = false;

/** Idempotent: safe to call from every entry point. */
export function normaliseDatabaseEnv(): void {
  if (done) return;
  done = true;

  for (const target of Object.keys(PATTERNS)) {
    const from = fill(target);
    // One line, name only, so a deployment that relies on the mapping says so out loud
    // rather than working by accident.
    if (from) console.log(`[db] ${target} taken from ${from}`);
  }
}
