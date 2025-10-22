import request from "supertest";
import fs from "fs";
import path from "path";

process.env.NODE_ENV = "test";
process.env.TEST_BYPASS_AUTH = "true";
process.env.IMPORT_FILE_DIR = path.join("/mnt/data", "imports_test");
process.env.SCREENSHOTS_DIR = path.join("/mnt/data", "screens_test");
process.env.STORAGE_STATE_PATH = path.join("/mnt/data", "state_test", "state.json");
process.env.SESSION_SECRET = "testsecret";

(async () => {
  const app = (await import("../src/server")).default;
  await fs.promises.mkdir(process.env.IMPORT_FILE_DIR!, { recursive: true });
  const agent = request.agent(app as any);

  const resGet = await agent.get("/");
  const match = /name="_csrf" value="([^"]+)"/.exec(resGet.text);
  const csrf = match ? match[1] : null;
  console.log("Got CSRF:", !!csrf);

  const many = Array.from({ length: 301 }, (_, i) => `S${i + 1}`).join(",");
  const form = new URLSearchParams();
  form.set("payrollId", "PX_DEBUG");
  form.set("jobs", many);
  form.set("_csrf", csrf || "");

  const resPost = await agent
    .post("/submit")
    .set("Content-Type", "application/x-www-form-urlencoded")
    .send(form.toString());

  console.log("POST status:", resPost.status);
  console.log("POST body:", resPost.text || JSON.stringify(resPost.body));
  process.exit(resPost.status === 400 ? 0 : 2);
})();
