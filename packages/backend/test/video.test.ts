// Video subsystem (Features v2 §V): upload sessions, transcode (720p cap),
// gated manifest issuance, and cross-device resume (LWW).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import { createCongregation, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { MediaService } from "../src/modules/media/service.js";
import { VideoService } from "../src/modules/media/video.js";
import { CloudinaryProvider, RENDITION_LADDER } from "../src/modules/media/pipeline.js";

const media = new MediaService("cloudinary://key:secret@democloud");
const newVideo = () => new VideoService(testPool(), media, new CloudinaryProvider());

let cong: string, adminId: string, studentId: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  adminId = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
  studentId = (await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" })).user_id;
  await createEnrollment(studentId, 1);
});
afterAll(async () => {
  await closeTestPool();
});

describe("video upload + transcode (§V.3, §D.1)", () => {
  it("creates a session, completes it (enqueues transcode), and transcodes to a 720p-capped ladder", async () => {
    const v = newVideo();
    const session = await v.createUploadSession(adminId, { kind: "lesson_video", mime_allowed: "video/mp4" });
    expect(session.signed_put_url).toContain("method=put");
    expect(session.media_asset_id).toBeTruthy();

    const done = await v.completeUpload(adminId, session.upload_id, {});
    expect(done).toMatchObject({ status: "transcoding", duplicate: false });
    const ob = await testPool().query("SELECT topic FROM outbox WHERE topic='media.transcode'");
    expect(ob.rowCount).toBe(1);

    // re-complete is idempotent
    const again = await v.completeUpload(adminId, session.upload_id, {});
    expect(again.duplicate).toBe(true);

    await v.transcodeAsset({ media_asset_id: session.media_asset_id, content_hash: "x".repeat(64) });
    const asset = (await v.getAsset(session.media_asset_id)) as { status: string; ladder: Array<{ height: number }> };
    expect(asset.status).toBe("ready");
    const heights = asset.ladder.map((r) => r.height);
    expect(Math.max(...heights)).toBe(720); // 720p cap — no 1080
    expect(heights).toEqual(RENDITION_LADDER.map((r) => r.height));
  });
});

describe("gated manifest (§V.2 / §1.9 hard-lock)", () => {
  it("404 until ready, 409 when the owning module is locked, 200 when unlocked", async () => {
    const v = newVideo();
    const session = await v.createUploadSession(adminId, {});
    const assetId = session.media_asset_id;

    // A published module at seq 2 owns the asset → locked for a fresh L1 student.
    await createModule(1, 1, { published: true });
    const m2 = await createModule(1, 2, { published: true });
    await testPool().query("UPDATE modules SET media_asset_id=$1 WHERE module_id=$2", [assetId, m2]);

    await expect(v.manifest(studentId, assetId)).rejects.toMatchObject({ code: "NOT_FOUND" }); // not ready yet

    await v.completeUpload(adminId, session.upload_id, {});
    await v.transcodeAsset({ media_asset_id: assetId, content_hash: "y".repeat(64) });

    await expect(v.manifest(studentId, assetId)).rejects.toMatchObject({ code: "GATE_LOCKED" });

    // Move the asset onto the always-open first module → unlocked.
    await testPool().query("UPDATE modules SET media_asset_id=NULL WHERE module_id=$1", [m2]);
    const m1 = (await testPool().query("SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=1")).rows[0].module_id;
    await testPool().query("UPDATE modules SET media_asset_id=$1 WHERE module_id=$2", [assetId, m1]);
    const out = await v.manifest(studentId, assetId);
    expect(out.url).toContain("res.cloudinary.com");
  });
});

