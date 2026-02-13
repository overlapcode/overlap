```
 ██████╗ ██╗   ██╗███████╗██████╗ ██╗      █████╗ ██████╗
██╔═══██╗██║   ██║██╔════╝██╔══██╗██║     ██╔══██╗██╔══██╗
██║   ██║██║   ██║█████╗  ██████╔╝██║     ███████║██████╔╝
██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║     ██╔══██║██╔═══╝
╚██████╔╝ ╚████╔╝ ███████╗██║  ██║███████╗██║  ██║██║
 ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝
```

> See where your team's heads are at.

Overlap is a **JSONL tracer + self-hosted dashboard** that tracks what you and your team are working on across Claude Code sessions, detects overlapping work, and displays a real-time timeline of team activity.

## Features

- **Real-time Activity Feed** - See what everyone's working on as it happens
- **Real-Time Coordination** - Your agent warns you before editing the same function a teammate is working on
- **Smart Overlap Detection** - Line-level and function-level matching catches conflicts early
- **Full History Backfill** - Sync all your historical sessions on first join
- **LLM-Powered Summaries** - AI summarizes what you're doing (BYOK)
- **Personal History** - Searchable timeline of all your sessions
- **Self-Hosted & Private** - Your data stays on your infrastructure
- **Zero Platform Cost** - Deploy to Cloudflare free tier

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEVELOPER MACHINE                             │
│                                                                  │
│   Claude Code → JSONL logs → Overlap Tracer → API sync          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE PAGES                               │
│   Dashboard + API endpoints + SSE streaming                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE D1                               │
│   team_config · repos · members · sessions · file_operations    │
└─────────────────────────────────────────────────────────────────┘
```

The **tracer binary** runs on your machine and parses Claude Code's local JSONL session logs, then syncs them to your self-hosted Overlap instance.

## Quick Start

### 1. Deploy the Dashboard

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/overlapcode/overlap)

Click to deploy Overlap to your Cloudflare account. The D1 database will be created automatically.

After deployment:
1. Visit your URL and go to `/setup`
2. Create your team (set name and dashboard password)
3. Add repositories to track in Settings → Repos

### 2. Install the Tracer

```bash
# macOS
brew install overlapdev/tap/overlap

# Linux
curl -fsSL https://overlap.dev/install.sh | sh
```

### 3. Join Your Team

```bash
# Join and backfill your full history
overlap join https://your-team.pages.dev

# Start the background sync daemon
overlap start
```

The tracer will:
- Prompt you for your user token (from `/join` page)
- Backfill all historical sessions for registered repos
- Watch for new sessions and sync them in real-time

### 4. Invite Team Members

Share your Overlap URL with team members. They can:
1. Visit `/join` and enter the team join code
2. Get their user token
3. Install the tracer and run `overlap join <url>`

## Tracer Commands

| Command | Description |
|---------|-------------|
| `overlap join <url>` | Join a team and backfill history |
| `overlap start` | Start background sync daemon |
| `overlap stop` | Stop the daemon |
| `overlap status` | Show sync status |
| `overlap sync` | Manual sync trigger |
| `overlap config` | View/edit configuration |

## Manual Deploy

```bash
# Clone and install
git clone https://github.com/overlapcode/overlap
cd overlap
npm install

# Build and deploy
npm run build
wrangler deploy

# Run database migrations
npm run db:migrate:remote
```

## LLM Providers

Configure an LLM provider for better activity summaries:

| Provider | Models | Cost |
|----------|--------|------|
| Heuristic | Path-based | Free |
| Anthropic | Claude Haiku 3.5, Sonnet 4 | $-$$ |
| OpenAI | GPT-4o, GPT-4o Mini | $-$$ |
| Google | Gemini 2.0 Flash | $ |
| xAI | Grok 2 | $$ |

Configure in Dashboard → Settings → LLM.

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run migrations locally
npm run db:migrate:local

# Type check
npm run typecheck

# Build
npm run build
```

## Project Structure

```
overlap/
├── src/
│   ├── pages/              # Astro pages
│   │   ├── api/v1/         # Versioned API endpoints
│   │   └── settings/       # Settings pages
│   ├── components/         # React components
│   └── lib/
│       ├── db/             # D1 queries & types
│       ├── llm/            # LLM providers
│       └── auth/           # Authentication
├── docs/
│   ├── API.md              # API documentation
│   └── TRACER_SPEC.md      # Tracer specification
├── migrations/
│   └── 001_initial.sql     # Database schema
└── wrangler.toml           # Cloudflare config
```

## Updating

### Update the Dashboard

Your forked repository can sync from upstream:
1. Go to your fork on GitHub
2. Click "Sync fork" → "Update branch"
3. Cloudflare auto-deploys the changes

### Update the Tracer

```bash
brew upgrade overlapdev/tap/overlap
```

### Check Version

Visit `https://your-instance.pages.dev/api/v1/version`

## License

MIT

## Links

- [GitHub](https://github.com/overlapcode/overlap)
- [Documentation](https://overlap.dev/docs)
- [Overlap](https://overlap.dev)
