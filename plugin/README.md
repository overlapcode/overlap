# Overlap Plugin for Claude Code

Track team activity and detect overlapping work across Claude Code sessions.

## Installation

In Claude Code, run:

```
/plugin marketplace add overlapcode/overlap
/plugin install overlap@overlapcode-overlap
```

### Development Installation

For local development, clone and use the `--plugin-dir` flag:

```bash
git clone https://github.com/overlapcode/overlap.git
claude --plugin-dir ./overlap/plugin
```

## Configuration

After installation, configure the plugin with your Overlap server:

```bash
/overlap:config
```

You'll need:
- **Server URL**: Your Overlap instance URL (e.g., `https://my-team.pages.dev`)
- **Team Token**: Get this from your team admin
- **User Token**: Your personal token from the join flow

Configuration is stored at `~/.claude/overlap/config.json`.

## Commands

| Command | Description |
|---------|-------------|
| `/overlap:config` | Configure server URL and tokens |
| `/overlap:status` | Show current session status |
| `/overlap:team` | Show team activity feed |
| `/overlap:history [days]` | Show your personal activity history |
| `/overlap:link` | Generate a magic link for web dashboard |
| `/overlap:whoami` | Show your user info |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/overlap:admin:users` | List all team members |
| `/overlap:admin:promote [name]` | Promote member to admin |
| `/overlap:admin:demote [name]` | Demote admin to member |
| `/overlap:admin:repos` | List tracked repositories |

## How It Works

The plugin uses Claude Code hooks to track your activity:

1. **SessionStart**: Registers your session when you start Claude Code
2. **PreToolUse**: Checks for overlapping work before file edits
3. **PostToolUse**: Reports file activity after edits
4. **SessionEnd**: Marks your session as ended

### Overlap Detection

When you're about to edit a file, the plugin checks if anyone else on your team is:
- Working on the same file
- Working in the same code area (e.g., "authentication", "payments")

If overlap is detected, you'll see a soft warning before the edit.

## Environment Variables

You can also configure via environment variables:

```bash
export OVERLAP_SERVER_URL="https://my-team.pages.dev"
export OVERLAP_TEAM_TOKEN="your-team-token"
export OVERLAP_USER_TOKEN="your-user-token"
```

Environment variables override the config file.

## Files

- `~/.claude/overlap/config.json` - Plugin configuration
- `~/.claude/overlap/sessions.json` - Session tracking (keyed by transcript path)

## Requirements

- Python 3.8+
- Claude Code with plugin support

## Troubleshooting

### "Not configured" errors

Run `/overlap:config` to set up your connection.

### Connection errors

1. Check your server URL is correct
2. Verify your tokens are valid
3. Ensure your Overlap server is running

### Hooks not firing

1. Restart Claude Code after installing the plugin
2. Check that hooks are enabled in your settings

## License

MIT
