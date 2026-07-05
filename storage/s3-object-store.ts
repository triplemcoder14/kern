import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "./config";
import type { ObjectStore } from "./object-store";

function streamToString(body: unknown): Promise<string> {
  if (!body) {
    return Promise.resolve("");
  }
  if (typeof body === "string") {
    return Promise.resolve(body);
  }
  if (body instanceof Uint8Array) {
    return Promise.resolve(new TextDecoder().decode(body));
  }
  const stream = body as AsyncIterable<Uint8Array>;
  return (async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  })();
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly rootPrefix: string;

  constructor(config: NonNullable<StorageConfig["s3"]>) {
    this.bucket = config.bucket;
    this.rootPrefix = config.prefix ? `${config.prefix}/` : "";
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private objectKey(key: string): string {
    return `${this.rootPrefix}${key.replace(/^\/+/, "")}`;
  }

  async readText(key: string): Promise<string | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
        }),
      );
      return await streamToString(response.Body);
    } catch {
      return null;
    }
  }

  async writeText(key: string, body: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: "application/json; charset=utf-8",
      }),
    );
  }

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.objectKey(prefix),
          ContinuationToken: continuationToken,
        }),
      );

      for (const item of response.Contents ?? []) {
        if (!item.Key) {
          continue;
        }
        const trimmed = item.Key.slice(this.rootPrefix.length);
        keys.push(trimmed);
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }

  async deleteKey(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
      }),
    );
  }
}
