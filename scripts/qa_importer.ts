import "dotenv/config";
import fs from "fs";
import path from "path";
import request from "supertest";
import { setTimeout as delay } from "timers/promises";

const QA_DIR = path.join(process.cwd(), ".qa-artifacts");
const ensureDir = async (dir: string) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

async function main() {
  process.env.TEST_BYPASS_AUTH = "true";
  process.env.NODE_ENV = process.env.NODE_ENV || "development";
  process.env.PLAYWRIGHT_HEADLESS = process.env.PLAYWRIGHT_HEADLESS || "true";

  process.env.IMPORT_FILE_DIR =
    process.env.IMPORT_FILE_DIR || path.join(QA_DIR, "imports");
  process.env.SCREENSHOTS_DIR =
    process.env.SCREENSHOTS_DIR || path.join(QA_DIR, "screens");
  process.env.STORAGE_STATE_PATH =
    process.env.STORAGE_STATE_PATH ||
    path.join(QA_DIR, "state", "storageState.json");

  const storageState = process.env.STORAGE_STATE_PATH!;
  const importDir = process.env.IMPORT_FILE_DIR!;
  const screenshotsDir = process.env.SCREENSHOTS_DIR!;

  await ensureDir(path.dirname(storageState));
  await ensureDir(importDir);
  await ensureDir(screenshotsDir);

  const app = (await import("../src/server")).default;
  const agent = request.agent(app);

  const resGet = await agent.get("/");
  if (resGet.status !== 200) {
    throw new Error(`Unexpected GET / status ${resGet.status}`);
  }
  const csrfMatch = /name="_csrf" value="([^"]+)"/.exec(resGet.text);
  if (!csrfMatch) {
    throw new Error("Failed to parse CSRF token from form");
  }
  const csrfToken = csrfMatch[1];

  const jobs = ["1001", "1002", "1003", "1004"];
  const form = new URLSearchParams();
  form.set("payrollId", `QA${Date.now()}`);
  form.set("jobs", jobs.join(","));
  form.set("_csrf", csrfToken);

  const resPost = await agent
    .post("/submit")
    .set("Content-Type", "application/x-www-form-urlencoded")
    .send(form.toString());

  if (resPost.status !== 200) {
    console.error("Submit response:", resPost.status, resPost.text);
    throw new Error("Submission failed");
  }

  const batchId: string | undefined = resPost.body?.batchId;
  if (!batchId) {
    throw new Error("Batch ID missing from submit response");
  }

  console.log(`Batch ${batchId} created; polling for completion...`);
  const activeStatuses = new Set(["Queued", "Running"]);
  const deadline = Date.now() + 15 * 60_000; // 15 minutes
  let batch: any = null;

  while (Date.now() < deadline) {
    const res = await agent.get(`/api/batches/${batchId}`);
    if (res.status !== 200) {
      throw new Error(`Failed to fetch batch (${res.status})`);
    }
    batch = res.body;
    if (!activeStatuses.has(batch.status)) {
      break;
    }
    console.log(
      `Still ${batch.status}... ${new Date(batch.updatedUtc).toLocaleTimeString()}`
    );
    await delay(10_000);
  }

  if (!batch) {
    throw new Error("Batch never retrieved");
  }

  const finalStatus = batch.status;
  console.log(`Final status: ${finalStatus}`);

  if (finalStatus !== "Done") {
    console.error("Outcome:", batch.outcome);
    throw new Error("Importer did not complete successfully");
  }

  if (!fs.existsSync(batch.csvPath)) {
    throw new Error(`Expected CSV at ${batch.csvPath} not found`);
  }

  const erroredItems = batch.items.filter(
    (it: any) => it.status && it.status !== "Imported"
  );
  if (erroredItems.length > 0) {
    console.warn("Some items did not import cleanly:", erroredItems);
  }

  console.log("CSV location:", batch.csvPath);
  console.log("Screenshots saved to:", screenshotsDir);
  console.log("QA importer flow succeeded.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
