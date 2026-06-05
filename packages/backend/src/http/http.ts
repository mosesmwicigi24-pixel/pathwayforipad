// Small HTTP utilities shared by modules: async-handler wrapping (Express 4 does
// not catch async throws), Zod body validation → 400 VALIDATION_FAILED, and typed
// access to the authenticated principal.
import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { ApiError } from "./errors.js";
import type { AccessClaims } from "../modules/identity/tokens.js";

export interface Principal {
  userId: string;
  role: AccessClaims["role"];
  congregationId: string;
}

// Augment Express Request with our principal.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

export type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

/** Wrap an async handler so thrown errors reach the error middleware. */
export function handler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };
}

export function requirePrincipal(req: Request): Principal {
  if (!req.principal) throw new ApiError("AUTH_REQUIRED", "Authentication required");
  return req.principal;
}

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError("VALIDATION_FAILED", "Request body failed validation", {
      fields: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
