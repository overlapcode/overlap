#!/usr/bin/env python3
"""
Overlap PostToolUse heartbeat hook.

Called after write tool use (Edit, Write, MultiEdit, NotebookEdit) to report
activity to the Overlap server. Collects files being worked on for classification.

Lazily registers the session on first invocation.

2-second client-side throttle per tool category. Throttle check runs BEFORE any
expensive work (session registration, API calls) so throttled invocations exit fast.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logger
from config import is_configured, get_session_entry, update_session_heartbeat_time, clear_session_for_transcript
from api import api_request, ensure_session_registered
from utils import extract_file_paths, make_relative, is_write_tool

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

    # Determine tool type for categorization
    tool_name = input_data.get("tool_name", "")
    is_write = is_write_tool(tool_name)

    # Extract file paths from tool input early — exit fast if nothing to report
    tool_input = input_data.get("tool_input", {})
    file_paths = extract_file_paths(tool_input, tool_name)
    if not file_paths:
        logger.debug("No file path in tool input", tool_name=tool_name)
        sys.exit(0)

    # Throttle check BEFORE any expensive work (session registration, API calls).
    # This ensures rapid tool use exits in <10ms with just a cheap file read.
    THROTTLE_SECONDS = 2
    entry = get_session_entry(transcript_path)
    if entry:
        from datetime import datetime, timezone
        ts_field = "last_write_heartbeat_at" if is_write else "last_read_heartbeat_at"
        last_hb = entry.get(ts_field)
        if last_hb:
            try:
                last_dt = datetime.fromisoformat(last_hb)
                elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
                if elapsed < THROTTLE_SECONDS:
                    logger.debug("Heartbeat throttled", elapsed=elapsed, tool=tool_name)
                    sys.exit(0)
            except (ValueError, TypeError):
                pass

    # Session registration (lazy — first tool use triggers it).
    # Only runs after throttle check passes.
    session_id = input_data.get("session_id", "")
    cwd = input_data.get("cwd", os.getcwd())
    overlap_session_id = ensure_session_registered(transcript_path, session_id, cwd)
    logger.set_context(hook="PostToolUse", session_id=overlap_session_id)

    if not overlap_session_id:
        logger.debug("No Overlap session for this transcript, skipping")
        sys.exit(0)

    # Make paths relative to cwd for privacy
    cwd = input_data.get("cwd", os.getcwd())
    relative_paths = [make_relative(p, cwd) for p in file_paths]

    logger.info("Sending heartbeat",
                tool_name=tool_name,
                file_paths=relative_paths,
                is_write=is_write)

    try:
        # Send heartbeat with retry (budget: 10s hook timeout)
        response = api_request("POST", f"/api/v1/sessions/{overlap_session_id}/heartbeat", {
            "files": relative_paths,
            "tool_name": tool_name,
        }, timeout=4, retries=1)

        result = response.get("data", {})
        if result.get("throttled"):
            logger.debug("Heartbeat throttled (server-side)", retry_after=result.get("retry_after"))
        else:
            update_session_heartbeat_time(transcript_path, is_write=is_write)
            if result.get("reactivated"):
                logger.info("Session reactivated via heartbeat", session_id=overlap_session_id)
                logger.stderr_log(f"Session reactivated: {overlap_session_id}")
            logger.info("Heartbeat sent",
                        file_paths=relative_paths,
                        scope=result.get("semantic_scope"))

    except Exception as e:
        error_msg = str(e)
        logger.error("Heartbeat failed", exc=e, file_paths=relative_paths)

        # Recovery: if server returns 404 (session not found), clear local entry
        # and re-register on next tool use. This handles cases where the server
        # DB was reset or the session was deleted.
        if "404" in error_msg or "not found" in error_msg.lower():
            logger.warn("Session not found on server, clearing local entry for re-registration",
                        overlap_session_id=overlap_session_id)
            clear_session_for_transcript(transcript_path)
            # Try to re-register immediately
            new_id = ensure_session_registered(transcript_path, session_id, cwd)
            if new_id:
                logger.info("Re-registered session after 404", new_session_id=new_id)
                logger.stderr_log(f"Session re-registered: {new_id}")
                # Retry the heartbeat with the new session ID
                try:
                    api_request("POST", f"/api/v1/sessions/{new_id}/heartbeat", {
                        "files": relative_paths,
                        "tool_name": tool_name,
                    }, timeout=4, retries=0)
                    update_session_heartbeat_time(transcript_path, is_write=is_write)
                except Exception as retry_err:
                    logger.error("Retry heartbeat after re-register failed", exc=retry_err)
            else:
                logger.stderr_log("Session lost - will re-register on next tool use")
        else:
            logger.stderr_log(f"Heartbeat failed: {e}")

    sys.exit(0)


if __name__ == "__main__":
    main()
