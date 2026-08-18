import { test, expect, type Page } from "@playwright/test";
import { Role } from "@prisma/client";
import { prisma, ensureUser, cleanupUser, type E2EUser } from "./helpers/db";

/**
 * NFR-10 — every list and form view must be usable on a phone browser.
 *
 * This suite is the objective proof behind that requirement: it drives a real 390 x 844
 * viewport (iPhone 12/13/14 CSS pixels — the narrowest mainstream phone we support) and,
 * on every route each role can reach, asserts that
 *
 *   1. the page does not scroll horizontally — the classic mobile failure, where a wide
 *      table or a long unbroken string pushes the whole document sideways; and
 *   2. primary controls (buttons, links, inputs) meet a 40 px minimum touch height,
 *      close to the 44 px Apple HIG / WCAG 2.5.5 target once padding is counted.
 *
 * Wide data tables are legitimately wider than a phone — the rule is that they scroll
 * *inside their own container*, never taking the page with them. `pageScrollsSideways`
 * measures exactly that distinction.
 */

const PHONE = { width: 390, height: 844 };

const MOBILE_USERS = {
  sales: {
    email: "e2e.mobile.sales@proitbridge.local",
    password: "Test#Mobile1",
    role: Role.SALESPERSON,
    twoFa: false,
  },
  manager: {
    email: "e2e.mobile.manager@proitbridge.local",
    password: "Test#Mobile2",
    role: Role.SALES_MANAGER,
    twoFa: false,
  },
  datamgmt: {
    email: "e2e.mobile.datamgmt@proitbridge.local",
    password: "Test#Mobile3",
    role: Role.DATA_MGMT_AUDITOR,
    twoFa: false,
  },
  finance: {
    email: "e2e.mobile.finance@proitbridge.local",
    password: "Test#Mobile4",
    role: Role.FINANCE_REVIEWER,
    twoFa: false,
  },
  admin: {
    email: "e2e.mobile.admin@proitbridge.local",
    password: "Test#Mobile5",
    role: Role.SUPER_ADMIN,
    twoFa: false,
  },
} satisfies Record<string, E2EUser>;

/** Every static route each role can reach. Parameterised routes are covered separately. */
const ROUTES: Record<keyof typeof MOBILE_USERS, string[]> = {
  sales: ["/sales", "/leads/new", "/leads/intake", "/handover", "/notifications"],
  manager: ["/sales", "/handover", "/notifications"],
  datamgmt: ["/audit", "/notifications"],
  finance: [
    "/finance",
    "/finance/collections",
    "/finance/customers",
    "/finance/oversight",
    "/finance/queries",
    "/finance/trace",
  ],
  admin: [
    "/admin",
    "/admin/activity",
    "/admin/audit",
    "/admin/jobs",
    "/admin/overrides",
    "/admin/pricing",
    "/admin/reconciliation",
    "/admin/records",
    "/admin/settings",
    "/admin/templates",
    "/admin/users",
  ],
};

interface Probe {
  pageScrollsSideways: boolean;
  documentWidth: number;
  viewport: number;
  /** Elements sticking out of the viewport that are NOT inside a scrollable container. */
  overflowing: { tag: string; cls: string; right: number; text: string }[];
  /** Interactive controls below the 40 px touch-height floor. */
  smallTargets: { tag: string; label: string; w: number; h: number }[];
}

/**
 * Measure the page in the browser. An element only counts as an overflow defect when no
 * ancestor scrolls horizontally: a cell inside `overflow-x:auto` is doing the right thing.
 */
