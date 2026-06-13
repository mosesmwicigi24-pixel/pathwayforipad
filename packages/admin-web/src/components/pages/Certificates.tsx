// Certificates — rebuilt to the "Final Pathway Portal" make, wired to the live
// certificate API (ConfigApi.certificates / issueCertificate / revokeCertificate).
// Issued list, a rendered certificate preview with PDF print, public verification
// (matches a code against issued records), issue + revoke. The make's crypto
// "document hash" isn't stored in our model, so real verification fields are shown.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Award, Check, ChevronRight, Copy, Download, Hash, Loader2, Printer, Search, ShieldCheck, ShieldX, Stamp, X, RotateCcw, Plus } from "lucide-react";
import { ConfigApi, OpsApi, CurriculumApi, type CertificateRow, type MemberRow, type AdminLevel } from "../../api/client";
import { errorMessage } from "../../util/error";

const statusOf = (c: CertificateRow): "Valid" | "Revoked" => (c.revoked_at ? "Revoked" : "Valid");
const statusChip: Record<string, { bg: string; color: string }> = { Valid: { bg: "#E8F6EC", color: "#16A34A" }, Revoked: { bg: "#FDECEC", color: "#DC2626" } };
const fmtDate = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const initials = (n: string): string => n.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

function CertificateArt({ c, levelName }: { c: CertificateRow; levelName: string }): ReactElement {
  return (
    <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #FFFDF7 0%, #FBF4E2 100%)", border: "1px solid #E6D4A8", borderRadius: 14, padding: "6.4cqw 6.4cqw 5cqw", aspectRatio: "1.414 / 1", containerType: "inline-size" }}>
      <div className="absolute pointer-events-none" style={{ inset: "2.6cqw", border: "1px solid #C89B3C", borderRadius: 10 }} />
      <div className="absolute pointer-events-none" style={{ inset: "3.8cqw", border: "1px solid rgba(200,155,60,0.35)", borderRadius: 8 }} />
      <div className="relative flex flex-col items-center text-center h-full">
        <div className="flex items-center justify-center mb-[0.5cqw]" style={{ gap: "1.2cqw" }}>
          <Award style={{ width: "2.6cqw", height: "2.6cqw", color: "#C89B3C", flexShrink: 0 }} />
          <span style={{ fontSize: "2cqw", fontWeight: 700, color: "#7A5410", letterSpacing: "0.5cqw", textTransform: "uppercase", whiteSpace: "nowrap" }}>Nuru Pathway · Certificate of Completion</span>
        </div>
        <div style={{ width: "11cqw", height: 1, background: "#C89B3C", margin: "1.8cqw 0" }} />
        <div style={{ fontSize: "2.1cqw", color: "#7A5410", letterSpacing: "0.35cqw", textTransform: "uppercase", marginTop: "0.7cqw" }}>This is to certify that</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "6.4cqw", color: "#0B1F33", lineHeight: 1.1, marginTop: "2cqw", maxWidth: "100%" }}>{c.full_name}</div>
        <div style={{ fontSize: "2.1cqw", color: "#7A5410", marginTop: "2cqw", letterSpacing: "0.2cqw" }}>has faithfully completed</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "3.9cqw", color: "#0B1F33", lineHeight: 1.15, marginTop: "1cqw", maxWidth: "100%" }}>{c.level_number ? `Level ${c.level_number} — ${levelName}` : "the Pathway programme"}</div>
        <div className="flex items-end justify-between w-full mt-auto" style={{ gap: "2cqw", paddingTop: "4cqw" }}>
          <div className="text-left" style={{ minWidth: 0 }}>
            <div style={{ width: "25cqw", maxWidth: "100%", height: 1, background: "#0B1F33", marginTop: "0.7cqw" }} />
            <div style={{ fontSize: "1.8cqw", color: "#7A5410", textTransform: "uppercase", letterSpacing: "0.2cqw", marginTop: "0.7cqw" }}>Pastoral signature</div>
            <div style={{ fontSize: "2cqw", color: "#0B1F33", marginTop: "0.2cqw", whiteSpace: "nowrap" }}>Nuru Pathway</div>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <div className="rounded-full flex items-center justify-center" style={{ width: "12.8cqw", height: "12.8cqw", border: "2px solid #C89B3C", color: "#7A5410" }}>
              <div className="flex flex-col items-center"><Stamp style={{ width: "3.6cqw", height: "3.6cqw" }} /><span style={{ fontSize: "1.4cqw", fontWeight: 700, letterSpacing: "0.2cqw", marginTop: "0.2cqw" }}>SEALED</span></div>
            </div>
          </div>
          <div className="text-right" style={{ minWidth: 0 }}>
            <div style={{ fontSize: "1.8cqw", color: "#7A5410", textTransform: "uppercase", letterSpacing: "0.2cqw" }}>Issued</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "2.85cqw", color: "#0B1F33", marginTop: "0.3cqw", whiteSpace: "nowrap" }}>{fmtDate(c.issued_at)}</div>
            <div style={{ fontSize: "1.8cqw", color: "#7A5410", textTransform: "uppercase", letterSpacing: "0.2cqw", marginTop: "1.8cqw" }}>Verification code</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "2.3cqw", fontWeight: 700, color: "#0B1F33", letterSpacing: "0.15cqw", whiteSpace: "nowrap" }}>{c.verification_code}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Certificates(): ReactElement {
  const [certs, setCerts] = useState<CertificateRow[]>([]);
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [verifyInput, setVerifyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<null | { valid: boolean; cert?: CertificateRow }>(null);
  const [copied, setCopied] = useState(false);
  const [pdf, setPdf] = useState<CertificateRow | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await ConfigApi.certificates(); setCerts(r.data); setSelId((cur) => (r.data.some((c) => c.certificate_id === cur) ? cur : r.data[0]?.certificate_id ?? null)); }
    catch (e) { setError(errorMessage(e, "Could not load certificates.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void CurriculumApi.levels().then(setLevels).catch(() => {}); }, []);

  const levelName = useCallback((n: number | null): string => (n ? levels.find((l) => l.level_number === n)?.title ?? "" : ""), [levels]);
  const filtered = useMemo(() => certs.filter((c) => `${c.full_name} ${c.verification_code}`.toLowerCase().includes(query.toLowerCase())), [certs, query]);
  const selected = certs.find((c) => c.certificate_id === selId) ?? null;

  function runVerify(): void {
    if (!verifyInput.trim()) return;
    setVerifying(true); setResult(null);
    setTimeout(() => { const f = certs.find((c) => c.verification_code.toLowerCase() === verifyInput.trim().toLowerCase()); setResult({ valid: !!f && !f.revoked_at, ...(f ? { cert: f } : {}) }); setVerifying(false); }, 400);
  }
  async function revoke(c: CertificateRow): Promise<void> {
    const reason = window.prompt(`Revoke ${c.full_name}'s certificate? Enter a reason:`);
    if (!reason) return;
    try { await ConfigApi.revokeCertificate(c.certificate_id, reason); setNotice("Certificate revoked."); await load(); }
    catch (e) { setError(errorMessage(e, "Revoke failed.")); }
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100%", padding: "28px clamp(16px,4vw,40px)" }}>
      <div className="rounded-2xl overflow-hidden mb-6" style={{ background: "var(--nuru-dark)" }}>
        <div style={{ padding: "22px 28px 24px" }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Certificates</span></div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Award size={11} /> {certs.length} issued</span>
              <button onClick={() => setIssueOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Issue certificate</button>
            </div>
          </div>
        </div>
      </div>

      {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
      {notice ? <p style={{ color: "#0F6B33", marginBottom: 12 }}>{notice}</p> : null}

      <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(360px,1fr) minmax(440px,1.15fr)" }}>
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: "1px solid var(--border)" }}>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Issued certificates</div><div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{certs.length} on record</div></div>
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)", width: 220 }}><Search size={13} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Member or code" className="bg-transparent outline-none flex-1" style={{ fontSize: 12 }} /></div>
            </div>
            <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--secondary)" }}>{["Member", "Level", "Issued", "Code", "Status", ""].map((h) => <th key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((c) => { const st = statusOf(c); const sc = statusChip[st]!; const isSel = c.certificate_id === selId; return (
                  <tr key={c.certificate_id} onClick={() => setSelId(c.certificate_id)} style={{ borderTop: "1px solid var(--border)", background: isSel ? "var(--secondary)" : "transparent", borderLeft: isSel ? "3px solid var(--nuru-gold)" : "3px solid transparent", cursor: "pointer" }}>
                    <td style={{ padding: "12px 16px" }}><div className="flex items-center gap-2.5"><div className="rounded-lg flex items-center justify-center" style={{ width: 28, height: 28, background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{initials(c.full_name)}</div><span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{c.full_name}</span></div></td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--foreground)" }}>{c.level_number ? `L${c.level_number}` : "Program"}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{fmtDate(c.issued_at)}</td>
                    <td style={{ padding: "12px 16px" }}><code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--foreground)", letterSpacing: 0.5 }}>{c.verification_code}</code></td>
                    <td style={{ padding: "12px 16px" }}><span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: sc.bg, color: sc.color, fontSize: 11, fontWeight: 700 }}>● {st}</span></td>
                    <td style={{ padding: "12px 16px" }}>{st === "Valid" ? <button onClick={(e) => { e.stopPropagation(); void revoke(c); }} className="rounded-lg px-2.5 py-1.5" style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5", fontSize: 11, fontWeight: 600 }}><RotateCcw size={11} /></button> : null}</td>
                  </tr>
                ); })}
                {filtered.length === 0 ? <tr><td colSpan={6} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No certificates match.</td></tr> : null}
              </tbody>
            </table></div>
          </div>

          {/* Public verification */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ background: "var(--nuru-navy)", color: "#fff" }}><div className="flex items-center gap-2"><ShieldCheck size={16} style={{ color: "var(--nuru-gold)" }} /><div><div style={{ fontSize: 13, fontWeight: 700 }}>Public verification</div><div style={{ fontSize: 11, color: "rgba(232,239,245,0.7)" }}>How members and employers verify a certificate</div></div></div></div>
            <div className="p-6">
              <label style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Enter verification code</label>
              <div className="flex items-stretch gap-2 mt-2">
                <div className="flex items-center gap-2 rounded-xl px-3 flex-1" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}><Hash size={14} style={{ color: "var(--muted-foreground)" }} /><input value={verifyInput} onChange={(e) => { setVerifyInput(e.target.value.toUpperCase()); if (result) setResult(null); }} onKeyDown={(e) => e.key === "Enter" && runVerify()} placeholder="NURU-…" className="flex-1 bg-transparent outline-none py-3" style={{ fontFamily: "var(--font-mono)", fontSize: 14, letterSpacing: 1 }} /></div>
                <button onClick={runVerify} disabled={verifying} className="flex items-center gap-2 rounded-xl px-5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none" }}>{verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Verify</button>
              </div>
              {certs.length > 0 ? <div className="flex flex-wrap items-center gap-2 mt-3"><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Try:</span>{certs.slice(0, 3).map((c) => <button key={c.certificate_id} onClick={() => { setVerifyInput(c.verification_code); setResult(null); }} className="rounded-md px-2 py-0.5" style={{ background: "var(--secondary)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--foreground)" }}>{c.verification_code}</button>)}</div> : null}
              {result ? (
                <div className="mt-5 rounded-xl p-4 flex items-start gap-3" style={{ background: result.valid ? "#F0FDF4" : "#FEF2F2", border: result.valid ? "1px solid #A8E0B8" : "1px solid #FCA5A5" }}>
                  <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 40, height: 40, background: result.valid ? "#16A34A" : "#DC2626", color: "#fff" }}>{result.valid ? <ShieldCheck size={20} /> : <ShieldX size={20} />}</div>
                  <div className="flex-1">
                    <div style={{ fontSize: 14, fontWeight: 700, color: result.valid ? "#15803D" : "#B91C1C" }}>{result.valid ? "Valid certificate" : result.cert ? "Certificate revoked" : "No certificate found"}</div>
                    {result.cert ? <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
                      <Row label="Name" value={result.cert.full_name} /><Row label="Level" value={result.cert.level_number ? `L${result.cert.level_number} · ${levelName(result.cert.level_number)}` : "Program"} /><Row label="Issued" value={fmtDate(result.cert.issued_at)} /><Row label="Code" value={result.cert.verification_code} mono />
                    </div> : <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 4 }}>This code does not match any certificate on record.</div>}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex flex-col gap-4">
          {selected ? (
            <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-4">
                <div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Preview</div><div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)", marginTop: 2 }}>{selected.full_name}</div></div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { navigator.clipboard?.writeText(selected.verification_code); setCopied(true); setTimeout(() => setCopied(false), 1400); }} className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}>{copied ? <Check size={13} style={{ color: "#16A34A" }} /> : <Copy size={13} />} {copied ? "Copied" : "Copy code"}</button>
                  <button onClick={() => setPdf(selected)} className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Download size={13} /> PDF</button>
                </div>
              </div>
              <CertificateArt c={selected} levelName={levelName(selected.level_number)} />
            </div>
          ) : <div className="rounded-2xl p-12 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted-foreground)" }}>Select a certificate to preview.</div>}
        </div>
      </div>

      {pdf ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center" style={{ background: "rgba(11,31,51,0.62)", padding: 32, overflowY: "auto" }} onClick={() => setPdf(null)}>
          <style>{`@media print { body * { visibility: hidden !important; } #cert-print, #cert-print * { visibility: visible !important; } #cert-print { position: fixed !important; inset: 0 !important; padding: 24px !important; background: #fff !important; } @page { size: A4 landscape; margin: 0; } }`}</style>
          <div className="w-full flex items-center justify-between mb-3" style={{ maxWidth: 960 }} onClick={(e) => e.stopPropagation()}>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{pdf.full_name} — certificate</span>
            <div className="flex items-center gap-2"><button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-xl px-4 py-2" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none" }}><Printer size={14} /> Save as PDF</button><button onClick={() => setPdf(null)} className="flex items-center justify-center rounded-xl" style={{ width: 36, height: 36, background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)" }}><X size={16} /></button></div>
          </div>
          <div id="cert-print" className="w-full rounded-2xl" style={{ maxWidth: 960, background: "#fff", padding: 24 }} onClick={(e) => e.stopPropagation()}><CertificateArt c={pdf} levelName={levelName(pdf.level_number)} /></div>
        </div>
      ) : null}

      {issueOpen ? <IssueModal levels={levels} onClose={() => setIssueOpen(false)} onDone={async (name) => { setIssueOpen(false); setNotice(`Certificate issued to ${name}.`); await load(); }} onError={setError} /> : null}
    </div>
  );
}

