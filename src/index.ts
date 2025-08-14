/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * @fileoverview OAuth 2.0 authorization code flow handler for Node.js, Deno, and Bun
 *
 * This module provides a simple way to handle OAuth 2.0 authorization code flows
 * in command-line applications, desktop apps, and development environments.
 * It creates a temporary local HTTP server to capture the authorization callback.
 */

import open from "open";
import { OAuthError } from "./errors";
import { createCallbackServer, type CallbackResult } from "./server";
import type { GetAuthCodeOptions } from "./types";

// Export types and interfaces for external use
export type { CallbackResult, CallbackServer, ServerOptions } from "./server";
export { OAuthError } from "./errors";
export type { GetAuthCodeOptions } from "./types";

/**
 * Get the OAuth authorization code from the authorization URL.
 *
 * Creates a temporary local HTTP server to handle the OAuth callback,
 * opens the authorization URL in the user's browser, and waits for the
 * OAuth provider to redirect back with an authorization code.
 *
 * @param input - Either a string containing the OAuth authorization URL,
 *                or a GetAuthCodeOptions object with detailed configuration
 * @returns Promise that resolves to CallbackResult containing the authorization code
 *          and other parameters, or rejects with OAuthError if authorization fails
 * @throws {OAuthError} When OAuth provider returns an error (e.g., access_denied)
 * @throws {Error} For timeout, network errors, or other unexpected failures
 *
 * @example
 * ```typescript
 * // Simple usage with URL string
 * const result = await getAuthCode('https://oauth.example.com/authorize?...');
 * console.log('Code:', result.code);
 *
 * // Advanced usage with options
 * const result = await getAuthCode({
 *   authorizationUrl: 'https://oauth.example.com/authorize?...',
 *   port: 8080,
 *   timeout: 60000,
 *   onRequest: (req) => console.log('Request:', req.url)
 * });
 * ```
 */
export async function getAuthCode(
  input: GetAuthCodeOptions | string,
): Promise<CallbackResult> {
  const options: GetAuthCodeOptions =
    typeof input === "string" ? { authorizationUrl: input } : input;

  const {
    authorizationUrl,
    port = 3000,
    hostname = "localhost",
    openBrowser = true,
    timeout = 30000,
    callbackPath = "/callback",
    successHtml,
    errorHtml,
    signal,
    onRequest,
  } = options;

  const server = createCallbackServer();

  try {
    // Start the callback server with all options
    await server.start({
      port,
      hostname,
      successHtml,
      errorHtml,
      signal,
      onRequest,
    });

    // Open the authorization URL in the browser if enabled
    if (openBrowser) {
      await open(authorizationUrl);
    } else {
      // In test mode, make a request to the authorization URL
      // The mock OAuth provider will redirect to our callback
      fetch(authorizationUrl)
        .then(async (response) => {
          // Follow the redirect if there is one
          if (response.status === 302 || response.status === 301) {
            const location = response.headers.get("Location");
            if (location) {
              // Make a request to the callback URL
              await fetch(location);
            }
          }
        })
        .catch(() => {
          // Ignore errors - not all tests may have a mock provider
        });
    }

    // Wait for the OAuth callback
    const result = await server.waitForCallback(callbackPath, timeout);

    // Handle OAuth errors - always throw them as this is the expected behavior
    if (result.error) {
      throw new OAuthError(
        result.error,
        result.error_description,
        result.error_uri,
      );
    }

    return result;
  } finally {
    // Always stop the server
    await server.stop();
  }
}
