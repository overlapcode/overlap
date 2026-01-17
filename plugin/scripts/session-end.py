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

from config import is_configured, get_current_session, clear_current_session
from api import api_request


def main():
    # Read hook input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        # No input - try to end session anyway
        pass

    # Check if configured
    if not is_configured():
        sys.exit(0)

    # Get current session
    session_id = get_current_session()
    if not session_id:
        sys.exit(0)

    try:
        # End session on server
        api_request("POST", f"/api/v1/sessions/{session_id}/end", {})
    except Exception as e:
        # Log error but don't block
        print(f"[Overlap] Failed to end session: {e}", file=sys.stderr)
    finally:
        # Always clear local session file
        clear_current_session()

    sys.exit(0)


if __name__ == "__main__":
    main()
