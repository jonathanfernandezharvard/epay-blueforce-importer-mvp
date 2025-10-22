import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildCsv } from "../src/services/csvBuilder";

describe("CSV builder", () => {
  it("writes exact header and UTF-8 without BOM", async () => {
    const dir = path.join("/mnt/data", "tmp_csv_tests");
    await fs.promises.mkdir(dir, { recursive: true });
    const res = await buildCsv(dir, "P123", ["J1", "J2", "J3"]);
    const buf = await fs.promises.readFile(res.path);
    // Check BOM absent
    const bom = buf.slice(0, 3);
    expect(bom[0]).not.toBe(0xef);
    expect(bom[1]).not.toBe(0xbb);
    expect(bom[2]).not.toBe(0xbf);
    const text = buf.toString("utf8");
    const lines = text.trim().split(/\n/);
    expect(lines[0]).toBe("Payroll ID,SITECODE");
    expect(lines).toHaveLength(1 + 3);
  });
});
