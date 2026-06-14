// Nuru AI provider abstraction. The assistant logic depends only on this
// interface, so the suite runs with no network/secret (FakeAiProvider) and the
// church can swap providers without touching the module. Default real provider is
// Google Gemini (free tier via Google AI Studio); the API key lives server-side
// only (§5.10) and is never shipped to the mobile app.
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";

export interface AiTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AiCompletion {
  system: string;
  messages: AiTurn[];
}

export interface AiProvider {
  readonly name: string;
  complete(input: AiCompletion): Promise<string>;
}

/** Google Gemini (generativelanguage REST). Maps assistant→model roles. */
class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: input.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
      generationConfig: { maxOutputTokens: 600, temperature: 0.6 },
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Groq (OpenAI-compatible chat completions). Genuinely free tier, very fast,
 *  hosts open models (Llama 3.3). System prompt rides as a system message. */
class GroqProvider implements AiProvider {
  readonly name = "groq";
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(input: AiCompletion): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            ...input.messages.map((m) => ({ role: m.role, content: m.text })),
          ],
          max_tokens: 600,
          temperature: 0.6,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant had nothing to say");
      return text;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Wraps a live provider so a provider error / rate-limit (429) degrades to the
 *  offline responder instead of failing the request — important on free tiers. */
class ResilientProvider implements AiProvider {
  readonly name: string;
  constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider,
  ) {
    this.name = primary.name;
  }
  async complete(input: AiCompletion): Promise<string> {
    try {
      return await this.primary.complete(input);
    } catch {
      return this.fallback.complete(input);
    }
  }
}

/**
 * Deterministic offline fallback — used in tests and whenever no key is set, so
 * the feature degrades to something warm and useful instead of an error. Mirrors
 * the intents the mobile make's suggestion chips surface.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = "fake";
  complete(input: AiCompletion): Promise<string> {
    const last = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
    const t = last.toLowerCase();
    if (/(summar|cohort|catch|recap)/.test(t)) {
      return Promise.resolve(
        "Here's the gist of your cohort: reflections are due soon, there's an open thread to weigh in on, and a couple of people asked for prayer. Want me to draft your reflection?",
      );
    }
    if (/(encourage|draft|message|write|reply)/.test(t)) {
      return Promise.resolve(
        'How about: "Thinking of you today — may you sense God\'s nearness and strength. You\'re not walking this alone." Want me to send it to someone?',
      );
    }
    if (/(pray|prayer)/.test(t)) {
      return Promise.resolve(
        "I found an active prayer request worth joining today. Tap 🙏 on the Prayer Wall to stand with them.",
      );
    }
    if (/(quiet time|plan|devotion|read|rhythm)/.test(t)) {
      return Promise.resolve(
        "Let's build a gentle rhythm: 5 minutes of stillness, today's Psalm, and one verse to carry. Shall I add a morning reminder?",
      );
    }
    return Promise.resolve("I'm here with you ✨ Tell me a little more so I can help — summarize a chat, draft an encouragement, or plan your quiet time.");
  }
}

export function buildAiProvider(env: Env): AiProvider {
  const fake = new FakeAiProvider();
  // Prefer Groq (free, no billing), then Gemini; either is wrapped so rate-limits
  // / outages fall back to the offline responder rather than erroring.
  let primary: AiProvider | null = null;
  if (env.GROQ_API_KEY) primary = new GroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL);
  else if (env.GEMINI_API_KEY) primary = new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  return primary ? new ResilientProvider(primary, fake) : fake;
}
