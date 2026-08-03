// lib/heygen/heygenAuthProvider.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Implements the MCP SDK's OAuthClientProvider interface for an interactive
// user OAuth flow against HeyGen's remote MCP server. Persists dynamic
// client registration, tokens, and PKCE/CSRF state to the gitignored,
// HeyGen-only file store in heygenAuthStore.js. Never logs or returns
// secret values. Deliberately does not import anything from lib/openart/ —
// HeyGen and OpenArt auth state are fully isolated from each other.

import { randomBytes } from 'crypto';
import {
  getHeyGenAuthState,
  patchHeyGenAuthState,
} from './heygenAuthStore.js';

const CLIENT_NAME = 'Mika Mission Control';

export class HeyGenOAuthClientProvider {
  constructor(redirectUrl) {
    this._redirectUrl = redirectUrl;
    // Captured in-memory during the current request for immediate use by the
    // /api/production/providers/heygen/connect route — the same value is
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
    patchHeyGenAuthState({ pendingState: value, pendingStateCreatedAt: new Date().toISOString() });
    return value;
  }

  clientInformation() {
    return getHeyGenAuthState().clientInformation || undefined;
  }

  saveClientInformation(clientInformation) {
    patchHeyGenAuthState({ clientInformation });
  }

  tokens() {
    return getHeyGenAuthState().tokens || undefined;
  }

  saveTokens(tokens) {
    patchHeyGenAuthState({ tokens, connectedAt: new Date().toISOString(), lastError: null });
  }

  redirectToAuthorization(authorizationUrl) {
    const url = authorizationUrl.toString();
    this.lastAuthorizationUrl = url;
    patchHeyGenAuthState({ pendingAuthorizationUrl: url });
  }

  saveCodeVerifier(codeVerifier) {
    patchHeyGenAuthState({ codeVerifier });
  }

  codeVerifier() {
    const verifier = getHeyGenAuthState().codeVerifier;
    if (!verifier) throw new Error('No PKCE code verifier saved for the HeyGen OAuth session');
    return verifier;
  }

  saveDiscoveryState(discoveryState) {
    patchHeyGenAuthState({ discoveryState });
  }

  discoveryState() {
    return getHeyGenAuthState().discoveryState || undefined;
  }

  invalidateCredentials(scope) {
    const patch = {};
    if (scope === 'all' || scope === 'tokens')    patch.tokens = null;
    if (scope === 'all' || scope === 'client')    patch.clientInformation = null;
    if (scope === 'all' || scope === 'verifier')  patch.codeVerifier = null;
    if (scope === 'all' || scope === 'discovery') patch.discoveryState = null;
    patchHeyGenAuthState(patch);
  }
}
