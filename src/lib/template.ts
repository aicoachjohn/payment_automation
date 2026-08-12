/**
 * Dependency-free template renderer (safe in client and server). Substitutes
 * {{dotted.key}} from a flat string map; unknown keys render empty; `{`/`}` are stripped
 * from values so a value can never inject another placeholder (FR-SAL-33).
 */
export function renderTemplate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = ctx[key];
    if (value == null) return "";
    return value.replace(/[{}]/g, "");
  });
}
