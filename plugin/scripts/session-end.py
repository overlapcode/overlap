#!/usr/bin/env python3
"""
Overlap SessionEnd hook.

Called when a Claude Code session ends. Notifies the server that the session
has ended so it can be marked as inactive.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logger
from config import is_configured, get_current_session, clear_current_session
from api import api_request


def main():
    # Set up logging context
    logger.set_context(hook="SessionEnd")
    logger.info("Hook started")

    # Read hook input from stdin
    input_data = {}
    try:
        input_data = json.load(sys.stdin)
        logger.info("Received input", input_keys=list(input_data.keys()))
    except json.JSONDecodeError as e:
        # No input - try to end session anyway
        logger.warn("No valid JSON input", error=str(e))

    # Check if configured
    if not is_configured():
        logger.info("Not configured, skipping")
        print("[Overlap] SessionEnd: Not configured, skipping", file=sys.stderr)
        sys.exit(0)

    # Get the session ID that's ending (from Claude Code) and the stored session ID
    ending_session_id = input_data.get("session_id", "")
    stored_session_id = get_current_session()

    # If we have no stored session, nothing to do
    if not stored_session_id:
        logger.info("No active session to end")
        print("[Overlap] SessionEnd: No active session to end", file=sys.stderr)
        sys.exit(0)

    # Only proceed if this is our session ending (or if no session_id provided in input)
    if ending_session_id and ending_session_id != stored_session_id:
        logger.info("Different session ending, keeping our session",
                    ending_session=ending_session_id,
                    our_session=stored_session_id)
        print(f"[Overlap] SessionEnd: Different session ending, keeping ours", file=sys.stderr)
        sys.exit(0)

    session_id = stored_session_id
    logger.set_context(hook="SessionEnd", session_id=session_id)

    try:
        # End session on server
        logger.info("Ending session on server")
        print(f"[Overlap] SessionEnd: Ending session {session_id}", file=sys.stderr)
        api_request("POST", f"/api/v1/sessions/{session_id}/end", {})
        logger.info("Session ended successfully")
        print(f"[Overlap] SessionEnd: Successfully ended session on server", file=sys.stderr)
    except Exception as e:
        logger.error("Failed to end session on server", exc=e)
        import traceback
        print(f"[Overlap] Failed to end session: {e}", file=sys.stderr)
        print(f"[Overlap] Traceback: {traceback.format_exc()}", file=sys.stderr)
    finally:
        # Clear local session file (we've confirmed this is our session)
        clear_current_session()
        logger.info("Local session file cleared")
        print(f"[Overlap] SessionEnd: Cleared local session file", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
