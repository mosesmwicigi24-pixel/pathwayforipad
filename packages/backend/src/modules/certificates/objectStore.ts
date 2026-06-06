// Object storage seam for rendered certificate PDFs (spec §4.5 "object storage
// holds rendered certificate PDFs"). The S3/Cloudinary implementation drops in
// behind this interface; InMemoryObjectStore backs tests and first-run dev.
export interface ObjectStore {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Buffer>();
  put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, bytes);
    return Promise.resolve();
  }
  get(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
}
