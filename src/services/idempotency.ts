import crypto from "crypto";

export function computeBatchHash(payrollId: string, jobs: string[]): string {
  const sorted = [...jobs].sort((a, b) => a.localeCompare(b));
  const payload = JSON.stringify({ payrollId, jobs: sorted });
  const hash = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  return hash;
}