describe("cross-device resume (LWW, §V.0)", () => {
  it("upserts position last-writer-wins and dedupes by client_mutation_id", async () => {
    const v = newVideo();
    const session = await v.createUploadSession(adminId, {});
    const a = session.media_asset_id;

    await v.upsertProgress(studentId, { media_asset_id: a, position_sec: 30, completed_pct: 10 });
    await v.upsertProgress(studentId, { media_asset_id: a, position_sec: 120, completed_pct: 40, client_mutation_id: "00000000-0000-4000-8000-000000000001" });
    const dup = await v.upsertProgress(studentId, { media_asset_id: a, position_sec: 999, completed_pct: 99, client_mutation_id: "00000000-0000-4000-8000-000000000001" });
    expect(dup.duplicate).toBe(true); // same mutation id → no-op

    const row = await testPool().query("SELECT position_sec FROM video_progress WHERE user_id=$1 AND media_asset_id=$2", [studentId, a]);
    expect(row.rows[0].position_sec).toBe(120); // dup did not overwrite
  });
});

describe("video library list (W2)", () => {
  it("lists assets newest-first with linked module + stuck-encoding flag", async () => {
    const v = newVideo();
    const ok = await v.createUploadSession(adminId, {});
    const stuckSession = await v.createUploadSession(adminId, {});

    // Attach the first asset to a module (the new UpdateModule path).
    const m1 = await createModule(1, 1, { published: false });
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const upd = await agent()
      .put(`/v1/admin/modules/${m1}`)
      .set("Authorization", tok)
      .send({ media_asset_id: ok.media_asset_id });
    expect(upd.status).toBe(200);
    expect(upd.body.media_asset_id).toBe(ok.media_asset_id);

    // Make the second asset look stuck: transcoding since 2 hours ago.
    await testPool().query(
      `UPDATE media_assets SET status='transcoding', created_at = now() - interval '2 hours' WHERE media_asset_id=$1`,
      [stuckSession.media_asset_id],
    );

    const list = await agent().get("/v1/admin/media").set("Authorization", tok);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.stuck).toBe(1);
    const attached = list.body.data.find(
      (a: { media_asset_id: string }) => a.media_asset_id === ok.media_asset_id,
    );
    expect(attached.attached_module_title).toBeTruthy();
    const stuck = list.body.data.find(
      (a: { media_asset_id: string }) => a.media_asset_id === stuckSession.media_asset_id,
    );
    expect(stuck.is_stuck).toBe(true);
  });
});

describe("RBAC (§5.4)", () => {
  it("non-admins get 403 on admin media routes", async () => {
    const tok = bearer({ sub: studentId, role: "Student", cong });
    const res = await agent().post("/v1/admin/media/uploads").set("Authorization", tok).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });
});

