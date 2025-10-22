import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import csrf from "csurf";
import { requireAuth } from "../auth/localAuth";
import fs from "fs";

const prisma = new PrismaClient();
const router = Router();
const csrfProtection = csrf({ cookie: false });

router.get("/batches/:id", requireAuth(), csrfProtection, async (req: Request, res: Response) => {
  const id = req.params.id;
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!batch) return res.status(404).send("Batch not found");
  res.render("batch-details", { batch, csrfToken: req.csrfToken(), currentUser: req.session.user });
});

router.get("/api/batches/:id", requireAuth(), async (req: Request, res: Response) => {
  const id = req.params.id;
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!batch) return res.status(404).json({ error: "Not found" });
  res.json(batch);
});

router.get("/batches/:id/csv", requireAuth(), async (req: Request, res: Response) => {
  const id = req.params.id;
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) return res.status(404).send("Not found");
  if (!fs.existsSync(batch.csvPath)) return res.status(410).send("CSV no longer available");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${require('path').basename(batch.csvPath)}"`);
  fs.createReadStream(batch.csvPath).pipe(res);
});

export default router;

