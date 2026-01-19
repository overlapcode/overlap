```
 ██████╗ ██╗   ██╗███████╗██████╗ ██╗      █████╗ ██████╗
██╔═══██╗██║   ██║██╔════╝██╔══██╗██║     ██╔══██╗██╔══██╗
██║   ██║██║   ██║█████╗  ██████╔╝██║     ███████║██████╔╝
██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║     ██╔══██║██╔═══╝
╚██████╔╝ ╚████╔╝ ███████╗██║  ██║███████╗██║  ██║██║
 ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝
```

> See where your team's heads are at.

Overlap is a **Claude Code plugin + self-hosted cloud service** that tracks what you and your team are working on across Claude Code sessions, detects overlapping work, and displays a real-time timeline of team activity.

## Features

- **Real-time Activity Feed** - See what everyone's working on as it happens
- **Smart Overlap Detection** - File-level and semantic matching catches related work
- **LLM-Powered Summaries** - AI summarizes what you're doing (BYOK)
- **Personal History** - Searchable timeline of all your sessions
- **Self-Hosted & Private** - Your data stays on your infrastructure
- **Zero Platform Cost** - Deploy to Cloudflare free tier

## Prerequisites

The Claude Code plugin requires **Python 3.7+** installed on your machine. Check with:

```bash
python3 --version
```

## Quick Start

### Option A: One-Click Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/overlapcode/overlap)

Click the button above to deploy Overlap to your Cloudflare account. The D1 database and KV namespace will be created automatically.

After deployment, visit your URL and go to `/setup` to create your team.

### Option B: Manual Deploy

```bash
# Clone and install
git clone https://github.com/overlapcode/overlap
cd overlap
npm install

# Build and deploy (D1/KV auto-created on first deploy)
npm run build
wrangler deploy

# Run database migrations
wrangler d1 execute overlap-db --remote --file=migrations/001_initial.sql
```

### 2. Set Up Your Team

1. Visit your deployed URL (e.g., `https://overlap.<account>.workers.dev`)
2. Go to `/setup` to create your team
3. Save the team token and your user token

### 3. Install the Claude Code Plugin

In Claude Code, run:

```
/plugin marketplace add overlapcode/overlap
/plugin install overlap@overlap
```

That's it - no cloning required.

#### Enable for All Projects (Optional)

By default, the plugin installs with project scope. To use Overlap across all projects on your machine, edit `~/.claude/plugins/installed_plugins.json`:

1. Find the `"overlap@overlap"` entry
2. Change `"scope": "local"` to `"scope": "user"`
3. Remove the `"projectPath"` line
4. Restart Claude Code

### 4. Configure the Plugin

Run `/overlap:config` in Claude Code and enter:
- Your Overlap server URL
- Team token
- User token

### 5. Start Coding

That's it! Your activity will now be tracked. Use these commands:

| Command | Description |
|---------|-------------|
| `/overlap:team` | See team activity |
| `/overlap:status` | Check connection |
| `/overlap:history` | Your personal timeline |
| `/overlap:link` | Get dashboard access link |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLAUDE CODE PLUGIN                           │
│   hooks/hooks.json → scripts/*.py → API calls                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE WORKERS                            │
│   Astro + React frontend │ API endpoints │ SSE streaming       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLOUDFLARE D1                              │
│   teams · users · devices · repos · sessions · activity        │
└─────────────────────────────────────────────────────────────────┘
```

## LLM Providers

Configure an LLM provider for better activity classification:

| Provider | Models | Cost |
|----------|--------|------|
| Heuristic | Path-based | Free |
| Anthropic | Claude 3.5 Haiku, Sonnet, Opus | $-$$$ |
| OpenAI | GPT-4o, GPT-4o Mini | $-$$ |
| Google | Gemini 2.0 Flash, 1.5 Pro | $-$$ |
| xAI | Grok 2 | $-$$ |

Configure in Settings → LLM Classification.

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
├── src/                    # Astro frontend + API
│   ├── pages/              # Routes + API endpoints
│   │   └── api/v1/         # API endpoints
│   ├── components/         # React components
│   └── lib/                # Utilities
├── plugin/                 # Claude Code plugin
│   ├── .claude-plugin/     # Plugin manifest
│   ├── hooks/              # Hook configuration
│   ├── scripts/            # Python hook scripts
│   └── commands/           # Slash commands
├── migrations/             # D1 schema
└── wrangler.toml           # Cloudflare config
```

## API Endpoints

### User Endpoints
- `POST /api/v1/sessions/start` - Start a session
- `POST /api/v1/sessions/:id/heartbeat` - Report activity
- `POST /api/v1/sessions/:id/end` - End a session
- `POST /api/v1/check` - Check for overlaps
- `GET /api/v1/activity` - Get team activity
- `GET /api/v1/users/me` - Get current user
- `GET /api/v1/users/me/timeline` - Get personal timeline
- `POST /api/v1/magic-link` - Generate magic link
- `GET /api/v1/stream` - SSE activity stream

### Admin Endpoints
- `GET /api/v1/admin/users` - List users
- `PUT /api/v1/admin/users/:id` - Update user
- `GET /api/v1/admin/repos` - List repos
- `PUT /api/v1/admin/repos/:id` - Update repo
- `PUT /api/v1/admin/team` - Update team settings
- `PUT /api/v1/admin/llm` - Update LLM settings
- `GET /api/v1/version` - Get version info

## Updating

### Update the Plugin

In Claude Code, run:

```
/plugin update overlap@overlapcode-overlap
```

### Update the Service

**Automatic Updates:** Your cloned repository includes a GitHub Action that automatically syncs from upstream daily. When updates are available, they're merged and Cloudflare auto-deploys them. No action needed!

**Manual sync:** If you want to update immediately:
1. Go to your cloned repo on GitHub
2. Click **Actions** → **Sync from Upstream** → **Run workflow**

**Disable auto-updates:** If you prefer manual control, go to Actions → Sync from Upstream → ⋯ → Disable workflow

### Check Current Version

Visit `https://your-instance.workers.dev/api/v1/version` to see your deployed version.

## License

MIT

## Links

- [GitHub](https://github.com/overlapcode/overlap)
- [Overlap](https://overlap.dev)
