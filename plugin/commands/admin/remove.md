---
description: Remove a user from the team (admin only)
argument-hint: [user-name-or-email]
allowed-tools: Bash(cat:*), Bash(curl:*)
---

# Remove User from Team

Remove a user from the team. This will delete all their sessions, activity, and data. They can rejoin using the team invite link. This command requires admin privileges.

User to remove: $ARGUMENTS

## Steps

1. First, list users to find the user ID
2. Then remove the user

## Find User

```bash
# Read config
SERVER_URL=$(cat ~/.claude/overlap/config.json | grep -o '"server_url"[^,]*' | cut -d'"' -f4)
USER_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"user_token"[^,]*' | cut -d'"' -f4)
TEAM_TOKEN=$(cat ~/.claude/overlap/config.json | grep -o '"team_token"[^,]*' | cut -d'"' -f4)

# List users to find the one matching the argument
curl -s -X GET "${SERVER_URL}/api/v1/admin/users" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Remove User

Once you have the user ID, remove them:

```bash
curl -s -X DELETE "${SERVER_URL}/api/v1/admin/users/[USER_ID]" \
  -H "Authorization: Bearer ${USER_TOKEN}" \
  -H "X-Team-Token: ${TEAM_TOKEN}"
```

## Confirm

Display a confirmation message:
```
✓ [Name] has been removed from the team.
  They can rejoin using the team invite link.
```

If the request fails, show the error message.
You cannot remove yourself or the last admin.
