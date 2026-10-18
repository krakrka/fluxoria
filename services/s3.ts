import { createHash, createHmac } from "crypto";
import { assertObjectKey, StorageError } from "@/lib/storage-error";

export type S3Target = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data).digest();
}

function encodePath(key: string) {
  return key.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export function s3ObjectUrl(target: S3Target, key: string) {
  const path = encodePath(key);
  if (target.endpoint) {
    const endpoint = target.endpoint.replace(/\/$/, "");
    return { url: `${endpoint}/${target.bucket}/${path}`, host: new URL(endpoint).host, canonicalUri: `/${target.bucket}/${path}` };
  }
  const host = `${target.bucket}.s3.${target.region}.amazonaws.com`;
  return { url: `https://${host}/${path}`, host, canonicalUri: `/${path}` };
}

export function signS3Request(input: {
  target: S3Target;
  method: "GET" | "PUT" | "DELETE";
  key: string;
  body?: Buffer;
  now?: Date;
}) {
  const location = s3ObjectUrl(input.target, input.key);
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = createHash("sha256").update(input.body ?? Buffer.alloc(0)).digest("hex");
  const headers = [
    ["host", location.host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  const canonicalHeaders = headers.map(([name, value]) => `${name}:${value}\n`).join("");
  const signedHeaders = headers.map(([name]) => name).join(";");
  const canonical = [input.method, location.canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${input.target.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.target.secretAccessKey}`, dateStamp), input.target.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return {
    url: location.url,
    headers: {
      host: location.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.target.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export function createS3Client(target: S3Target, fetchImpl: FetchImpl = fetch) {
  async function call(method: "GET" | "PUT" | "DELETE", key: string, body?: Buffer) {
    assertObjectKey(key);
    const signed = signS3Request({ target, method, key, body });
    let response: Response;
    try {
      response = await fetchImpl(signed.url, {
        method,
        headers: signed.headers,
        body: body ? new Uint8Array(body) : undefined,
      });
    } catch {
      throw new StorageError("Stockage indisponible.", "unavailable");
    }
    if (response.status === 404) throw new StorageError("Fichier introuvable.", "not_found");
    if (method === "DELETE") {
      if (response.status !== 200 && response.status !== 204) throw new StorageError("Stockage indisponible.", "unavailable");
      return response;
    }
    if (!response.ok) throw new StorageError("Stockage indisponible.", "unavailable");
    return response;
  }

  return {
    async put(key: string, body: Buffer) {
      await call("PUT", key, body);
    },
    async get(key: string) {
      const response = await call("GET", key);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete(key: string) {
      await call("DELETE", key);
    },
  };
}
