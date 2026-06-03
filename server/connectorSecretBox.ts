import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import path from "node:path";

const secretPath = path.resolve("data", "huntter-connector-secret.key");
const algorithm = "aes-256-gcm";

let cachedKey: Buffer | undefined;

export function sealConnectorSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, resolveSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", toBase64Url(iv), toBase64Url(tag), toBase64Url(encrypted)].join(".");
}

export function openConnectorSecret(sealed: string): string {
  const [version, iv, tag, encrypted] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported connector secret format");
  }

  const decipher = createDecipheriv(algorithm, resolveSecretKey(), fromBase64Url(iv));
  decipher.setAuthTag(fromBase64Url(tag));
  return Buffer.concat([decipher.update(fromBase64Url(encrypted)), decipher.final()]).toString("utf8");
}

function resolveSecretKey(): Buffer {
  if (cachedKey) return cachedKey;

  const configured = process.env.HUNTTER_CONNECTOR_SECRET_KEY?.trim();
  if (configured) {
    cachedKey = createHash("sha256").update(configured, "utf8").digest();
    return cachedKey;
  }

  mkdirSync(path.dirname(secretPath), { recursive: true });
  if (!existsSync(secretPath)) {
    writeFileSync(secretPath, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
  }

  cachedKey = createHash("sha256").update(readFileSync(secretPath, "utf8").trim(), "utf8").digest();
  return cachedKey;
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
