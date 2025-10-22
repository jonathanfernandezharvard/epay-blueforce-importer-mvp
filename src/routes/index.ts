import { Router, Request, Response } from "express";
import csrf from "csurf";
import { requireAuth } from "../auth/localAuth";

const router = Router();
const csrfProtection = csrf({ cookie: false });

router.get("/", requireAuth(), csrfProtection, (req: Request, res: Response) => {
  res.render("index", { csrfToken: req.csrfToken(), currentUser: req.session.user });
});

export default router;
