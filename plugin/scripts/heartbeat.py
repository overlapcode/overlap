#!/usr/bin/env python3
"""
Overlap PostToolUse heartbeat hook.

Called after file edits to report activity to the Overlap server.
Collects the files being edited and sends them for classification.

If this is the first tool use, lazily registers the session with the server.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logger
from config import is_configured, get_session_entry, update_session_heartbeat_time
from api import api_request, ensure_session_registered
from utils import extract_file_paths, make_relative


def main():
    # Set up logging context
    logger.set_context(hook="PostToolUse")

    # Read hook input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        logger.warn("Failed to parse stdin JSON", error=str(e))
        sys.exit(0)

    # Check if configured
    if not is_configured():
        logger.debug("Not configured, skipping")
        sys.exit(0)

    # Get transcript_path - this is our key for looking up the session
    transcript_path = input_data.get("transcript_path", "")
    if not transcript_path:
        logger.debug("No transcript_path in input, skipping")
        sys.exit(0)

    # Expand ~ in path
    transcript_path = os.path.expanduser(transcript_path)

    # Get session info for lazy registration
    session_id = input_data.get("session_id", "")
    cwd = input_data.get("cwd", os.getcwd())

    # Ensure session is registered (lazy registration on first tool use)
    overlap_session_id = ensure_session_registered(transcript_path, session_id, cwd)
    logger.set_context(hook="PostToolUse", session_id=overlap_session_id)

    # Heartbeat requires a registered session
    if not overlap_session_id:
        logger.debug("No Overlap session for this transcript, skipping")
        sys.exit(0)

    # Client-side throttle: skip if last heartbeat was < 30s ago
    entry = get_session_entry(transcript_path)
    if entry:
        last_hb = entry.get("last_heartbeat_at")
        if last_hb:
            from datetime import datetime, timezone
            try:
                last_dt = datetime.fromisoformat(last_hb)
                elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
                if elapsed < 30:
                    logger.debug("Heartbeat throttled (client-side)", elapsed=elapsed)
                    sys.exit(0)
            except (ValueError, TypeError):
                pass  # Bad timestamp, proceed with heartbeat

    # Extract ALL file paths from tool input (fixes MultiEdit bug)
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    file_paths = extract_file_paths(tool_input, tool_name)
    if not file_paths:
        logger.debug("No file path in tool input", tool_name=tool_name)
        sys.exit(0)

    # Make paths relative to cwd for privacy
    cwd = input_data.get("cwd", os.getcwd())
    relative_paths = [make_relative(p, cwd) for p in file_paths]

    logger.info("Sending heartbeat",
                tool_name=tool_name,
                file_paths=relative_paths)

    try:
        # Send heartbeat with retry (budget: 10s hook timeout)
        response = api_request("POST", f"/api/v1/sessions/{overlap_session_id}/heartbeat", {
            "files": relative_paths,
        }, timeout=4, retries=1)

        result = response.get("data", {})
        if result.get("throttled"):
            logger.debug("Heartbeat throttled (server-side)", retry_after=result.get("retry_after"))
        else:
            update_session_heartbeat_time(transcript_path)
            logger.info("Heartbeat sent",
                        file_paths=relative_paths,
                        scope=result.get("semantic_scope"))

    except Exception as e:
        logger.error("Heartbeat failed", exc=e, file_paths=relative_paths)
        print(f"[Overlap] Heartbeat failed: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
