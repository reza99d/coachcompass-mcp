# CoachCompass MCP server

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server for the [CoachCompass](https://coachcompass.co) coach directory. One remote server powers:

- **ChatGPT app**: interactive coach cards via MCP Apps / the Apps SDK
- **Claude connector**: claude.ai, Claude Desktop and mobile; the same coach cards render as an MCP App
- **Claude Code plugin**: this repo is a plugin marketplace

**Endpoint:** `https://coachcompass.co/mcp` (Streamable HTTP, stateless, no authentication)

## Install

**Claude (claude.ai / Desktop):** Settings → Connectors → *Add custom connector* → URL `https://coachcompass.co/mcp`.

**ChatGPT:** Settings → Apps → *Create* (developer mode) → MCP server URL `https://coachcompass.co/mcp`, authentication *None*.

**Claude Code:**
```
/plugin marketplace add reza99d/coachcompass-mcp
/plugin install coachcompass@coachcompass
```
or just the server: `claude mcp add --transport http coachcompass https://coachcompass.co/mcp`

## Tools

All tools are read-only (`readOnlyHint: true`) and only return information coaches have published on their public profile.

| Tool | What it does |
|---|---|
| `search_coaches` | Search by free text, category, country, city, languages, specialties, max hourly rate, experience, verified. Renders coach cards. |
| `get_coach` | One coach's full public profile: bio, services and prices, rating, podcasts/videos, profile and booking links. Renders a profile card. |
| `get_coach_availability` | Open booking slots for the next 1–14 days in the user's timezone (coaches who book via CoachCompass), otherwise their booking link. |
| `count_coaches` | How many coaches match a set of filters. |
| `list_directory_facets` | Available categories, countries and languages with counts. |
| `get_featured_coaches` | Coaches featured on the homepage. Renders coach cards. |
| `search_articles` | CoachCompass articles and FAQs about coaching. |

## Privacy & security

- No sign-in, no conversation data; the server only receives each tool call's arguments. See the [privacy policy](https://coachcompass.co/legal/ai-app-privacy) and [terms](https://coachcompass.co/legal/ai-app-terms).
- Talks to the CoachCompass API as an anonymous caller (published rows only) and requests an explicit public-column allowlist; private coach fields (email, phone, address…) are never requested or returned, which the tests enforce.
- Coach-written text is capped and labelled as untrusted data; URLs are restricted to http(s); the widget renders with `textContent` only and a CSP that allows images from coachcompass.co and nothing else.
- Per-client rate limiting (hashed IP, in memory), request size limits, Host-header validation, and a hardened, unprivileged systemd service.

Support: support@coachcompass.co

## Development

```bash
npm ci
npm run build          # widget bundle + TypeScript
npm test               # unit + contract + adversarial tests (fake upstream)
CC_API_BASE=https://coachcompass.co/api PORT=8791 npm start   # run locally against the live public API
```

Deploy: `deploy/cc-mcp-deploy.sh`, an idempotent, test-gated deploy with automatic rollback (see the header of the script). To remove: `deploy/cc-mcp-uninstall.sh`.

## License

MIT