function IssueModal({ levels, onClose, onDone, onError }: { levels: AdminLevel[]; onClose: () => void; onDone: (name: string) => void; onError: (m: string) => void }): ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const [picked, setPicked] = useState<MemberRow | null>(null);
  const [level, setLevel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => { if (query.trim()) void OpsApi.members({ search: query.trim() }).then((r) => setResults(r.data.slice(0, 8))).catch(() => setResults([])); else setResults([]); }, 250); return () => clearTimeout(t); }, [query]);
  async function issue(): Promise<void> {
    if (!picked) return;
    setBusy(true);
    try { await ConfigApi.issueCertificate({ user_id: picked.user_id, level_number: level ? Number(level) : null }); onDone(picked.full_name); }
    catch (e) { onError(errorMessage(e, "Could not issue certificate.")); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 520, maxHeight: "88vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}><div><div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Award size={12} /> ISSUE</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 21, color: "var(--foreground)", marginTop: 2 }}>Issue a certificate</h2></div><button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button></div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          {picked ? (
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--secondary)" }}>
              <div className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 700 }}>{initials(picked.full_name)}</div>
              <div className="flex-1"><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{picked.full_name}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{picked.cell_name ?? "—"} · L{picked.current_level ?? "—"}</div></div>
              <button onClick={() => setPicked(null)} style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>Change</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-lg" style={{ height: 42, background: "var(--input-background)", border: "1px solid var(--border)", padding: "0 12px" }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
              <div className="flex flex-col gap-1.5" style={{ maxHeight: 220, overflowY: "auto" }}>{results.map((m) => <button key={m.user_id} onClick={() => setPicked(m)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-left" style={{ border: "1px solid var(--border)", background: "var(--card)" }}><div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{initials(m.full_name)}</div><span style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{m.full_name}</span></button>)}</div>
            </>
          )}
          <div><label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>Level</label>
            <select value={level} onChange={(e) => setLevel(e.target.value)} style={{ width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 12px", color: "var(--foreground)", outline: "none" }}><option value="">Full programme</option>{levels.map((l) => <option key={l.level_number} value={l.level_number}>Level {l.level_number} — {l.title}</option>)}</select>
          </div>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void issue()} disabled={!picked || busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: !picked ? "var(--muted)" : "var(--nuru-gold)", color: !picked ? "var(--muted-foreground)" : "#fff", fontSize: 13, fontWeight: 600, border: "none" }}><Award size={14} /> Issue</button></div>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): ReactElement {
  return <div><div style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", fontFamily: mono ? "var(--font-mono)" : undefined, letterSpacing: mono ? 0.5 : undefined }}>{value}</div></div>;
}
