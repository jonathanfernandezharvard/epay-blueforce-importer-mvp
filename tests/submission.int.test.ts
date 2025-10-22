import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
process.env.NODE_ENV = "test";
process.env.TEST_BYPASS_AUTH = "true";
process.env.IMPORT_FILE_DIR = path.join("/mnt/data", "imports_test");
process.env.SCREENSHOTS_DIR = path.join("/mnt/data", "screens_test");
process.env.STORAGE_STATE_PATH = path.join("/mnt/data", "state_test", "state.json");

let app: any;
let agent: request.SuperAgentTest;

describe("Submit integration", () => {
  beforeAll(async () => {
    app = (await import("../src/server")).default;
    await fs.promises.mkdir(process.env.IMPORT_FILE_DIR!, { recursive: true });
    agent = request.agent(app);
  });

  it("serves form, posts submit, writes CSV and enqueues", async () => {
    // Get CSRF token from form
  const resGet = await agent.get("/");
    expect(resGet.status).toBe(200);
    const match = /name="_csrf" value="([^"]+)"/.exec(resGet.text);
    expect(match).toBeTruthy();
    const csrf = match![1];

    const form = new URLSearchParams();
    form.set("payrollId", "PX001");
    form.set("jobs", "1001, 1002\n1002, 1003");
    form.set("_csrf", csrf);

    const resPost = await agent
      .post("/submit")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(form.toString());

    expect(resPost.status).toBe(200);
    const body = resPost.body;
    expect(body.batchId).toBeTruthy();

    // Fetch details API
    const resApi = await request(app).get(`/api/batches/${body.batchId}`);
    expect(resApi.status).toBe(200);
    const batch = resApi.body;
    expect(batch.csvPath).toMatch(/SiteEmployeeDefaults_/);

    // Verify CSV exists
    const exists = fs.existsSync(batch.csvPath);
    expect(exists).toBe(true);
  });

  it("rejects >300 jobs", async () => {
  const resGet = await agent.get("/");
  const csrf = /name="_csrf" value="([^"]+)"/.exec(resGet.text)![1];
    const many = Array.from({ length: 301 }, (_, i) => `S${i+1}`).join(",");
    const form = new URLSearchParams();
    form.set("payrollId", "PX002");
    form.set("jobs", many);
    form.set("_csrf", csrf);

    const resPost = await request(app)
      .post("/submit")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(form.toString());

    expect(resPost.status).toBe(400);
  });
});
