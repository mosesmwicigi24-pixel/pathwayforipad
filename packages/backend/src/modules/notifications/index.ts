// Module: notifications (spec §1.5)
// Owns: Push/email scheduling, the 12-nudge cadence, inactivity triggers, quiet-hours by local timezone.
//
// Logical service boundary in the modular monolith. These seams can later be
// split into separate deployables without touching the schema, API, or security
// model (§1.5 deployment note). No feature code yet — only the registration hook.
import { Router } from "express";
import type { AppContext } from "../../http/context.js";

export const notificationsRouter: Router = Router();

/** Mount this module's routes onto the app. Implemented as features land. */
export function registerNotifications(_ctx: AppContext): Router {
  // TODO: attach route handlers for the notifications bounded context.
  return notificationsRouter;
}
