# Security policy

## Report a vulnerability

Report a vulnerability privately through GitHub. Open the repository's **Security** tab and select **Report a vulnerability**. Do not open a public issue for a security problem.

Include the affected file or endpoint, the steps to reproduce it, and the impact you expect. You will get a reply within 7 days.

## Scope

- The MCP server at `https://mcp.meltvalue.dev/mcp` and its code under `server/`.
- The Claude plugin under `plugin/`.
- The GitHub Actions workflows under `.github/`.

Rate-limit tests are in scope. Load tests and denial-of-service tests against the hosted server are not.

## Supported versions

Only the latest commit on `main` and the server it deploys are supported.
