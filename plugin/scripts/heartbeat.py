#!/usr/bin/env python3
"""
Overlap PostToolUse heartbeat hook.

Called after file edits to report activity to the Overlap server.
Collects the files being edited and sends them for classification.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import is_configured, get_current_session
from api import api_request


# Track files we've already reported in this batch
# (to avoid duplicate reports for the same edit)
_reported_files = set()


def extract_file_path(tool_input: dict, tool_name: str) -> str | None:
    """Extract the file path from tool input based on tool type."""
    if tool_name in ("Write", "Edit"):
        return tool_input.get("file_path")
    elif tool_name == "MultiEdit":
        # MultiEdit has an array of edits
        edits = tool_input.get("edits", [])
        if edits:
            return edits[0].get("file_path")
    elif tool_name == "NotebookEdit":
        return tool_input.get("notebook_path")
    return None


def main():
    # Read hook input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    # Check if configured
    if not is_configured():
        sys.exit(0)

    # Get current session
    session_id = get_current_session()
    if not session_id:
        # No active session
        sys.exit(0)

    # Extract file path from tool input
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    file_path = extract_file_path(tool_input, tool_name)
    if not file_path:
        sys.exit(0)

    # Make path relative to cwd for privacy
    cwd = input_data.get("cwd", os.getcwd())
    try:
        if os.path.isabs(file_path):
            file_path = os.path.relpath(file_path, cwd)
    except ValueError:
        # Can't make relative (different drive on Windows, etc.)
        pass

    try:
        # Send heartbeat with file info
        api_request("POST", f"/api/v1/sessions/{session_id}/heartbeat", {
            "files": [file_path],
        })
    except Exception as e:
        # Log error but don't block
        print(f"[Overlap] Heartbeat failed: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
