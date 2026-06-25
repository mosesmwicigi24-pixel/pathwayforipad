// Module: identity (spec §1.5)
// Owns: Users, roles, sessions, refresh tokens, OAuth exchange (KingsChat/Google/
// Apple), RBAC checks. Endpoints per §3.3 (auth & identity).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ApiError } from "../../http/errors.js";
import { IdentityService } from "./service.js";
import { buildOAuthRegistry } from "./oauth.js";

export const identityRouter: Router = Router();

export function registerIdentity(ctx: AppContext): Router {
  const svc = new IdentityService(ctx.db.primary, ctx.env);
  const oauth = buildOAuthRegistry(ctx.env);
  const auth = authenticate(ctx.env);
  const r = identityRouter;

  // --- Public auth routes ---
  r.post(
    "/auth/oauth/:provider",
    handler(async (req, res) => {
      const provider = req.params.provider ?? "";
      const verifier = oauth.get(provider);
      if (!verifier) throw new ApiError("NOT_FOUND", "Unknown provider");
      const body = parseBody(
        z.object({
          code: z.string().min(1),
          redirect_uri: z.string().url().optional(),
          code_verifier: z.string().min(1).optional(),
        }),
        req.body,
      );
      const profile = await verifier.verify({
        code: body.code,
        ...(body.redirect_uri ? { redirectUri: body.redirect_uri } : {}),
        ...(body.code_verifier ? { codeVerifier: body.code_verifier } : {}),
      });
      const tokens = await svc.loginWithOAuth(profile);
      res.status(200).json(tokens);
    }),
  );

  r.post(
    "/auth/login",
    handler(async (req, res) => {
      const input = parseBody(IdentityService.LoginSchema, req.body);
      res.status(200).json(await svc.loginWithPassword(input));
    }),
  );

  // Second step of a 2FA login: exchange the challenge token + a TOTP/recovery
  // code for a session. Public (the challenge token is the proof of step one).
  r.post(
    "/auth/login/mfa",
    handler(async (req, res) => {
      const { mfa_token, code } = parseBody(
        z.object({ mfa_token: z.string().min(10), code: z.string().min(6).max(20) }),
        req.body,
      );
      res.status(200).json(await svc.loginCompleteMfa(mfa_token, code));
    }),
  );

  r.post(
    "/auth/register",
    handler(async (req, res) => {
      const input = parseBody(IdentityService.RegisterSchema, req.body);
      res.status(201).json(await svc.register(input));
    }),
  );

  r.post(
    "/auth/password/forgot",
    handler(async (req, res) => {
      const input = parseBody(IdentityService.ForgotPasswordSchema, req.body);
      res.status(200).json(await svc.requestPasswordReset(input));
    }),
  );

  r.post(
    "/auth/password/reset",
    handler(async (req, res) => {
      const input = parseBody(IdentityService.ResetPasswordSchema, req.body);
      res.status(200).json(await svc.resetPassword(input));
    }),
  );

  r.post(
    "/auth/token/refresh",
    handler(async (req, res) => {
      const { refresh_token } = parseBody(z.object({ refresh_token: z.string().min(1) }), req.body);
      res.status(200).json(await svc.refresh(refresh_token));
    }),
  );

  r.post(
    "/auth/logout",
    handler(async (req, res) => {
      const { refresh_token } = parseBody(z.object({ refresh_token: z.string().min(1) }), req.body);
      await svc.logout(refresh_token);
      res.status(204).end();
    }),
  );

  // --- DEV ONLY login (never mounted in production) ---
  // Hard-gated: in production this route does not exist, so it 404s.
  if (ctx.env.NODE_ENV !== "production") {
    r.post(
      "/auth/dev-login",
      handler(async (req, res) => {
        const body = parseBody(
          z.object({ email: z.string().email().optional(), user_id: z.string().uuid().optional() }),
          req.body ?? {},
        );
        res.json(await svc.devLogin(body));
      }),
    );
  }

  // --- Step-up MFA (§5.3) ---
  r.post(
    "/auth/mfa/enroll",
    auth,
    handler(async (req, res) => {
      res.status(201).json(await svc.enrollMfa(requirePrincipal(req).userId));
    }),
  );

  r.post(
    "/auth/mfa/verify",
    auth,
    handler(async (req, res) => {
      const { code } = parseBody(z.object({ code: z.string().regex(/^\d{6,10}$/) }), req.body);
      res.json(await svc.verifyMfa(requirePrincipal(req).userId, code));
    }),
  );

  // Turn 2FA off — requires a current TOTP or recovery code as confirmation.
  r.post(
    "/auth/mfa/disable",
    auth,
    handler(async (req, res) => {
      const { code } = parseBody(z.object({ code: z.string().min(6).max(20) }), req.body);
      res.json(await svc.disableMfa(requirePrincipal(req).userId, code));
    }),
  );

  // --- Authenticated profile routes ---
  r.get(
    "/me",
    auth,
    handler(async (req, res) => {
      res.json(await svc.getMe(requirePrincipal(req).userId));
    }),
  );

  r.patch(
    "/me",
    auth,
    handler(async (req, res) => {
      const input = parseBody(IdentityService.UpdateMeSchema, req.body);
      res.json(await svc.updateMe(requirePrincipal(req).userId, input));
    }),
  );

  r.post(
    "/me/password",
    auth,
    handler(async (req, res) => {
      const input = parseBody(IdentityService.ChangePasswordSchema, req.body);
      res.json(await svc.changePassword(requirePrincipal(req).userId, input));
    }),
  );

  r.get(
    "/me/activity",
    auth,
    handler(async (req, res) => {
      res.json({ data: await svc.myActivity(requirePrincipal(req).userId) });
    }),
  );

  r.post(
    "/me/onboarding",
    auth,
    handler(async (req, res) => {
      const input = parseBody(IdentityService.OnboardingSchema, req.body);
      res.status(201).json(await svc.onboard(requirePrincipal(req).userId, input));
    }),
  );

  r.post(
    "/me/devices",
    auth,
    handler(async (req, res) => {
      const input = parseBody(
        z.object({
          platform: z.enum(["ios", "android"]),
          app_version: z.string().max(20).optional(),
          push_token: z.string().max(512).optional(),
        }),
        req.body,
      );
      res.status(201).json(await svc.registerDevice(requirePrincipal(req).userId, input));
    }),
  );

  return r;
}
