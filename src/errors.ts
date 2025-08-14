/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Custom error class for OAuth-specific errors
 *
 * This error is thrown when the OAuth provider returns an error response
 * (e.g., user denies access, invalid client, etc.). It preserves the
 * original OAuth error details for proper error handling.
 */
export class OAuthError extends Error {
  /** OAuth error code (e.g., 'access_denied', 'invalid_request') */
  error: string;
  /** Human-readable error description provided by OAuth provider */
  error_description?: string;
  /** URI with additional information about the error */
  error_uri?: string;

  /**
   * Create a new OAuthError
   * @param error - OAuth error code
   * @param description - Human-readable error description
   * @param uri - URI with additional error information
   */
  constructor(error: string, description?: string, uri?: string) {
    super(description || error);
    this.name = "OAuthError";
    this.error = error;
    this.error_description = description;
    this.error_uri = uri;
  }
}

/**
 * Error thrown when OAuth callback times out
 *
 * This error indicates that no OAuth callback was received within the
 * specified timeout period. This could happen if the user doesn't complete
 * the authorization flow or if there are network connectivity issues.
 */
export class TimeoutError extends Error {
  /**
   * Create a new TimeoutError
   * @param message - Custom error message (optional)
   */
  constructor(message: string = "OAuth callback timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}
