import { describe, it, expect } from "vitest";
import { EpayImporter } from "../src/services/epayImporter";

// This test runs only if explicitly enabled because it needs real credentials.
const run = process.env.RUN_EPAY_SMOKE === "true";

(run ? describe : describe.skip)("Playwright smoke", () => {
  it("can attempt a login/import flow", async () => {
    const importer = new EpayImporter();
    const result = await importer.importCsv(__filename);
    expect(typeof result.ok).toBe("boolean");
  });
});
