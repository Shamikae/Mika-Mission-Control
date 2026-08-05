// lib/higgsfield/higgsfieldAuthProvider.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Implements the MCP SDK's OAuthClientProvider interface for an interactive
// user OAuth flow against Higgsfield's remote MCP server. Persists dynamic
// client registration, tokens, and PKCE/CSRF state to the gitignored,
// Higgsfield-only file store in higgsfieldAuthStore.js. Never logs or
// returns secret values. Deliberately does not import anything from
// lib/heygen/ or lib/openart/ — every provider's auth state is fully
// isolated from the others.

import { randomBytes } from 'crypto';
import {
  getHiggsfieldAuthState,
  patchHiggsfieldAuthState,
} from './higgsfieldAuthStore.js';

const CLIENT_NAME = 'Mika Mission Control';

export class HiggsfieldOAuthClientProvider {
  constructor(redirectUrl) {
    this._redirectUrl = redirectUrl;
    // Captured in-memory during the current request for immediate use by the
    // /api/production/providers/higgsfield/connect route — the same value is
    // also persisted, but the provider interface itself has no return
    // channel for the authorization URL.
    this.lastAuthorizationUrl = null;
  }

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata() {
    return {
      redirect_uris:              [this._redirectUrl],
      client_name:                CLIENT_NAME,
      grant_types:                ['authorization_code', 'refresh_token'],
      response_types:             ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state() {
    const value = randomBytes(32).toString('hex');
    patchHiggsfieldAuthState({ pendingState: value, pendingStateCreatedAt: new Date().toISOString() });
    return value;
  }

  clientInformation() {
    return getHiggsfieldAuthState().clientInformation || undefined;
  }

  saveClientInformation(clientInformation) {
    patchHiggsfieldAuthState({ clientInformation });
  }

  tokens() {
    return getHiggsfieldAuthState().tokens || undefined;
  }

  saveTokens(tokens) {
    patchHiggsfieldAuthState({ tokens, connectedAt: new Date().toISOString(), lastError: null });
  }

  redirectToAuthorization(authorizationUrl) {
    const url = authorizationUrl.toString();
    this.lastAuthorizationUrl = url;
    patchHiggsfieldAuthState({ pendingAuthorizationUrl: url });
  }

  saveCodeVerifier(codeVerifier) {
    patchHiggsfieldAuthState({ codeVerifier });
  }

  codeVerifier() {
    const verifier = getHiggsfieldAuthState().codeVerifier;
    if (!verifier) throw new Error('No PKCE code verifier saved for the Higgsfield OAuth session');
    return verifier;
  }

  saveDiscoveryState(discoveryState) {
    patchHiggsfieldAuthState({ discoveryState });
  }

  discoveryState() {
    return getHiggsfieldAuthState().discoveryState || undefined;
  }

  invalidateCredentials(scope) {
    const patch = {};
    if (scope === 'all' || scope === 'tokens')    patch.tokens = null;
    if (scope === 'all' || scope === 'client')    patch.clientInformation = null;
    if (scope === 'all' || scope === 'verifier')  patch.codeVerifier = null;
    if (scope === 'all' || scope === 'discovery') patch.discoveryState = null;
    patchHiggsfieldAuthState(patch);
  }
}
