// lib/openart/openartAuthProvider.js
// SERVER-SIDE ONLY. Never import from client components.
//
// Implements the MCP SDK's OAuthClientProvider interface for an interactive
// user OAuth flow against OpenArt's MCP server. Persists dynamic client
// registration, tokens, and PKCE/CSRF state to the gitignored file store in
// openartAuthStore.js. Never logs or returns secret values.

import { randomBytes } from 'crypto';
import {
  getOpenArtAuthState,
  patchOpenArtAuthState,
} from './openartAuthStore.js';

const CLIENT_NAME = 'Mika Mission Control';

export class OpenArtOAuthClientProvider {
  constructor(redirectUrl) {
    this._redirectUrl = redirectUrl;
    // Captured in-memory during the current request for immediate use by the
    // /api/openart/connect route — the same value is also persisted, but the
    // provider interface itself has no return channel for the authorization URL.
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
    patchOpenArtAuthState({ pendingState: value });
    return value;
  }

  clientInformation() {
    return getOpenArtAuthState().clientInformation || undefined;
  }

  saveClientInformation(clientInformation) {
    patchOpenArtAuthState({ clientInformation });
  }

  tokens() {
    return getOpenArtAuthState().tokens || undefined;
  }

  saveTokens(tokens) {
    patchOpenArtAuthState({ tokens, connectedAt: new Date().toISOString() });
  }

  redirectToAuthorization(authorizationUrl) {
    const url = authorizationUrl.toString();
    this.lastAuthorizationUrl = url;
    patchOpenArtAuthState({ pendingAuthorizationUrl: url });
  }

  saveCodeVerifier(codeVerifier) {
    patchOpenArtAuthState({ codeVerifier });
  }

  codeVerifier() {
    const verifier = getOpenArtAuthState().codeVerifier;
    if (!verifier) throw new Error('No PKCE code verifier saved for the OpenArt OAuth session');
    return verifier;
  }

  saveDiscoveryState(discoveryState) {
    patchOpenArtAuthState({ discoveryState });
  }

  discoveryState() {
    return getOpenArtAuthState().discoveryState || undefined;
  }

  invalidateCredentials(scope) {
    const patch = {};
    if (scope === 'all' || scope === 'tokens')    patch.tokens = null;
    if (scope === 'all' || scope === 'client')    patch.clientInformation = null;
    if (scope === 'all' || scope === 'verifier')  patch.codeVerifier = null;
    if (scope === 'all' || scope === 'discovery') patch.discoveryState = null;
    patchOpenArtAuthState(patch);
  }
}
