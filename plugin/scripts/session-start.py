#!/usr/bin/env python3
"""
Overlap SessionStart hook.

Called when a Claude Code session starts. Registers the session with the
Overlap server and stores the session ID for later use.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import is_configured, save_current_session, get_current_session
from api import api_request, get_hostname, get_device_name, get_git_info, is_remote_session


def main():
    # Read hook input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # No input or invalid JSON - silently exit
        sys.exit(0)

    # Check if this is a startup or resume
    source = input_data.get("source", "")
    if source not in ("startup", "resume"):
        # Only handle startup and resume, not clear or compact
        sys.exit(0)

    # Check if configured
    if not is_configured():
        # Not configured - silently exit
        # User needs to run /overlap:config first
        sys.exit(0)

    # If resuming, check if we already have a session
    if source == "resume":
        existing_session = get_current_session()
        if existing_session:
            # Already have a session, just exit
            sys.exit(0)

    # Get session info
    session_id = input_data.get("session_id", "")
    cwd = input_data.get("cwd", os.getcwd())

    # Get device and git info
    hostname = get_hostname()
    device_name = get_device_name()
    is_remote = is_remote_session()
    git_info = get_git_info(cwd)

    try:
        # Start session on server
        response = api_request("POST", "/api/v1/sessions/start", {
            "session_id": session_id,
            "device_name": device_name,
            "hostname": hostname,
            "is_remote": is_remote,
            "repo_name": git_info.get("repo_name"),
            "remote_url": git_info.get("remote_url"),
            "branch": git_info.get("branch"),
            "worktree": cwd,
        })

        # Save session ID for later hooks
        if response.get("data", {}).get("session_id"):
            save_current_session(response["data"]["session_id"])

        # Output context for Claude (shown in SessionStart)
        output = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": f"[Overlap] Session tracking started. Working in: {git_info.get('repo_name', cwd)}"
            }
        }
        print(json.dumps(output))

    except Exception as e:
        # Log error but don't block session
        print(f"[Overlap] Failed to start session: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
