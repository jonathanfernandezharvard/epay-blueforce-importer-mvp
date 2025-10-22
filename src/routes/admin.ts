import { Router, Request, Response } from "express";
import csrf from "csurf";
import { requireAdmin } from "../auth/localAuth";
import { EpayImporter } from "../services/epayImporter";

const router = Router();
const csrfProtection = csrf({ cookie: false });

router.post("/admin/epay/setup", requireAdmin(), csrfProtection, async (req: Request, res: Response) => {
  // Run a no-op login so storage state is created/refreshed
  const importer = new EpayImporter();
  const result = await importer.setupLogin().catch((e) => ({ ok: false, message: String(e) }));
  res.json({ ok: (result as any).ok !== false, message: (result as any).message || "Login state refreshed" });
});

export default router;
