import fs from "fs";
import path from "path";
import { chromium, Browser, Page, BrowserContext, Locator } from "playwright";
import { logger } from "./logger";

function env(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export type ImportRowStatus = "Added" | "Updated" | "Error";

export interface ImportRowResult {
  siteCode: string;
  status: ImportRowStatus;
  message?: string;
  success: boolean;
}

export interface ImportResult {
  ok: boolean;
  message: string;
  screenshotPath?: string;
  rows?: ImportRowResult[];
}

export class EpayImporter {
  private EPAY_URL = env("EPAY_URL", "https://tlm.epaysystems.com/Login/Login.aspx?ReturnUrl=%2flogin");
  private CORP_ID = env("EPAY_CORP_ID", "");
  private LOGIN_ID = env("EPAY_LOGIN_ID", "");
  private PASSWORD = env("EPAY_PASSWORD", "");
  private TEMPLATE = env("IMPORT_TEMPLATE", "Site Employee Defaults");
  private IMPORTS_URL = env(
    "EPAY_IMPORTS_URL",
    "https://tlm.epaysystems.com/DECConfig/V7.3.1.3/frmDECImports.aspx"
  );
  private IMPORTS_WEB_URL = env(
    "EPAY_IMPORTS_WEB_URL",
    "https://tlm.epaysystems.com/DECConfig/V7.3.1.3/frmDECImportFromWeb.aspx"
  );
  private STORAGE_STATE = env("STORAGE_STATE_PATH", "/data/state/storageState.json");
  private SCREENSHOTS_DIR = env("SCREENSHOTS_DIR", "/data/screenshots");
  private HEADLESS = (process.env.PLAYWRIGHT_HEADLESS ?? "true") === "true";

  private async ensureDirs() {
    await fs.promises.mkdir(path.dirname(this.STORAGE_STATE), { recursive: true });
    await fs.promises.mkdir(this.SCREENSHOTS_DIR, { recursive: true });
  }

  private async fillFirstVisible(
    locators: Locator[],
    value: string,
    timeout = 15000
  ): Promise<void> {
    for (const locator of locators) {
      const count = await locator.count();
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        const visible = await candidate.isVisible().catch(() => false);
        if (visible) {
          await candidate.fill(value, { timeout });
          return;
        }
      }
    }
    throw new Error("Unable to locate visible field to fill");
  }

  private async launch(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    await this.ensureDirs();
    const storageExists = fs.existsSync(this.STORAGE_STATE);
    const browser = await chromium.launch({ headless: this.HEADLESS });
    const context = await browser.newContext(
      storageExists ? { storageState: this.STORAGE_STATE } : {}
    );
    const page = await context.newPage();
    return { browser, context, page };
  }

  private async loginIfNeeded(page: Page): Promise<void> {
    const loginUrl = "https://tlm.epaysystems.com/DECConfig/V7.3.1.3/Login.aspx?ReturnUrl=%2fDECConfig%2fV7.3.1.3%2ffrmDECImports.aspx";
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

    const corpInput = page.locator("#txtCorpID");
    const needsLogin = await corpInput.isVisible().catch(() => false);

    if (needsLogin) {
      logger.info({ step: "login", where: "DECConfig" }, "Logging into DECConfig imports portal");
      await corpInput.fill(this.CORP_ID, { timeout: 20000 });
      await page.locator("#txtLoginID").fill(this.LOGIN_ID, { timeout: 15000 });
      await page.locator("#txtPassword").fill(this.PASSWORD, { timeout: 15000 });
      await page.locator("#txtPassword").press("Enter");
      await page.waitForLoadState("networkidle");
    }

    if (!page.url().toLowerCase().includes("frmdecimports")) {
      await page.goto(this.IMPORTS_URL, { waitUntil: "domcontentloaded" });
    }

    await page.context().storageState({ path: this.STORAGE_STATE });
    logger.info({ step: "login", savedState: this.STORAGE_STATE }, "Saved storage state");
  }

  private async performImport(page: Page, csvPath: string): Promise<ImportRowResult[]> {
    const targetPayrollId = path.basename(csvPath).replace(/\.csv$/i, "").split("_").pop() ?? "";
    logger.info({ step: "navigate", action: "direct-imports" }, "Opening Imports module directly");
    await page.goto(this.IMPORTS_URL, { waitUntil: "domcontentloaded" });
    // Some installations open an integration control panel login; handle it.
    const icpLoginVisible = await page
      .locator('text="Integration Control Panel Login"')
      .isVisible()
      .catch(() => false);
    if (icpLoginVisible) {
      logger.info({ step: "login", where: "ICP" }, "Detected Integration Control Panel login, authenticating again");
      const scopes = [page, ...page.frames()];
      const loginScope =
        (
          await Promise.all(
            scopes.map(async (scope) => ({
              scope,
              visible: await scope
                .locator('text="Integration Control Panel Login"')
                .isVisible()
                .catch(() => false),
            }))
          )
        ).find((entry) => entry.visible)?.scope ?? page;

      await this.fillFirstVisible(
        [
          loginScope.getByLabel(/company/i),
          loginScope.locator('input[name="CorpID"]'),
          loginScope.locator('input[id*="Corp"]'),
          loginScope.locator('input[name="Company"]'),
          loginScope.locator('input[id*="Company"]'),
          loginScope.locator('input[placeholder*="Company"]'),
          loginScope.locator('input[placeholder*="Corp"]'),
          loginScope.locator('form input[type="text"]').first(),
        ],
        this.CORP_ID,
        20000
      );
      await this.fillFirstVisible(
        [
          loginScope.getByLabel(/login id/i),
          loginScope.getByLabel(/login/i),
          loginScope.locator('input[name="LoginID"]'),
          loginScope.locator('input[id*="Login"]'),
          loginScope.locator('input[name*="User"]'),
          loginScope.locator('input[placeholder*="Login"]'),
          loginScope.locator('form input[type="text"]').nth(1),
        ],
        this.LOGIN_ID,
        15000
      );
      await this.fillFirstVisible(
        [
          loginScope.getByLabel(/password/i),
          loginScope.locator('input[type="password"]'),
        ],
        this.PASSWORD,
        15000
      );
      await loginScope.getByRole("button", { name: /login/i }).click({ timeout: 15000 });
      await loginScope.waitForLoadState?.("networkidle").catch(() => {});
      await page.waitForLoadState("networkidle");
    }

    logger.info({ step: "navigate", action: "imports-from-web" }, "Opening Imports From Web page");
    await page.goto(this.IMPORTS_WEB_URL, { waitUntil: "domcontentloaded" });

    logger.info({ step: "select", template: this.TEMPLATE }, "Selecting import template");
    const desired = this.TEMPLATE;
    let selected = false;
    const comboTextbox = page.getByRole("textbox", { name: /--Select An Import--/i });
    if (await comboTextbox.isVisible().catch(() => false)) {
      await comboTextbox.click({ timeout: 15000 });
      const option = page.getByRole("option", { name: new RegExp(`^${desired}$`, "i") });
      await option.click({ timeout: 15000 });
      selected = true;
    } else {
      const selectEl = page.locator("select");
      if (await selectEl.isVisible().catch(() => false)) {
        const ok = await selectEl.selectOption({ label: desired }).catch(async () => {
          const options = await selectEl.locator("option").allTextContents().catch(() => []);
          const match = options.find((o) => o.trim().toLowerCase() === desired.toLowerCase());
          if (match) {
            return selectEl.selectOption({ label: match });
          }
          return Promise.reject(new Error("template not found"));
        });
        selected = Boolean(ok);
      }
    }

    if (!selected) {
      throw new Error(`Failed to select template ${desired}`);
    }

    logger.info({ step: "upload", csvPath }, "Uploading CSV");
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible().catch(() => false)) {
      await fileInput.setInputFiles(csvPath);
    } else {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.getByRole("button", { name: /browse/i }).or(page.locator('button:has-text("Browse")')).click(),
      ]);
      await chooser.setFiles(csvPath);
    }

    const uploadBtn = page.getByRole("button", { name: /upload/i }).or(page.locator('button:has-text("Upload")'));
    await uploadBtn.click();

    await page.waitForTimeout(1000);
    await page.waitForLoadState("networkidle").catch(() => {});

    const rowsHandle = await page.waitForFunction((payrollId: string) => {
      const table = document.querySelector("table");
      if (!table) return null;
      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      if (bodyRows.length === 0) return [];
      const parsed = bodyRows
        .map((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length === 0) return null;
          const employeeId = cells[0]?.textContent?.trim() ?? "";
          if (payrollId && employeeId && employeeId !== payrollId) {
            return null;
          }
          const site = cells[1]?.textContent?.trim() ?? "";
          const rawReason = cells[cells.length - 1]?.textContent?.trim() ?? "";
          const normalized = rawReason.replace(/\s+/g, " ").trim();
          const isUpdate = /updated|already.*(have|has)|update/i.test(normalized);
          const isAdded = normalized.length === 0 || /successfully added|has been added|added to the site/i.test(normalized);
          let status: ImportRowStatus;
          if (isUpdate) {
            status = "Updated";
          } else if (isAdded) {
            status = "Added";
          } else {
            status = "Error";
          }
          const message =
            status === "Added" && normalized.length === 0
              ? "Employee added to the site."
              : normalized || undefined;
          return {
            siteCode: site,
            status,
            message,
            success: status !== "Error",
          };
        })
        .filter(Boolean);
      return parsed;
    }, targetPayrollId, { timeout: 60000 });
    const rows = (await rowsHandle.jsonValue()) as ImportRowResult[];

    if (!rows) {
      throw new Error("Timed out waiting for import results");
    }

    logger.info({ step: "done" }, "Import completed");
    return rows;
  }

  public async importCsv(csvPath: string): Promise<ImportResult> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      const launched = await this.launch();
      browser = launched.browser; context = launched.context; page = launched.page;
      await this.loginIfNeeded(page);

      try {
      const rows = await this.performImport(page, csvPath);
      const added = rows.filter((r) => r.status === "Added").length;
      const updated = rows.filter((r) => r.status === "Updated").length;
      const errors = rows.filter((r) => r.status === "Error").length;
      const parts = [];
      if (added > 0) parts.push(`Added ${added} row${added === 1 ? "" : "s"}`);
      if (updated > 0) parts.push(`Updated ${updated} row${updated === 1 ? "" : "s"}`);
      if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
      const message = parts.length > 0 ? parts.join(", ") + "." : "No changes detected.";
      await context.storageState({ path: this.STORAGE_STATE });
      return { ok: errors === 0, message, rows };
    } catch (err: any) {
      // If it failed, try one re-login attempt
      logger.warn({ err: String(err) }, "Import failed, attempting re-login and retry once");
      await context.close().catch(() => {});
      const relaunch = await this.launch();
      browser = relaunch.browser; context = relaunch.context; page = relaunch.page;

      await this.loginIfNeeded(page);
        const rows = await this.performImport(page, csvPath);
        const added = rows.filter((r) => r.status === "Added").length;
        const updated = rows.filter((r) => r.status === "Updated").length;
        const errors = rows.filter((r) => r.status === "Error").length;
        const parts = [];
        if (added > 0) parts.push(`Added ${added} row${added === 1 ? "" : "s"}`);
        if (updated > 0) parts.push(`Updated ${updated} row${updated === 1 ? "" : "s"}`);
        if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
        const message = parts.length > 0 ? parts.join(", ") + "." : "No changes detected.";
        await context.storageState({ path: this.STORAGE_STATE });
        return { ok: errors === 0, message, rows };
      }
    } catch (error: any) {
      const batchId = path.basename(csvPath).split("_").pop()?.replace(/\.csv$/i, "") ?? "unknown";
      const screenshotName = `${batchId}_${Date.now()}.png`;
      const screenshotPath = path.join(this.SCREENSHOTS_DIR, screenshotName);
      try {
        if (page) {
          await page.screenshot({ path: screenshotPath, fullPage: true });
        }
      } catch { /* ignore */ }

      logger.error({ err: String(error), screenshotPath }, "EPAY import failed");
      return { ok: false, message: String(error?.message || error), screenshotPath };
    } finally {
      try { await page?.close(); } catch {}
      try { await context?.close(); } catch {}
      try { await browser?.close(); } catch {}
    }
  }
  public async setupLogin(): Promise<{ ok: boolean; message: string }> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      const launched = await this.launch();
      browser = launched.browser; context = launched.context; page = launched.page;
      await this.loginIfNeeded(page);
      await context.storageState({ path: this.STORAGE_STATE });
      return { ok: true, message: "Logged in and storage state saved" };
    } catch (e: any) {
      logger.error({ err: String(e) }, "setupLogin failed");
      return { ok: false, message: String(e?.message || e) };
    } finally {
      try { await page?.close(); } catch {}
      try { await context?.close(); } catch {}
      try { await browser?.close(); } catch {}
    }
  }

}
