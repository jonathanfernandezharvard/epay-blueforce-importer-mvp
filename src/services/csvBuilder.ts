import fs from "fs";
import path from "path";

export function sanitizeForFilename(input: string): string {
  // allow alphanum, hyphen, underscore, dot; replace others with underscore
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").substring(0, 80);
}

export interface CsvResult {
  path: string;
  rows: number;
}

export async function buildCsv(
  dir: string,
  payrollId: string,
  jobs: string[]
): Promise<CsvResult> {
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts =
    stamp.getUTCFullYear().toString() +
    pad(stamp.getUTCMonth() + 1) +
    pad(stamp.getUTCDate()) +
    "_" +
    pad(stamp.getUTCHours()) +
    pad(stamp.getUTCMinutes()) +
    pad(stamp.getUTCSeconds()) +
    String(stamp.getUTCMilliseconds()).padStart(3, "0");

  const filename = `SiteEmployeeDefaults_${ts}_${sanitizeForFilename(payrollId)}.csv`;
  const fullPath = path.join(dir, filename);

  const stream = fs.createWriteStream(fullPath, { encoding: "utf8" });
  // Match DECConfig template header exactly so the portal accepts the file.
  const header = "Payroll ID,SITECODE,Default Task,Default Shift,IsActive  [Y/N] (Optional)\n";
  stream.write(header);
  const defaultActive = process.env.IMPORT_DEFAULT_ACTIVE ?? "";
  const defaultTask = process.env.IMPORT_DEFAULT_TASK ?? "";
  const defaultShift = process.env.IMPORT_DEFAULT_SHIFT ?? "";
  for (const site of jobs) {
    const row = [
      payrollId,
      site,
      defaultTask,
      defaultShift,
      defaultActive,
    ].join(",");
    stream.write(`${row}\n`);
  }
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on("error", reject);
  });

  return { path: fullPath, rows: jobs.length };
}
