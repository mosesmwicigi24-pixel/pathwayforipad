// Module: assistant — the Nuru AI companion proxy (mobile make). One member-
// facing endpoint; the provider (Gemini free tier, or the offline fake) is
// resolved from env so the key stays server-side (§5.10).
import { Router } from "express";
import type { AppContext } from "../../http/context.js";
import { authenticate } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { AssistantService } from "./service.js";
import { buildAiProvider, type AiProvider } from "./provider.js";

export const assistantRouter: Router = Router();

export function registerAssistant(ctx: AppContext, providerOverride?: AiProvider): Router {
  const svc = new AssistantService(ctx.db.primary, providerOverride ?? buildAiProvider(ctx.env));
  const auth = authenticate(ctx.env);
  const r = assistantRouter;

  r.post("/assistant/chat", auth, handler(async (req, res) => {
    const input = parseBody(AssistantService.Chat, req.body);
    res.json(await svc.chat(requirePrincipal(req).userId, input));
  }));

  return r;
}
