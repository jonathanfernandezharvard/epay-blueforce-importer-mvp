import type { TokenSet } from "openid-client";
import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import { logger } from "../services/logger";

type UserSession = {
  tokenSet: TokenSet;
  claims: any;
};

type OpenIdClientModule = typeof import("openid-client");
let openIdClientModule: Promise<OpenIdClientModule> | null = null;

async function getOpenIdClient(): Promise<OpenIdClientModule> {
  if (!openIdClientModule) {
    const dynamicImport = new Function("specifier", "return import(specifier);") as (
      specifier: string
    ) => Promise<OpenIdClientModule>;
    openIdClientModule = dynamicImport("openid-client");
  }
  return openIdClientModule;
}

declare module "express-session" {
  interface SessionData {
    user?: UserSession;
  }
}

function env(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${name}`);
  return v;
}

export async function buildAuthRouter(baseUrl: string) {
  const { Issuer, generators } = await getOpenIdClient();
  const tenant = env("AZURE_TENANT_ID");
  const issuerUrl = `https://login.microsoftonline.com/${tenant}/v2.0`;
  const issuer = await Issuer.discover(issuerUrl);
  const client = new issuer.Client({
    client_id: env("AZURE_CLIENT_ID"),
    client_secret: env("AZURE_CLIENT_SECRET"),
    redirect_uris: [`${baseUrl}/oidc/callback`],
    response_types: ["code"],
  });

  const router = express.Router();

  router.get("/login", async (req, res) => {
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    (req.session as any).codeVerifier = codeVerifier;
    const url = client.authorizationUrl({
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    res.redirect(url);
  });

  router.get("/oidc/callback", async (req, res, next) => {
    try {
      const params = client.callbackParams(req);
      const tokenSet = await client.callback(`${baseUrl}/oidc/callback`, params, {
        code_verifier: (req.session as any).codeVerifier,
      });
      const claims = tokenSet.claims();
      req.session.user = { tokenSet, claims };
      res.redirect("/");
    } catch (err) {
      next(err);
    }
  });

  router.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/");
    });
  });

  return { router, client };
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
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  });
}

export function requireAuth() {
  const allowedGroup = process.env.ALLOWED_GROUP_OBJECT_ID?.trim();
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.TEST_BYPASS_AUTH === "true" || process.env.NODE_ENV === "test") {
      // Inject a fake session for tests/dev
      req.session.user = {
        tokenSet: {} as any,
        claims: {
          preferred_username: "test.user@example.com",
          email: "test.user@example.com",
          groups: allowedGroup ? [allowedGroup] : [],
          name: "Test User",
        },
      };
      return next();
    }

    const user = req.session.user;
    if (!user) {
      return res.redirect("/login");
    }
    if (allowedGroup) {
      const groups: string[] = user.claims?.groups || [];
      if (!groups.includes(allowedGroup)) {
        return res.status(403).send("Forbidden: you are not in the allowed group.");
      }
    }
    return next();
  };
}

export function currentUpn(req: express.Request): string {
  const claims = req.session.user?.claims || {};
  return claims.preferred_username || claims.email || claims.upn || "unknown";
}
