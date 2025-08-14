#!/usr/bin/env bun
/* SPDX-FileCopyrightText: 2025-present Kriasoft */
/* SPDX-License-Identifier: MIT */

/**
 * Example OAuth flow using Notion MCP server with Dynamic Client Registration.
 *
 * This example demonstrates:
 * - Dynamic Client Registration (no pre-configured client ID/secret needed)
 * - Integration with Model Context Protocol (MCP) servers
 * - Using the MCP SDK's OAuth capabilities with streamable HTTP transport
 *
 * Usage:
 *   bun run example:notion
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth as mcpAuth } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getAuthCode, OAuthError } from "../src/index";

/**
 * Simple in-memory OAuth provider implementation for Notion MCP
 */
class NotionOAuthProvider implements OAuthClientProvider {
  private clientInfo?: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _state = crypto.randomUUID();
  private authorizationCode?: string;

  get redirectUrl() {
    return "http://localhost:3000/callback";
  }

  get clientMetadata() {
    return {
      client_name: "OAuth Callback Example",
      redirect_uris: ["http://localhost:3000/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "read write",
    };
  }

  async state() {
    return this._state;
  }

  async clientInformation() {
    return this.clientInfo;
  }

  async saveClientInformation(info: OAuthClientInformationFull) {
    this.clientInfo = info;
    console.log("✅ Dynamic client registration successful!");
    console.log("   Client ID:", info.client_id);
  }

  async tokens() {
    return this._tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this._tokens = tokens;
    console.log("✅ Tokens saved successfully!");
    console.log(
      "   Access Token:",
      tokens.access_token.substring(0, 20) + "...",
    );
    if (tokens.refresh_token) {
      console.log(
        "   Refresh Token:",
        tokens.refresh_token.substring(0, 20) + "...",
      );
    }
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    console.log("\n📋 Authorization URL:", authorizationUrl.toString());
    console.log("\n⏳ Opening browser for authorization...");
    console.log("   (If browser doesn't open, visit the URL above manually)\n");

    try {
      const result = await getAuthCode({
        authorizationUrl: authorizationUrl.toString(),
        port: 3000,
        timeout: 60000,
        onRequest: (req) => {
          const url = new URL(req.url);
          console.log(`📨 Received ${req.method} request to ${url.pathname}`);
        },
      });

      console.log("\n✅ Authorization callback received!");
      console.log("   Code:", result.code);
      console.log("   State:", result.state);

      // Store the authorization code for the auth flow to use
      this.authorizationCode = result.code;

      console.log("\n🔄 Exchanging authorization code for access token...");
    } catch (error) {
      if (error instanceof OAuthError) {
        console.error("\n❌ OAuth authorization failed");
        console.error("   Error:", error.error);
        if (error.error_description) {
          console.error("   Description:", error.error_description);
        }
        if (error.error_uri) {
          console.error("   More info:", error.error_uri);
        }
      } else if (error instanceof Error) {
        console.error("\n❌ Error:", error.message);
      } else {
        console.error("\n❌ Unexpected error:", error);
      }
      throw error;
    }
  }

  async saveCodeVerifier(verifier: string) {
    this._codeVerifier = verifier;
  }

  async codeVerifier() {
    if (!this._codeVerifier) {
      throw new Error("Code verifier not set");
    }
    return this._codeVerifier;
  }

  // Helper to provide authorization code to the auth flow
  async getAuthorizationCode() {
    const code = this.authorizationCode;
    this.authorizationCode = undefined;
    return code;
  }
}

async function main() {
  console.log("🚀 Starting OAuth flow example with Notion MCP Server\n");
  console.log("This example demonstrates Dynamic Client Registration:");
  console.log("- No pre-configured client ID or secret required");
  console.log("- Automatic registration with the authorization server");
  console.log("- Integration with Model Context Protocol\n");

  const authProvider = new NotionOAuthProvider();
  const serverUrl = new URL("https://mcp.notion.com/mcp");

  try {
    console.log("🔌 Starting OAuth authentication flow...");

    // Perform the OAuth flow
    const authResult = await mcpAuth(authProvider, {
      serverUrl,
      authorizationCode: await authProvider.getAuthorizationCode(),
      fetchFn: fetch,
    });

    if (authResult === "REDIRECT") {
      // Second attempt with the authorization code
      const code = await authProvider.getAuthorizationCode();
      if (code) {
        const secondResult = await mcpAuth(authProvider, {
          serverUrl,
          authorizationCode: code,
          fetchFn: fetch,
        });

        if (secondResult === "AUTHORIZED") {
          console.log(
            "\n🎉 Successfully authenticated with Notion MCP server!",
          );

          // Now connect to the MCP server
          const transport = new StreamableHTTPClientTransport(serverUrl, {
            authProvider,
          });

          const client = new Client(
            {
              name: "oauth-callback-example",
              version: "1.0.0",
            },
            {
              capabilities: {},
            },
          );

          await client.connect(transport);

          // List available tools
          console.log("\n🔧 Fetching available tools...");
          const tools = await client.listTools();

          if (tools.tools && tools.tools.length > 0) {
            console.log("\n📝 Available tools:");
            for (const tool of tools.tools) {
              console.log(`   - ${tool.name}: ${tool.description}`);
            }
          } else {
            console.log("   No tools available");
          }

          // List available resources
          console.log("\n📚 Fetching available resources...");
          const resources = await client.listResources();

          if (resources.resources && resources.resources.length > 0) {
            console.log("\n📂 Available resources:");
            for (const resource of resources.resources) {
              console.log(`   - ${resource.uri}: ${resource.name}`);
            }
          } else {
            console.log("   No resources available");
          }

          // Clean disconnect
          await client.close();
          console.log("\n✨ OAuth flow completed successfully!");
        }
      }
    } else if (authResult === "AUTHORIZED") {
      console.log("\n🎉 Already authorized with Notion MCP server!");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      console.log(
        "\n⚠️  Authorization required. Please check the browser for the authorization page.",
      );
    } else {
      console.error("\n❌ Failed to authenticate:", error);
    }
    process.exit(1);
  }
}

// Run the example
main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
