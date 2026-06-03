import { createHash, randomBytes } from "node:crypto";
import type { ConnectorMutationResponse, ConnectorOAuthStartResponse, ConnectorProvider } from "../../shared/types";
import { buildConnectorRecord } from "../connectors";
import { sealConnectorSecret } from "../connectorSecretBox";
import type { ConnectorCredentialRecord, LibraryRepository } from "../repositories/types";
import { consumeOAuthState, storeOAuthState } from "./oauthState";

const provider: ConnectorProvider = "feishu";
const authorizeUrl = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const tokenUrl = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const userInfoUrl = "https://open.feishu.cn/open-apis/authen/v1/user_info";
const defaultScopes = ["offline_access", "docx:document:readonly"];

type FeishuOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
};

type FeishuTokenData = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
};

type FeishuUserInfoData = {
  name?: string;
  en_name?: string;
  email?: string;
  union_id?: string;
  open_id?: string;
};

export class ConnectorConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`Feishu OAuth is not configured: missing ${missing.join(", ")}`);
  }
}

export function startFeishuOAuth(origin: string): ConnectorOAuthStartResponse {
  const config = getFeishuOAuthConfig(origin);
  const stateValue = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const oauthState = storeOAuthState({
    provider,
    state: stateValue,
    codeVerifier,
    redirectUri: config.redirectUri
  });

  const url = new URL(authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", oauthState.state);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    provider,
    authorizationUrl: url.toString(),
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    state: oauthState.state,
    expiresAt: oauthState.expiresAt
  };
}

export async function completeFeishuOAuth(
  code: string,
  stateValue: string,
  repository: LibraryRepository
): Promise<ConnectorMutationResponse> {
  const oauthState = consumeOAuthState(provider, stateValue);
  const config = getFeishuOAuthConfig(new URL(oauthState.redirectUri).origin);
  const token = await exchangeAuthorizationCode(config, code, oauthState.codeVerifier, oauthState.redirectUri);
  const accountLabel = await fetchAccountLabel(token.accessToken);
  const now = new Date().toISOString();

  await repository.upsertConnectorCredential(buildCredentialRecord(token, now));

  const previous = (await repository.listConnectors()).find((connector) => connector.provider === provider);
  const connectorRecord = buildConnectorRecord(
    provider,
    {
      connectionState: "connected",
      accountLabel
    },
    previous
  );
  await repository.upsertConnector(connectorRecord);

  const connector = (await repository.listConnectors()).find((candidate) => candidate.provider === provider);
  if (!connector) {
    throw new Error("Feishu connector was not available after OAuth completion");
  }
  return { connector };
}

function getFeishuOAuthConfig(origin: string): FeishuOAuthConfig {
  const missing: string[] = [];
  const clientId = process.env.HUNTTER_FEISHU_CLIENT_ID?.trim();
  const clientSecret = process.env.HUNTTER_FEISHU_CLIENT_SECRET?.trim();
  if (!clientId) missing.push("HUNTTER_FEISHU_CLIENT_ID");
  if (!clientSecret) missing.push("HUNTTER_FEISHU_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new ConnectorConfigError(missing);

  return {
    clientId,
    clientSecret,
    redirectUri: process.env.HUNTTER_FEISHU_REDIRECT_URI?.trim() || `${origin}/api/connectors/feishu/oauth/callback`,
    scopes: parseScopes(process.env.HUNTTER_FEISHU_SCOPES)
  };
}

async function exchangeAuthorizationCode(
  config: FeishuOAuthConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });

  const payload = await parseJsonResponse(response, "Feishu OAuth token exchange failed");
  const data = readTokenData(payload);
  if (!data.access_token) {
    throw new Error("Feishu OAuth token response did not include an access token");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type ?? "Bearer",
    scope: data.scope,
    accessTokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
    refreshTokenExpiresAt: data.refresh_expires_in ? new Date(Date.now() + data.refresh_expires_in * 1000).toISOString() : undefined
  };
}

async function fetchAccountLabel(accessToken: string): Promise<string> {
  const response = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const payload = await parseJsonResponse(response, "Feishu user info request failed");
  const data = readUserInfoData(payload);
  return data.name || data.en_name || data.email || data.union_id || data.open_id || "Feishu account";
}

function buildCredentialRecord(
  token: {
    accessToken: string;
    refreshToken?: string;
    tokenType: string;
    scope?: string;
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
  },
  updatedAt: string
): ConnectorCredentialRecord {
  return {
    provider,
    accessTokenCiphertext: sealConnectorSecret(token.accessToken),
    refreshTokenCiphertext: token.refreshToken ? sealConnectorSecret(token.refreshToken) : undefined,
    tokenType: token.tokenType,
    scope: token.scope,
    accessTokenExpiresAt: token.accessTokenExpiresAt,
    refreshTokenExpiresAt: token.refreshTokenExpiresAt,
    updatedAt
  };
}

async function parseJsonResponse(response: Response, context: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${context}: HTTP ${response.status} ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text) as unknown;
  const errorMessage = readFeishuError(payload);
  if (errorMessage) {
    throw new Error(`${context}: ${errorMessage}`);
  }
  return payload;
}

function readTokenData(payload: unknown): FeishuTokenData {
  const object = asRecord(payload);
  return asRecord(object.data ?? payload) as FeishuTokenData;
}

function readUserInfoData(payload: unknown): FeishuUserInfoData {
  const object = asRecord(payload);
  return asRecord(object.data ?? payload) as FeishuUserInfoData;
}

function readFeishuError(payload: unknown): string | undefined {
  const object = asRecord(payload);
  const code = object.code;
  if (typeof code === "number" && code !== 0) {
    return typeof object.msg === "string" ? object.msg : `Feishu error code ${code}`;
  }
  if (typeof object.error === "string") {
    return typeof object.error_description === "string" ? object.error_description : object.error;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function parseScopes(value: string | undefined): string[] {
  const scopes = value?.split(/[,\s]+/).filter(Boolean);
  return scopes?.length ? scopes : defaultScopes;
}

function randomToken(byteLength: number): string {
  return base64Url(randomBytes(byteLength));
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}
