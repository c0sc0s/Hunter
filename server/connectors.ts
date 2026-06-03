import type { ConnectorDefinition, ConnectorProvider, ConnectorRecord, ConnectorUpdateInput, ConnectorView } from "../shared/types";

export const connectorDefinitions: ConnectorDefinition[] = [
  {
    provider: "feishu",
    label: "Feishu / Lark",
    sourceTypes: ["feishu"],
    authMode: "oauth",
    availability: "available",
    capabilities: [
      "OAuth user authorization",
      "Direct docx raw-content import",
      "Wiki docx raw-content import",
      "Access-token refresh before sync",
      "Permission-aware refresh (next)"
    ],
    setupMessage:
      "OAuth, encrypted token refresh, and manual docx/wiki raw-content import are available when Feishu app credentials are configured. Browser snapshot capture remains the fallback for unsupported Feishu surfaces."
  },
  {
    provider: "x",
    label: "X",
    sourceTypes: ["tweet"],
    authMode: "oauth",
    availability: "planned",
    capabilities: ["Bookmark import", "Thread refresh", "Author metadata", "Private bookmark sync"],
    setupMessage: "OAuth connector is planned. Public oEmbed, selected-text capture, and browser snapshots remain the current fallback."
  }
];

export function listConnectorViews(records: ConnectorRecord[]): ConnectorView[] {
  const recordsByProvider = new Map(records.map((record) => [record.provider, record]));

  return connectorDefinitions.map((definition) => {
    const record = recordsByProvider.get(definition.provider);
    return {
      ...definition,
      connectionState: record?.connectionState ?? "not_connected",
      accountLabel: record?.accountLabel,
      connectedAt: record?.connectedAt,
      lastSyncAt: record?.lastSyncAt,
      lastError: record?.lastError,
      updatedAt: record?.updatedAt
    };
  });
}

export function isConnectorProvider(value: string): value is ConnectorProvider {
  return connectorDefinitions.some((definition) => definition.provider === value);
}

export function getConnectorDefinition(provider: ConnectorProvider): ConnectorDefinition {
  const definition = connectorDefinitions.find((candidate) => candidate.provider === provider);
  if (!definition) {
    throw new Error(`Unknown connector provider: ${provider}`);
  }
  return definition;
}

export function buildConnectorRecord(provider: ConnectorProvider, input: ConnectorUpdateInput, previous?: ConnectorView): ConnectorRecord {
  const now = new Date().toISOString();
  const connectionState = input.connectionState ?? previous?.connectionState ?? "not_connected";
  const isDisconnected = connectionState === "not_connected";
  const isConnected = connectionState === "connected";

  return {
    provider,
    connectionState,
    accountLabel: isDisconnected ? undefined : cleanOptional(input.accountLabel ?? previous?.accountLabel),
    connectedAt: isConnected ? (previous?.connectedAt ?? now) : undefined,
    lastSyncAt: isDisconnected ? undefined : (input.lastSyncAt ?? previous?.lastSyncAt),
    lastError: isConnected || isDisconnected ? cleanOptional(input.lastError) : cleanOptional(input.lastError ?? previous?.lastError),
    updatedAt: now
  };
}

export function buildDisconnectedConnectorRecord(provider: ConnectorProvider): ConnectorRecord {
  return {
    provider,
    connectionState: "not_connected",
    updatedAt: new Date().toISOString()
  };
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
