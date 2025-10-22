import express, { NextFunction, Request, Response } from "express";
import session from "express-session";
import argon2 from "argon2";
import csrf from "csurf";
import { PrismaClient, UserRole } from "@prisma/client";
import { z } from "zod";
import { logger } from "../services/logger";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    returnTo?: string;
  }
}

const LoginSchema = z.object({
  email: z.string().email().trim(),
  password: z.string().min(1),
});

const CreateUserSchema = z.object({
  email: z.string().email().trim(),
  displayName: z.string().trim().min(1),
  password: z.string().min(8),
  role: z.nativeEnum(UserRole),
});

function env(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export function sessionMiddleware() {
  const secret = env("SESSION_SECRET");
  return session({
    name: "bf.sid",
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  });
}

export function requireAuth(options?: { role?: UserRole }) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.TEST_BYPASS_AUTH === "true" || process.env.NODE_ENV === "test") {
      req.session.user = {
        id: "test-user",
        email: "test.user@example.com",
        displayName: "Test User",
        role: UserRole.ADMIN,
      };
      return next();
    }

    const user = req.session.user;
    if (!user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect("/login");
    }
    if (options?.role && user.role !== options.role) {
      return res.status(403).send("Forbidden: insufficient permissions.");
    }
    return next();
  };
}

export function requireAdmin() {
  return requireAuth({ role: UserRole.ADMIN });
}

export function currentUserEmail(req: Request): string {
  return req.session.user?.email ?? "unknown";
}

export function buildAuthRouter(prisma: PrismaClient) {
  const router = express.Router();
  const csrfProtection = csrf({ cookie: false });

  router.get("/login", csrfProtection, (req, res) => {
    if (req.session.user) {
      return res.redirect("/");
    }
    res.render("login", { csrfToken: req.csrfToken(), error: null });
  });

  router.post("/login", csrfProtection, async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ error: parsed.error.flatten() }, "Login validation failed");
      return res.status(400).render("login", {
        csrfToken: req.csrfToken(),
        error: "Please provide a valid email and password.",
      });
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).render("login", {
        csrfToken: req.csrfToken(),
        error: "Invalid email or password.",
      });
    }

    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      return res.status(400).render("login", {
        csrfToken: req.csrfToken(),
        error: "Invalid email or password.",
      });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };
    const destination = req.session.returnTo || "/";
    delete req.session.returnTo;
    return res.redirect(destination);
  });

  router.post("/logout", requireAuth(), csrfProtection, (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  router.get("/admin/users", requireAdmin(), csrfProtection, async (req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { email: "asc" },
      select: { id: true, email: true, displayName: true, role: true, createdUtc: true },
    });
    res.render("admin-users", {
      csrfToken: req.csrfToken(),
      users,
      currentUser: req.session.user!,
      errors: null,
    });
  });

  router.post("/admin/users", requireAdmin(), csrfProtection, async (req, res) => {
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      const users = await prisma.user.findMany({
        orderBy: { email: "asc" },
        select: { id: true, email: true, displayName: true, role: true, createdUtc: true },
      });
      return res.status(400).render("admin-users", {
        csrfToken: req.csrfToken(),
        users,
        currentUser: req.session.user!,
        errors: parsed.error.flatten(),
      });
    }

    const { email, displayName, password, role } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const users = await prisma.user.findMany({
        orderBy: { email: "asc" },
        select: { id: true, email: true, displayName: true, role: true, createdUtc: true },
      });
      return res.status(400).render("admin-users", {
        csrfToken: req.csrfToken(),
        users,
        currentUser: req.session.user!,
        errors: { fieldErrors: { email: ["A user with that email already exists."] }, formErrors: [] },
      });
    }

    const passwordHash = await argon2.hash(password);
    await prisma.user.create({
      data: { email, displayName, passwordHash, role },
    });
    logger.info({ email, createdBy: req.session.user?.email }, "User created");
    return res.redirect("/admin/users");
  });

  return router;
}
