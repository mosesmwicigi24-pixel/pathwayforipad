// Reflection-review queue (spec §1.9 rule 3). A pastor approves/rejects pending
// reflections; approval advances the member's level server-side and triggers the
// certificate (the portal only records the decision).
import { useEffect, useState, type ReactElement } from "react";
import { PortalApi, type ReviewItem } from "../api/client";

export function ReviewQueue(): ReactElement {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setError(null);
    try {
      setItems(await PortalApi.reviews());
    } catch {
      setError("Could not load the review queue.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function decide(reviewId: string, decision: "approve" | "reject"): Promise<void> {
    setBusy(reviewId);
    try {
      await PortalApi.decideReview(reviewId, decision);
      setItems((prev) => prev.filter((i) => i.review_id !== reviewId));
    } catch {
      setError("Decision failed — you may be out of scope for this member.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2>Pending reflections</h2>
      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      {items.length === 0 ? <p style={{ color: "#6b7280" }}>Queue is clear.</p> : null}
      {items.map((r) => (
        <article key={r.review_id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ fontWeight: 600 }}>
            {r.full_name ?? r.user_id} · Level {r.level_number}
          </div>
          <p style={{ whiteSpace: "pre-wrap", color: "#374151" }}>{r.reflection_text}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={busy === r.review_id} onClick={() => void decide(r.review_id, "approve")}>
              Approve
            </button>
            <button type="button" disabled={busy === r.review_id} onClick={() => void decide(r.review_id, "reject")}>
              Reject
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
