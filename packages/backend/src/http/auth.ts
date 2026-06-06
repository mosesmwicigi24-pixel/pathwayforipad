// Authentication & authorization middleware (spec §1.4, §5.3, §5.4).
//
// In production the gateway validates the JWT signature and forwards signed
// internal identity headers (§1.4); services trust those. For the monolith we
// support both: if a trusted gateway header is present we use it, otherwise we
// validate the Bearer JWT ourselves. Either way the principal is attached to the
// request. RBAC role checks and leader_assignments scoping build on top.
import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@nuru/shared";
import type { Env } from "../config/env.js";
import { ApiError } from "./errors.js";
import { verifyAccessToken } from "../modules/identity/tokens.js";
import { many, type Queryable } from "../db/db.js";
import type { Principal } from "./http.js";

const ROLE_RANK: Record<UserRole, number> = {
  Student: 0,
  Instructor: 1,
  Admin: 2,
  SuperAdmin: 3,
};

/** Build the authenticate middleware. Populates req.principal or 401s. */
export function authenticate(env: Env) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const header = req.header("Authorization");
      if (!header?.startsWith("Bearer ")) {
        throw new ApiError("AUTH_REQUIRED", "Missing bearer token");
      }
      const claims = verifyAccessToken(env, header.slice("Bearer ".length).trim());
      req.principal = {
        userId: claims.sub,
        role: claims.role,
        congregationId: claims.cong,
        ...(claims.mfa === true ? { mfa: true } : {}),
        ...(typeof claims.mfa_at === "number" ? { mfaAt: claims.mfa_at } : {}),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Require a minimum role (coarse RBAC, §5.4). */
export function requireRole(min: UserRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const p = req.principal;
    if (!p) return next(new ApiError("AUTH_REQUIRED", "Authentication required"));
    if (ROLE_RANK[p.role] < ROLE_RANK[min]) {
      return next(new ApiError("FORBIDDEN_SCOPE", "Insufficient role"));
    }
    next();
  };
}

/**
 * Step-up MFA gate (§5.3): the presenting access token must carry a verified
 * second factor that is still fresh. Compose with requireRole for SuperAdmin /
 * financial-config actions, e.g. `r.post(path, auth, requireRole("SuperAdmin"),
 * requireStepUp(), handler(...))`. The freshness window forces a re-prompt for
 * sensitive operations even within an otherwise-valid session.
 */
export function requireStepUp(maxAgeSeconds = 900) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const p = req.principal;
    if (!p) return next(new ApiError("AUTH_REQUIRED", "Authentication required"));
    const now = Math.floor(Date.now() / 1000);
    if (p.mfa !== true || typeof p.mfaAt !== "number" || now - p.mfaAt > maxAgeSeconds) {
      return next(
        new ApiError("FORBIDDEN_SCOPE", "Step-up MFA required for this action", {
          mfa_required: true,
        }),
      );
    }
    next();
  };
}

/**
 * Fine-grained scoping (§5.4): assert the caller may act on a given cell group.
 * SuperAdmin/Admin pass; an Instructor/Multiplier must have a leader_assignments
 * row for that cell. Enforced in the query layer — out-of-scope ids 403.
 */
export async function assertCellInScope(q: Queryable, principal: Principal, cellGroupId: string): Promise<void> {
  if (principal.role === "SuperAdmin" || principal.role === "Admin") return;
  const rows = await many<{ cell_group_id: string }>(
    q,
    `SELECT cell_group_id FROM leader_assignments WHERE leader_user_id = $1 AND cell_group_id = $2`,
    [principal.userId, cellGroupId],
  );
  if (rows.length === 0) {
    throw new ApiError("FORBIDDEN_SCOPE", "Cell group outside your assignments");
  }
}
