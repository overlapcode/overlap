#!/usr/bin/env python3
"""
Overlap SessionEnd hook.

Called when a Claude Code session ends. Notifies the server that the session
has ended so it can be marked as inactive.

Uses transcript_path to look up the Overlap session ID.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logger
from config import is_configured, get_session_for_transcript, clear_session_for_transcript
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
        # No input - can't do much without transcript_path
        logger.warn("No valid JSON input", error=str(e))
        sys.exit(0)

    # Check if configured
    if not is_configured():
        logger.info("Not configured, skipping")
        print("[Overlap] SessionEnd: Not configured, skipping", file=sys.stderr)
        sys.exit(0)

    # Get transcript_path - this is our key for looking up the session
    transcript_path = input_data.get("transcript_path", "")
    if not transcript_path:
        logger.info("No transcript_path in input, skipping")
        print("[Overlap] SessionEnd: No transcript_path, skipping", file=sys.stderr)
        sys.exit(0)

    # Expand ~ in path
    transcript_path = os.path.expanduser(transcript_path)

    # Look up our Overlap session for this Claude session
    overlap_session_id = get_session_for_transcript(transcript_path)

    if not overlap_session_id:
        logger.info("No Overlap session found for transcript", transcript_path=transcript_path)
        print("[Overlap] SessionEnd: No tracked session for this transcript", file=sys.stderr)
        sys.exit(0)

    logger.set_context(hook="SessionEnd", session_id=overlap_session_id)

    try:
        # End session on server
        logger.info("Ending session on server", overlap_session_id=overlap_session_id)
        print(f"[Overlap] SessionEnd: Ending session {overlap_session_id}", file=sys.stderr)
        api_request("POST", f"/api/v1/sessions/{overlap_session_id}/end", {})
        logger.info("Session ended successfully")
        print(f"[Overlap] SessionEnd: Successfully ended session on server", file=sys.stderr)
    except Exception as e:
        logger.error("Failed to end session on server", exc=e)
        import traceback
        print(f"[Overlap] Failed to end session: {e}", file=sys.stderr)
        print(f"[Overlap] Traceback: {traceback.format_exc()}", file=sys.stderr)
    finally:
        # Clear local session mapping
        clear_session_for_transcript(transcript_path)
        logger.info("Local session mapping cleared", transcript_path=transcript_path)
        print(f"[Overlap] SessionEnd: Cleared local session mapping", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
