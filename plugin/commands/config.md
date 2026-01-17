---
description: Configure the Overlap plugin with your server URL and tokens
---

# Configure Overlap

Help the user configure the Overlap plugin. You need to collect:

1. **Server URL**: The URL of their Overlap instance (e.g., `https://my-team.pages.dev`)
2. **Team Token**: The team token provided by their admin
3. **User Token**: The user's personal token

## Steps

1. Ask the user for their Overlap server URL
2. Ask for their team token
3. Ask for their user token
4. Save the configuration to `~/.overlap/config.json`

## Save Configuration

Create the config file with this structure:

```json
{
  "server_url": "<server_url>",
  "team_token": "<team_token>",
  "user_token": "<user_token>"
}
```

The file should be saved at: `~/.overlap/config.json`

Make sure to create the `~/.overlap` directory if it doesn't exist.

## After Configuration

Confirm the configuration was saved and let the user know they can:
- Start a new session to begin tracking
- Use `/overlap:status` to check their connection
- Use `/overlap:team` to see team activity
