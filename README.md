# pkp-mcp

A local [MCP](https://modelcontextprotocol.io) server for Polish train timetables, built on the
[PKP PLK Open Data API](https://pdp-api.plk-sa.pl/). Works with Claude Code and Codex.

> Work in progress. Available now: `find_station`. Coming next: connection search (with transfers),
> station boards and live train details.

Data source: **PKP Polskie Linie Kolejowe S.A.**

## Requirements

- Node.js 22.13 or newer
- A free API key from <https://pdp-api.plk-sa.pl/> (Basic tier: 100 requests/hour, 1,000/day)

## Install (from a local clone)

```sh
git clone https://github.com/V3RON/pkp-mcp.git
cd pkp-mcp
pnpm install
pnpm build
```

### Claude Code

```sh
claude mcp add pkp --scope user -e PKP_API_KEY=<your key> -- node /absolute/path/to/pkp-mcp/dist/index.js
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.pkp]
command = "node"
args = ["/absolute/path/to/pkp-mcp/dist/index.js"]
env = { PKP_API_KEY = "<your key>" }
tool_timeout_sec = 120
```

Codex starts MCP servers with a minimal environment, so the key must be set in `env` here.

Keep the key in these client config files (they live in your home directory) or in a local `.env`
(git-ignored). Never commit it.

## Configuration

| Variable | Purpose |
|---|---|
| `PKP_API_KEY` | API key (required for data) |
| `PKP_MCP_CACHE_DIR` | Cache location (default: `~/.cache/pkp-mcp`, `~/Library/Caches/pkp-mcp` on macOS, `%LOCALAPPDATA%\pkp-mcp\Cache` on Windows) |
| `PKP_MCP_LOG=debug` | Verbose logs on stderr |

Behind an HTTP proxy, also set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses `HTTPS_PROXY`.

## Caching

Responses are cached in a SQLite file shared by every client on the machine, so repeated questions do
not use up the request quota. The station and city catalogue (2 requests) is kept for 30 days.

## CLI

```sh
node dist/index.js status            # cache and request usage
node dist/index.js status --remote   # also asks the API about your key
node dist/index.js clear-cache
```

## Development

```sh
pnpm test        # unit and end-to-end tests (no API key needed)
pnpm typecheck
pnpm lint
pnpm gen:api     # regenerate src/api/generated.ts from docs/api/openapi.json
```
