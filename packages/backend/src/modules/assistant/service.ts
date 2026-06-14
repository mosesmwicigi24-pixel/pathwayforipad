// Nuru: the in-app AI companion (mobile make's NuruAssistant). Server-side proxy
// so the provider key never reaches the client (§5.10). Pastoral + privacy-safe:
// Nuru only ever grounds on a conversation the member can actually access
// (membership re-checked via ChatService → 404 otherwise), never on other
// members' private data. Conversation history is client-held and replayed each
// turn (the make keeps the Nuru thread ephemeral on-device).
import type { Pool } from "pg";
import { z } from "zod";
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
  });

  async chat(userId: string, input: z.infer<typeof AssistantService.Chat>): Promise<{ reply: string }> {
    let system = NURU_SYSTEM;
    if (input.conversation_id) {
      // Membership re-checked here — getConversation throws 404 outside the member's scope.
      const convo = (await this.chatSvc.getConversation(userId, input.conversation_id)) as {
        title?: string;
        messages: Array<{ author_name: string; body: string }>;
      };
      const transcript = convo.messages
        .slice(-30)
        .map((m) => `${m.author_name}: ${m.body}`)
        .join("\n");
      system += `\n\nThe member is asking about "${convo.title ?? "a conversation"}". Here is its recent transcript (oldest→newest). Use only this; do not invent beyond it:\n${transcript}`;
    }
    const reply = await this.provider.complete({ system, messages: input.messages });
    return { reply };
  }
}
