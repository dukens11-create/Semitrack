import { createHash, createHmac } from "node:crypto";
export class DocumentError extends Error {
  constructor(public code: string, public httpStatus = 400) {
    super(code);
  }
}
export interface PrivateObjectStorage {
  readonly configured: boolean;
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  remove(key: string): Promise<void>;
  download(key: string, filename: string, seconds: number): Promise<string>;
}
export const storageUnavailable: PrivateObjectStorage = {
  configured: false,
  async put() {
    throw new DocumentError("DOCUMENT_STORAGE_NOT_CONFIGURED", 503);
  },
  async remove() {
    throw new DocumentError("DOCUMENT_STORAGE_NOT_CONFIGURED", 503);
  },
  async download() {
    throw new DocumentError("DOCUMENT_STORAGE_NOT_CONFIGURED", 503);
  },
};
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();
export function assertStorageKey(key: string) {
  if (!/^documents\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key))
    throw new DocumentError("DOCUMENT_OBJECT_KEY_INVALID");
}
export type S3DocumentConfig = {
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
};
/** Private AWS S3 objects. Clients never choose an object key or upload URL. */
export class S3DocumentStorage implements PrivateObjectStorage {
  readonly configured = true;
  constructor(
    private config: S3DocumentConfig,
    private request: typeof fetch = fetch
  ) {
    if (
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket) ||
      !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(config.region) ||
      !config.accessKey ||
      !config.secretKey
    )
      throw new DocumentError("DOCUMENT_STORAGE_CONFIG_INVALID", 503);
  }
  sign(
    method: "PUT" | "GET" | "DELETE" | "HEAD",
    key: string,
    seconds: number,
    extra: Record<string, string> = {},
    now = new Date(),
    headers: Record<string, string> = {}
  ) {
    assertStorageKey(key);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
      throw new DocumentError("DOCUMENT_LINK_EXPIRY_INVALID");
    const c = this.config,
      date = now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
      day = date.slice(0, 8),
      scope = day + "/" + c.region + "/s3/aws4_request",
      host = c.bucket + ".s3." + c.region + ".amazonaws.com",
      uri = "/" + key.split("/").map(encode).join("/");
    const canonicalHeaders = Object.entries({ host, ...headers })
      .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")])
      .sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0));
    const signedHeaders = canonicalHeaders.map(([k]) => k).join(";");
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": c.accessKey + "/" + scope,
      "X-Amz-Date": date,
      "X-Amz-Expires": String(seconds),
      "X-Amz-SignedHeaders": signedHeaders,
      ...extra,
    };
    if (c.sessionToken) query["X-Amz-Security-Token"] = c.sessionToken;
    const canonical = Object.entries(query)
      .map(([k, v]) => [encode(k), encode(v)])
      .sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))
      .map(([k, v]) => k + "=" + v)
      .join("&");
    const request = [
      method,
      uri,
      canonical,
      canonicalHeaders.map(([k, v]) => k + ":" + v + "\n").join(""),
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = ["AWS4-HMAC-SHA256", date, scope, hash(request)].join(
      "\n"
    );
    const signingKey = hmac(
      hmac(hmac(hmac("AWS4" + c.secretKey, day), c.region), "s3"),
      "aws4_request"
    );
    return (
      "https://" +
      host +
      uri +
      "?" +
      canonical +
      "&X-Amz-Signature=" +
      hmac(signingKey, stringToSign).toString("hex")
    );
  }
  async put(key: string, bytes: Buffer, mime: string) {
    try {
      const checksum = createHash("sha256").update(bytes).digest("base64");
      const headers = {
        "content-type": mime,
        "content-length": String(bytes.length),
        "x-amz-server-side-encryption": "AES256",
        "x-amz-checksum-sha256": checksum,
        "if-none-match": "*",
      };
      const result = await this.request(
        this.sign("PUT", key, 120, {}, new Date(), headers),
        {
          method: "PUT",
          redirect: "error",
          signal: AbortSignal.timeout(60000),
          headers,
          body: bytes as unknown as BodyInit,
        }
      );
      await result.body?.cancel();
      if (result.status === 412) {
        const checkHeaders = { "x-amz-checksum-mode": "ENABLED" };
        const check = await this.request(
          this.sign("HEAD", key, 120, {}, new Date(), checkHeaders),
          {
            method: "HEAD",
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            headers: checkHeaders,
          }
        );
        await check.body?.cancel();
        if (
          !check.ok ||
          check.headers.get("content-length") !== String(bytes.length) ||
          check.headers.get("x-amz-checksum-sha256") !== checksum
        )
          throw new Error();
      } else if (!result.ok) throw new Error();
    } catch {
      throw new DocumentError("DOCUMENT_UPLOAD_FAILED", 503);
    }
  }
  async remove(key: string) {
    try {
      const r = await this.request(this.sign("DELETE", key, 120), {
        method: "DELETE",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      await r.body?.cancel();
      if (!r.ok && r.status !== 404) throw new Error();
    } catch {
      throw new DocumentError("DOCUMENT_CLEANUP_PENDING", 503);
    }
  }
  async download(key: string, filename: string, seconds: number) {
    return this.sign("GET", key, seconds, {
      "response-content-disposition":
        "attachment; filename=\"document\"; filename*=UTF-8''" +
        encode(filename),
      "response-cache-control": "private, no-store",
    });
  }
}
export function configuredDocumentStorage(
  env: NodeJS.ProcessEnv = process.env
): PrivateObjectStorage {
  if (
    env.DOCUMENT_STORAGE_PROVIDER !== "s3" ||
    env.DOCUMENT_STORAGE_PRIVATE_CONFIRMED !== "true"
  )
    return storageUnavailable;
  const {
    DOCUMENT_S3_BUCKET: bucket,
    DOCUMENT_S3_REGION: region,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_SESSION_TOKEN: sessionToken,
  } = env;
  if (!bucket || !region || !accessKey || !secretKey) return storageUnavailable;
  return new S3DocumentStorage({
    bucket,
    region,
    accessKey,
    secretKey,
    sessionToken,
  });
}
