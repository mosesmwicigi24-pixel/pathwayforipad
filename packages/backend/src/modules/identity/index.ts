// Module: identity (spec §1.5)
// Owns: Users, roles, sessions, refresh tokens, OAuth exchange (KingsChat/Google/Apple), RBAC checks.
//
// Logical service boundary in the modular monolith. These seams can later be
// split into separate deployables without touching the schema, API, or security
// model (§1.5 deployment note). No feature code yet — only the registration hook.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";

export const identityRouter: Router = Router();

/** Mount this module's routes onto the app. Implemented as features land. */
export function registerIdentity(_ctx: AppContext): Router {
  // TODO: attach route handlers for the identity bounded context.
  return identityRouter;
}
