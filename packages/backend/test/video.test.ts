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

describe("RBAC (§5.4)", () => {
  it("non-admins get 403 on admin media routes", async () => {
    const tok = bearer({ sub: studentId, role: "Student", cong });
    const res = await agent().post("/v1/admin/media/uploads").set("Authorization", tok).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
  });
});