async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const viewport = de.clientWidth;

    const inScrollable = (el: Element): boolean => {
      let p = el.parentElement;
      while (p) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
        p = p.parentElement;
      }
      return false;
    };

    const visible = (el: Element): boolean => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      // Decorative blobs never affect usability.
      return s.pointerEvents !== "none";
    };

    const overflowing: Probe["overflowing"] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > viewport + 1 && !inScrollable(el)) {
        overflowing.push({
          tag: el.tagName.toLowerCase(),
          cls: String((el as HTMLElement).className || "").slice(0, 80),
          right: Math.round(r.right),
          text: (el.textContent || "").trim().slice(0, 40),
        });
      }
    }

    const TOUCH = 44; // Apple HIG / WCAG 2.5.5 target size.
    const BOX = 20; // Checkboxes and radios scale rather than stretch.

    const smallTargets: Probe["smallTargets"] = [];
    const controls = document.querySelectorAll(
      "button, a[href], input:not([type=hidden]), select, textarea, [role=button]",
    );
    for (const el of Array.from(controls)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      // Links inside a paragraph are inline text, not touch targets.
      if (el.tagName === "A" && getComputedStyle(el).display === "inline") continue;

      const type = (el as HTMLInputElement).type;
      const isBox = el.tagName === "INPUT" && (type === "checkbox" || type === "radio");
      // An image link (the logo) is a large target even when it is short.
      const isImageLink = el.tagName === "A" && !!el.querySelector("img");

      const tooSmall = isBox
        ? r.height < BOX || r.width < BOX
        : isImageLink
          ? r.width * r.height < TOUCH * TOUCH
          : r.height < TOUCH;

      if (tooSmall) {
        smallTargets.push({
          tag: el.tagName.toLowerCase(),
          label: (el.textContent || (el as HTMLInputElement).name || "").trim().slice(0, 30),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }

    return {
      pageScrollsSideways: de.scrollWidth > viewport + 1,
      documentWidth: de.scrollWidth,
      viewport,
      overflowing: overflowing.slice(0, 10),
      smallTargets: smallTargets.slice(0, 10),
    };
  });
}

async function login(page: Page, u: E2EUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password").fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // 2FA may be required by SystemConfig regardless of the user flag; the dev-only fixed
  // OTP (playwright.config.ts) makes that step deterministic.
  await page.waitForURL(/\/login\/otp|\/sales|\/audit|\/finance|\/admin/, { timeout: 15_000 });
  if (new URL(page.url()).pathname === "/login/otp") {
    await page.getByLabel("6-digit code").fill(process.env.E2E_FIXED_OTP ?? "000000");
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}

test.use({ viewport: PHONE });

test.beforeAll(async () => {
  for (const u of Object.values(MOBILE_USERS)) await ensureUser(u);
});

test.afterAll(async () => {
  for (const u of Object.values(MOBILE_USERS)) await cleanupUser(u.email);
  await prisma.$disconnect();
});

test("public pages fit a 390px phone", async ({ page }) => {
  for (const route of ["/login", "/forgot-password"]) {
    await page.goto(route);
    const r = await probe(page);
    expect(r.pageScrollsSideways, `${route} scrolls sideways (${r.documentWidth}px > ${r.viewport}px)`).toBe(false);
    expect(r.overflowing, `${route} has elements outside the viewport`).toEqual([]);
  }
});

for (const [key, user] of Object.entries(MOBILE_USERS) as [keyof typeof MOBILE_USERS, E2EUser][]) {
  test(`${user.role} routes fit a 390px phone`, async ({ page }) => {
    await login(page, user);

    for (const route of ROUTES[key]) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      const r = await probe(page);

      if (r.pageScrollsSideways || r.overflowing.length || r.smallTargets.length) {
        console.log(
          `\n[${route}] width=${r.documentWidth}/${r.viewport} sideways=${r.pageScrollsSideways}` +
            `\n  overflow: ${JSON.stringify(r.overflowing)}` +
            `\n  small(${r.smallTargets.length}): ${JSON.stringify(r.smallTargets)}`,
        );
      }

      // Soft so a single bad route does not mask the rest of the sweep.
      expect
        .soft(
          r.pageScrollsSideways,
          `${route} scrolls sideways (${r.documentWidth}px > ${r.viewport}px). ` +
            `Widest offenders: ${JSON.stringify(r.overflowing)}`,
        )
        .toBe(false);

      expect
        .soft(
          r.overflowing,
          `${route} renders content outside the viewport that is not in a scrollable container`,
        )
        .toEqual([]);

      expect
        .soft(r.smallTargets, `${route} has touch targets below the 44px minimum`)
        .toEqual([]);
    }
  });
}
