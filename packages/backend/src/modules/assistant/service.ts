// Nuru: the in-app AI companion (mobile make's NuruAssistant). Server-side proxy
// so the provider key never reaches the client (§5.10). Pastoral + privacy-safe:
// Nuru only ever grounds on a conversation the member can actually access
// (membership re-checked via ChatService → 404 otherwise), never on other
// members' private data. Conversation history is client-held and replayed each
// turn (the make keeps the Nuru thread ephemeral on-device).
import type { Pool } from "pg";
import { z } from "zod";
import { many } from "../../db/db.js";
import { ChatService } from "../chat/service.js";
import type { AiProvider } from "./provider.js";

const NURU_SYSTEM = `You are Nuru, a warm, encouraging AI companion inside the Nuru Place discipleship app.
You help members of a church grow: summarize a conversation, draft an encouragement, surface prayer requests, or help plan a quiet time.
Style: gentle, hopeful, concise (a few sentences). You may reference Scripture lightly and pastorally.
Boundaries: never invent facts about other members or their private data; only use context you are given. Do not give medical, legal, or financial advice — gently point the member to a leader or professional. Encourage, never shame.`;

export class AssistantService {
  constructor(
    private readonly pool: Pool,
    private readonly provider: AiProvider,
    private readonly chatSvc = new ChatService(pool),
  ) {}

  static readonly Chat = z.object({
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000) }))
      .min(1)
      .max(40),
    conversation_id: z.string().uuid().optional(), // ground the answer on a chat the member can access
    context_limit: z.coerce.number().int().min(1).max(20).optional(), // recent messages to read (default 5)
  });

  /** How many recent messages Nuru reads for context (the "immediate" window). */
  static readonly DEFAULT_CONTEXT = 5;

  async chat(userId: string, input: z.infer<typeof AssistantService.Chat>): Promise<{ reply: string }> {
    let system = NURU_SYSTEM;
    if (input.conversation_id) {
      // Membership re-checked here — getConversation throws 404 outside the member's scope.
      const convo = (await this.chatSvc.getConversation(userId, input.conversation_id)) as {
        title?: string;
        messages: Array<{ author_name: string; body: string }>;
      };
      const limit = input.context_limit ?? AssistantService.DEFAULT_CONTEXT;
      const recent = convo.messages.slice(-limit);
      const transcript = recent.map((m) => `${m.author_name}: ${m.body}`).join("\n");
      system +=
        `\n\nYou are assisting inside the conversation "${convo.title ?? "a chat"}". ` +
        `Read these last ${recent.length} message(s) (oldest→newest) and let them guide your reply. ` +
        `Ground everything ONLY in this transcript — do not invent anything beyond it:\n${transcript}\n\n` +
        `If asked to suggest or draft a reply, respond with a single natural message the member could send next — no preamble, no quotes, no options list.`;
    }
    const reply = await this.provider.complete({ system, messages: input.messages });
    // Persist this exchange so the Nuru thread is retrievable across sessions
    // (best-effort — a storage hiccup must never swallow the member's reply).
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    try {
      if (lastUser) await this.persist(userId, "user", lastUser.text);
      await this.persist(userId, "assistant", reply);
    } catch {
      /* non-fatal */
    }
    return { reply };
  }

  private async persist(userId: string, role: "user" | "assistant", text: string): Promise<void> {
    await this.pool.query(`INSERT INTO assistant_messages (user_id, role, text) VALUES ($1, $2, $3)`, [userId, role, text]);
  }

  /** The member's saved Nuru thread, oldest→newest (their own only, §5.4). */
  async history(userId: string, limit = 200): Promise<{ messages: Array<{ role: string; text: string; created_at: string }> }> {
    const messages = await many<{ role: string; text: string; created_at: string }>(
      this.pool,
      `SELECT role, text, created_at FROM assistant_messages WHERE user_id = $1 ORDER BY created_at LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 500)],
    );
    return { messages };
  }
}