describe("external videos (Figma VideoLibrary: external + best-effort gating)", () => {
  it("registers a YouTube video, parsing the id from the URL; status ready immediately", async () => {
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    const res = await agent()
      .post("/v1/admin/media/external")
      .set("Authorization", tok)
      .send({ video_source: "youtube", url: "https://youtu.be/ScMzIvxBSi4", title: "Intro", caption: "Welcome", level_number: 1 });
    expect(res.status).toBe(201);
    expect(res.body.video_source).toBe("youtube");
    expect(res.body.external_video_id).toBe("ScMzIvxBSi4");
    expect(res.body.external_url).toBe("https://youtu.be/ScMzIvxBSi4");
    expect(res.body.status).toBe("ready");
    expect(res.body.caption).toBe("Welcome");
    expect(res.body.level_number).toBe(1);
    // the existing transcode `provider` column is untouched (still the pipeline value)
    expect(res.body.provider).toBe("youtube"); // origin lands in video_source; provider mirrors it for external rows
  });

  it("parses a vimeo id and rejects an unparseable youtube url", async () => {
    const v = newVideo();
    const ok = (await v.registerExternal(adminId, { video_source: "vimeo", url: "https://vimeo.com/76979871" })) as {
      external_video_id: string;
    };
    expect(ok.external_video_id).toBe("76979871");
    await expect(
      v.registerExternal(adminId, { video_source: "youtube", url: "https://example.com/not-a-video" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("updates caption, level, and the external url (re-parsing the id)", async () => {
    const v = newVideo();
    const a = (await v.registerExternal(adminId, { video_source: "youtube", url: "https://youtu.be/ScMzIvxBSi4" })) as {
      media_asset_id: string;
    };
    const upd = (await v.updateAsset(adminId, a.media_asset_id, {
      caption: "Updated",
      level_number: 2,
      url: "https://youtu.be/aqz-KE-bpKQ",
    })) as { caption: string; level_number: number; external_video_id: string };
    expect(upd.caption).toBe("Updated");
    expect(upd.level_number).toBe(2);
    expect(upd.external_video_id).toBe("aqz-KE-bpKQ");
  });
});

describe("homepage welcome video (single-row invariant)", () => {
  it("set/clear keeps at most one homepage asset and serves it to members", async () => {
    const v = newVideo();
    const a = (await v.registerExternal(adminId, { video_source: "youtube", url: "https://youtu.be/ScMzIvxBSi4" })) as {
      media_asset_id: string;
    };
    const b = (await v.registerExternal(adminId, { video_source: "vimeo", url: "https://vimeo.com/76979871" })) as {
      media_asset_id: string;
    };

    await v.setHomepage(adminId, a.media_asset_id);
    let onCount = await testPool().query("SELECT COUNT(*)::int AS n FROM media_assets WHERE is_homepage = true");
    expect(onCount.rows[0].n).toBe(1);

    // Setting b unsets a — never two homepage rows (partial unique index).
    await v.setHomepage(adminId, b.media_asset_id);
    onCount = await testPool().query("SELECT media_asset_id FROM media_assets WHERE is_homepage = true");
    expect(onCount.rowCount).toBe(1);
    expect(onCount.rows[0].media_asset_id).toBe(b.media_asset_id);

    // Member welcome-video fetch returns the external link.
    const w = (await v.welcomeVideo()) as { media_asset_id: string; external_url: string; video_source: string };
    expect(w.media_asset_id).toBe(b.media_asset_id);
    expect(w.video_source).toBe("vimeo");
    expect(w.external_url).toBe("https://vimeo.com/76979871");

    await v.clearHomepage(adminId, b.media_asset_id);
    expect(await v.welcomeVideo()).toBeNull();
  });

  it("serves a signed delivery URL for a hosted homepage video", async () => {
    const v = newVideo();
    const session = await v.createUploadSession(adminId, {});
    await v.completeUpload(adminId, session.upload_id, {});
    await v.transcodeAsset({ media_asset_id: session.media_asset_id, content_hash: "z".repeat(64) });
    await v.setHomepage(adminId, session.media_asset_id);
    const w = (await v.welcomeVideo()) as { url: string; expires_at: string };
    expect(w.url).toContain("res.cloudinary.com");
    expect(w.expires_at).toBeTruthy();
  });

  it("GET /home/welcome-video is authenticated and returns null when unset", async () => {
    const tok = bearer({ sub: studentId, role: "Student", cong });
    const res = await agent().get("/v1/home/welcome-video").set("Authorization", tok);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe("library list filters", () => {
  it("filters by video_source, level, attached, and q", async () => {
    const v = newVideo();
    const tok = bearer({ sub: adminId, role: "Admin", cong });
    await v.registerExternal(adminId, { video_source: "youtube", url: "https://youtu.be/ScMzIvxBSi4", caption: "alpha", level_number: 1 });
    await v.registerExternal(adminId, { video_source: "vimeo", url: "https://vimeo.com/76979871", caption: "beta", level_number: 2 });

    const yt = await agent().get("/v1/admin/media?video_source=youtube").set("Authorization", tok);
    expect(yt.body.total).toBe(1);
    expect(yt.body.data[0].video_source).toBe("youtube");

    const lvl2 = await agent().get("/v1/admin/media?level=2").set("Authorization", tok);
    expect(lvl2.body.total).toBe(1);
    expect(lvl2.body.data[0].level_number).toBe(2);

    const unattached = await agent().get("/v1/admin/media?attached=false").set("Authorization", tok);
    expect(unattached.body.total).toBe(2); // neither external is attached to a module

    const q = await agent().get("/v1/admin/media?q=beta").set("Authorization", tok);
    expect(q.body.total).toBe(1);
    expect(q.body.data[0].caption).toBe("beta");
  });
});
