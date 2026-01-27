#!/usr/bin/env python3
"""
Overlap SessionStart hook.

Called when a Claude Code session starts. Saves session info locally for
lazy registration - the actual server registration happens on first tool use
(PreToolUse or PostToolUse), which filters out ghost/transient sessions.

Sessions are keyed by transcript_path (Claude's session file) to:
- Uniquely identify each Claude session (even multiple in same repo)
- Handle resumes properly (same transcript = same session)
- Avoid duplicate sessions from race conditions
"""

import json
import sys
import os
from pathlib import Path

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logger
from config import (
    is_configured,
    get_session_for_transcript,
    get_session_entry,
    save_session_for_transcript,
    gc_stale_sessions,
)
from api import get_hostname, get_device_name, get_git_info, is_remote_session


def main():
    # Set up logging context
    logger.set_context(hook="SessionStart")
    logger.info("Hook started",
                python=sys.executable,
                script=__file__,
                home=str(Path.home()),
                cwd=os.getcwd())

    # Read hook input from stdin
    try:
        input_data = json.load(sys.stdin)
        logger.info("Received input", input_keys=list(input_data.keys()))
    except json.JSONDecodeError as e:
        logger.error("Failed to parse stdin JSON", exc=e)
        print(f"[Overlap] JSON decode error: {e}", file=sys.stderr)
        sys.exit(0)

    # Check if this is a startup, resume, or compact
    # - startup: new session
    # - resume: continuing a previous session
    # - compact: session context was compacted (same session continues)
    source = input_data.get("source", "")
    if source not in ("startup", "resume", "compact"):
        logger.info("Skipping - not startup/resume/compact", source=source)
        sys.exit(0)

    # Check if configured
    if not is_configured():
        logger.info("Not configured - exiting")
        print(f"[Overlap] Not configured - run /overlap:config first", file=sys.stderr)
        sys.exit(0)
    logger.info("Configuration OK")

    # GC stale local sessions (older than 48h)
    removed = gc_stale_sessions(max_age_hours=48)
    if removed:
        logger.info("GC'd stale sessions", count=removed)

    # Get transcript_path - this is our primary key for session tracking
    transcript_path = input_data.get("transcript_path", "")
    if not transcript_path:
        logger.warn("No transcript_path in input - skipping")
        sys.exit(0)

    # Expand ~ in path
    transcript_path = os.path.expanduser(transcript_path)

    logger.info("Processing session", transcript_path=transcript_path, source=source)

    # Check if transcript file exists - if not, skip for now (lazy check on tool use)
    if not os.path.exists(transcript_path):
        logger.info("Transcript file does not exist yet, will check on tool use",
                    transcript_path=transcript_path)
        sys.exit(0)

    # Check if we already have an Overlap session for this Claude session
    existing_session = get_session_for_transcript(transcript_path)
    if existing_session:
        logger.info("Overlap session already exists for transcript",
                    overlap_session_id=existing_session, transcript_path=transcript_path)
        # Output context for Claude
        output = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": f"[Overlap] Session resumed: {existing_session}"
            }
        }
        print(json.dumps(output))
        sys.exit(0)

    # Check if we already have a pending session entry
    existing_entry = get_session_entry(transcript_path)
    if existing_entry and existing_entry.get("status") == "pending":
        logger.info("Pending session already exists for transcript", transcript_path=transcript_path)
        sys.exit(0)

    # Get session info from Claude Code
    session_id = input_data.get("session_id", "")
    cwd = input_data.get("cwd", os.getcwd())
    logger.set_context(hook="SessionStart", session_id=session_id)

    # Get device and git info
    hostname = get_hostname()
    device_name = get_device_name()
    is_remote = is_remote_session()
    git_info = get_git_info(cwd)

    logger.info("Collected environment info",
                hostname=hostname,
                device_name=device_name,
                is_remote=is_remote,
                git_repo=git_info.get("repo_name"),
                git_branch=git_info.get("branch"))

    # Save session info locally for lazy registration on first tool use
    # This filters out ghost sessions - they never trigger tool use
    session_info = {
        "session_id": session_id,
        "device_name": device_name,
        "hostname": hostname,
        "is_remote": is_remote,
        "worktree": cwd,
    }
    # Add optional git fields only if they have values
    if git_info.get("repo_name"):
        session_info["repo_name"] = git_info["repo_name"]
    if git_info.get("remote_url"):
        session_info["remote_url"] = git_info["remote_url"]
    if git_info.get("branch"):
        session_info["branch"] = git_info["branch"]

    save_session_for_transcript(
        transcript_path,
        overlap_session_id=None,
        worktree=cwd,
        status="pending",
        session_info=session_info,
    )
    logger.info("Pending session saved for lazy registration", transcript_path=transcript_path)

    # Output context for Claude (shown in SessionStart)
    working_in = git_info.get("repo_name") or os.path.basename(cwd) or cwd
    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": f"[Overlap] Ready to track. Working in: {working_in}"
        }
    }
    print(json.dumps(output))

    sys.exit(0)


if __name__ == "__main__":
    main()
