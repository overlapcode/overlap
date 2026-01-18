#!/usr/bin/env python3
"""
Overlap SessionStart hook.

Called when a Claude Code session starts. Registers the session with the
Overlap server and stores the session ID for later use.
"""

import json
import sys
import os
from pathlib import Path

# IMMEDIATE debug logging - this runs before anything else
print(f"[Overlap] === SessionStart hook STARTED ===", file=sys.stderr)
print(f"[Overlap] Python: {sys.executable}", file=sys.stderr)
print(f"[Overlap] Script: {__file__}", file=sys.stderr)
print(f"[Overlap] Home dir: {Path.home()}", file=sys.stderr)
print(f"[Overlap] CWD: {os.getcwd()}", file=sys.stderr)

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import is_configured, save_current_session, get_current_session
from api import api_request, get_hostname, get_device_name, get_git_info, is_remote_session


def main():
    # Read hook input from stdin
    print(f"[Overlap] Reading stdin...", file=sys.stderr)
    try:
        input_data = json.load(sys.stdin)
        print(f"[Overlap] Received input: {json.dumps(input_data)}", file=sys.stderr)
    except json.JSONDecodeError as e:
        print(f"[Overlap] JSON decode error: {e}", file=sys.stderr)
        sys.exit(0)

    # Check if this is a startup or resume
    source = input_data.get("source", "")
    print(f"[Overlap] Source: {source}", file=sys.stderr)
    if source not in ("startup", "resume"):
        print(f"[Overlap] Skipping - source is not startup/resume", file=sys.stderr)
        sys.exit(0)

    # Check if configured
    print(f"[Overlap] Checking configuration...", file=sys.stderr)
    if not is_configured():
        print(f"[Overlap] NOT CONFIGURED - exiting. Run /overlap:config first", file=sys.stderr)
        sys.exit(0)
    print(f"[Overlap] Configuration OK", file=sys.stderr)

    # If resuming, check if we already have a session
    if source == "resume":
        print(f"[Overlap] Resume - checking for existing session...", file=sys.stderr)
        existing_session = get_current_session()
        if existing_session:
            print(f"[Overlap] Found existing session {existing_session}, exiting", file=sys.stderr)
            sys.exit(0)
        print(f"[Overlap] No existing session found, will create new one", file=sys.stderr)

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
        # Only include fields that have values (server rejects null for optional fields)
        request_data = {
            "session_id": session_id,
            "device_name": device_name,
            "hostname": hostname,
            "is_remote": is_remote,
            "worktree": cwd,
        }
        # Add optional git fields only if they have values
        if git_info.get("repo_name"):
            request_data["repo_name"] = git_info["repo_name"]
        if git_info.get("remote_url"):
            request_data["remote_url"] = git_info["remote_url"]
        if git_info.get("branch"):
            request_data["branch"] = git_info["branch"]

        print(f"[Overlap] Starting session with data: {json.dumps(request_data)}", file=sys.stderr)

        response = api_request("POST", "/api/v1/sessions/start", request_data)
        print(f"[Overlap] Server response: {json.dumps(response)}", file=sys.stderr)

        # Save session ID for later hooks
        server_session_id = response.get("data", {}).get("session_id")
        if server_session_id:
            save_current_session(server_session_id)
            print(f"[Overlap] Saved session ID to local file: {server_session_id}", file=sys.stderr)
        else:
            print(f"[Overlap] WARNING: No session_id in response, cannot save locally", file=sys.stderr)

        # Output context for Claude (shown in SessionStart)
        working_in = git_info.get("repo_name") or os.path.basename(cwd) or cwd
        output = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": f"[Overlap] Session tracking started. Working in: {working_in}"
            }
        }
        print(json.dumps(output))

    except Exception as e:
        # Log error with full traceback
        import traceback
        print(f"[Overlap] Failed to start session: {e}", file=sys.stderr)
        print(f"[Overlap] Traceback: {traceback.format_exc()}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
