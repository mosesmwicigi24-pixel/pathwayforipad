// Module: chat — direct messages, cell groups, and public spaces (mobile make).
// All member-facing and server-authoritative on membership (§5.4). Sends are the
// same idempotent shape replayed by /sync/push (chat_messages:create etc.).
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../http/context.js";
import { authenticate, requireRole } from "../../http/auth.js";
import { handler, parseBody, requirePrincipal } from "../../http/http.js";
import { ChatService } from "./service.js";

const IdParam = z.object({ id: z.string().uuid() });

export const chatRouter: Router = Router();

export function registerChat(ctx: AppContext): Router {
  const svc = new ChatService(ctx.db.primary);
  const auth = authenticate(ctx.env);
  const r = chatRouter;

  r.get("/chat/conversations", auth, handler(async (req, res) => {
    res.json(await svc.listConversations(requirePrincipal(req).userId));
  }));

  r.get("/chat/conversations/:id", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.getConversation(requirePrincipal(req).userId, id));
  }));

  r.post("/chat/conversations/:id/messages", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const input = parseBody(ChatService.SendMessage, req.body);
    res.status(201).json(await svc.sendMessage(requirePrincipal(req).userId, id, input));
  }));

  r.post("/chat/conversations/:id/read", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.markRead(requirePrincipal(req).userId, id));
  }));

  r.post("/chat/messages/:id/reactions", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    const body = parseBody(ChatService.ToggleReaction.omit({ message_id: true }), req.body);
    res.json(await svc.toggleReaction(requirePrincipal(req).userId, { message_id: id, ...body }));
  }));

  r.post("/chat/dms", auth, handler(async (req, res) => {
    const input = parseBody(ChatService.CreateDm, req.body);
    res.status(201).json(await svc.createOrGetDm(requirePrincipal(req).userId, input.user_id));
  }));

  r.post("/chat/spaces/:id/join", auth, handler(async (req, res) => {
    const { id } = parseBody(IdParam, req.params);
    res.json(await svc.joinSpace(requirePrincipal(req).userId, id));
  }));

  // Leaders curate public spaces for their congregation.
  r.post("/chat/spaces", auth, requireRole("Instructor"), handler(async (req, res) => {
    const input = parseBody(ChatService.CreateSpace, req.body);
    res.status(201).json(await svc.createSpace(requirePrincipal(req).userId, input));
  }));

  return r;
}
