# OAuth Callback Examples

This directory contains example implementations demonstrating how to use the `oauth-callback` library in different scenarios.

## Available Examples

### 🎭 Demo (`demo.ts`)

A self-contained demonstration with a built-in mock OAuth server. Perfect for understanding how the library works without any external setup.

**Features:**

- Mock OAuth authorization server
- Dynamic client registration simulation
- Multiple scenarios (success, error, invalid scope)
- Custom HTML templates
- No credentials required

**Run:**

```bash
bun run example:demo

# Without browser (for CI/testing)
bun run examples/demo.ts --no-browser
```

### 🐙 GitHub OAuth (`github.ts`)

A real-world example showing OAuth integration with GitHub.

**Features:**

- Complete OAuth 2.0 authorization code flow
- Token exchange implementation
- API usage with access token
- User profile fetching

**Setup:**

1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Set callback URL to `http://localhost:3000/callback`
3. Export credentials:
   ```bash
   export GITHUB_CLIENT_ID="your_client_id"
   export GITHUB_CLIENT_SECRET="your_client_secret"
   ```

**Run:**

```bash
bun run example:github
```

## Adding More Examples

To add a new OAuth provider example:

1. Create a new file (e.g., `google.ts`, `microsoft.ts`)
2. Follow the structure from `github.ts`
3. Add a script to `package.json`:
   ```json
   "example:provider": "bun run examples/provider.ts"
   ```
4. Update this README with setup instructions

## Common Patterns

All examples demonstrate:

- Starting a local callback server
- Opening the authorization URL in a browser
- Capturing the authorization code
- Handling OAuth errors
- Custom success/error pages

## Testing

Run all examples in non-interactive mode:

```bash
# Demo (no browser)
bun run examples/demo.ts --no-browser

# GitHub (requires credentials)
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy bun run examples/github.ts
```
