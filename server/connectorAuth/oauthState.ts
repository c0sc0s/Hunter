import type { ConnectorProvider } from "../../shared/types";

type OAuthState = {
  provider: ConnectorProvider;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: string;
};

const stateTtlMs = 10 * 60 * 1000;
const states = new Map<string, OAuthState>();

export class OAuthStateError extends Error {}

export function storeOAuthState(input: Omit<OAuthState, "expiresAt">): OAuthState {
  sweepExpiredStates();
  const state = {
    ...input,
    expiresAt: new Date(Date.now() + stateTtlMs).toISOString()
  };
  states.set(state.state, state);
  return state;
}

export function consumeOAuthState(provider: ConnectorProvider, stateValue: string): OAuthState {
  sweepExpiredStates();
  const state = states.get(stateValue);
  states.delete(stateValue);
  if (!state || state.provider !== provider) {
    throw new OAuthStateError("OAuth state is invalid or expired");
  }
  return state;
}

function sweepExpiredStates(): void {
  const now = new Date().toISOString();
  for (const [key, state] of states) {
    if (state.expiresAt <= now) {
      states.delete(key);
    }
  }
}
