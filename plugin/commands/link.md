---
description: Generate a magic link for web dashboard access
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Generate Magic Link

Generate a temporary magic link that can be used to access the Overlap web dashboard.

## Generate Link

```bash
# Read config
SERVER_URL=$(cat ~/.overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# Request magic link
curl -s -X POST "${SERVER_URL}/api/v1/magic-link" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}" \
  -H "Content-Type: application/json"
```

## Display Result

Show the user:
1. The magic link URL
2. When it expires (typically 7 days)
3. A note that the link is single-use

Format:
```
Magic Link Generated!

URL: [magic_link_url]

This link expires in 7 days and can only be used once.
Open this URL in your browser to access the Overlap dashboard.
```
