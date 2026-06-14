// Direct-to-storage upload (§4.5). The raw bytes never pass through our API:
// the server brokers a signed Cloudinary PUT URL, and we stream the local file
// straight to it. Used for chat image/voice attachments.
export async function uploadToSignedUrl(uploadUrl: string, fileUri: string, contentType: string): Promise<void> {
  const fileRes = await fetch(fileUri);
  const blob = await fileRes.blob();
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
}
