import express from "express";
import path from "path";
import helmet from "helmet";
import pinoHttp from "pino-http";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { sessionMiddleware, buildAuthRouter } from "./auth/localAuth";
import indexRouter from "./routes/index";
import buildSubmitRouter from "./routes/submit";
import batchesRouter from "./routes/batches";
import adminRouter from "./routes/admin";
import { InProcessQueue } from "./services/queue";
import { Worker } from "./services/worker";
import { logger } from "./services/logger";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const app = express();
const prisma = new PrismaClient();

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(helmet({ contentSecurityPolicy: false }));

app.use(pinoHttp({ logger }));

// Allow larger payloads for long job lists (tests send up to ~300 items).
app.use(bodyParser.urlencoded({ extended: false, limit: "1mb" }));
app.use(bodyParser.json({ limit: "1mb" }));

app.use(sessionMiddleware());

// Static assets
const screenshotsDir = process.env.SCREENSHOTS_DIR || "/data/screenshots";
app.use("/js", express.static(path.join(__dirname, "public", "js")));
app.use("/css", express.static(path.join(__dirname, "public", "css")));
app.use("/screenshots", express.static(screenshotsDir, { index: false, dotfiles: "deny" }));

// Health
app.get("/health", (_req, res) => res.json({ status: "ok" }));

if (process.env.TEST_BYPASS_AUTH === "true") {
  logger.warn("TEST_BYPASS_AUTH enabled; all requests are auto-authorized as admin.");
}

app.use(buildAuthRouter(prisma));

// Core routes
app.use(indexRouter);
const queue = new InProcessQueue<string>();
app.use(buildSubmitRouter(queue));
app.use(batchesRouter);
app.use(adminRouter);

// Background worker
new Worker(queue, prisma);

// 404
app.use((req, res) => res.status(404).send("Not found"));

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: String(err) }, "Unhandled error");
  res.status(500).send("Internal Server Error");
});

const port = Number(process.env.PORT || 8080);
if ((require as any).main === module) {
  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

export default app;
