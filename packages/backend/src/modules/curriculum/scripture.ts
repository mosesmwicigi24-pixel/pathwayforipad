// Scripture passages (spec §3.3). Fetched server-side from YouVersion and
// HTML-stripped before returning, so the client never calls the IdP-keyed API
// directly and never renders raw markup. Behind a provider interface for testing;
// fails closed with 503 when YOUVERSION_APP_KEY is absent.
import type { Redis } from "ioredis";
import { ApiError } from "../../http/errors.js";
import type { Env } from "../../config/env.js";
import { cacheGetSet, cacheKeys } from "../../cache.js";

export interface ScripturePassage {
  reference: string;
  version: string;
  language: string;
  text: string;
}

export interface ScriptureProvider {
  fetch(input: { ref: string; version: string; language: string }): Promise<ScripturePassage>;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class YouVersionProvider implements ScriptureProvider {
  constructor(
    private readonly appKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetch(input: { ref: string; version: string; language: string }): Promise<ScripturePassage> {
    const url =
      `https://developers.youversionapi.com/1.0/passages?` +
      `reference=${encodeURIComponent(input.ref)}&version=${encodeURIComponent(input.version)}` +
      `&language_ranges=${encodeURIComponent(input.language)}`;
    const res = await this.fetchImpl(url, {
      headers: { "x-youversion-developer-token": this.appKey, accept: "application/json" },
    });
    if (!res.ok) {
      if (res.status === 404) throw new ApiError("NOT_FOUND", "Passage not found");
      throw new ApiError("UPSTREAM_UNAVAILABLE", "Scripture provider error", { status: res.status });
    }
    const json = (await res.json()) as { passages?: Array<{ content?: string }>; content?: string };
    const raw = json.passages?.[0]?.content ?? json.content ?? "";
    return { reference: input.ref, version: input.version, language: input.language, text: stripHtml(raw) };
  }
}

class NotConfiguredScriptureProvider implements ScriptureProvider {
  fetch(): Promise<ScripturePassage> {
    return Promise.reject(new ApiError("UPSTREAM_UNAVAILABLE", "Scripture is not configured"));
  }
}

export function buildScriptureProvider(env: Env, fetchImpl?: typeof fetch): ScriptureProvider {
  if (env.YOUVERSION_APP_KEY) {
    return fetchImpl
      ? new YouVersionProvider(env.YOUVERSION_APP_KEY, fetchImpl)
      : new YouVersionProvider(env.YOUVERSION_APP_KEY);
  }
  return new NotConfiguredScriptureProvider();
}

// Scripture text never changes for a given ref+version+language, so we cache it for
// a month — turning a slow external YouVersion round-trip into a Redis hit.
const SCRIPTURE_TTL_SECONDS = 30 * 24 * 60 * 60;

export class ScriptureService {
  constructor(
    private readonly provider: ScriptureProvider,
    private readonly languageRanges: string,
    private readonly redis?: Redis | undefined,
  ) {}

  async passage(ref: string, version?: string, language?: string): Promise<ScripturePassage> {
    if (!ref) throw new ApiError("VALIDATION_FAILED", "ref is required");
    const lang = language ?? this.languageRanges.split(";")[0] ?? "en";
    const ver = version ?? "";
    return cacheGetSet(this.redis, cacheKeys.scripture(ref, ver, lang), SCRIPTURE_TTL_SECONDS, () =>
      this.provider.fetch({ ref, version: ver, language: lang }),
    );
  }
}
