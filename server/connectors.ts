import type { ConnectorDefinition, ConnectorProvider, ConnectorRecord, ConnectorView } from "../shared/types";

export const connectorDefinitions: ConnectorDefinition[] = [
  {
    provider: "feishu",
    label: "Feishu / Lark",
    sourceTypes: ["feishu"],
    authMode: "oauth",
    availability: "planned",
    capabilities: ["Document block import", "Wiki page import", "Image and attachment sync", "Permission-aware refresh"],
    setupMessage: "OAuth connector is planned. Browser snapshot capture remains the current fallback for visible content."
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
