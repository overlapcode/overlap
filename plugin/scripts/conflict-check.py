#!/usr/bin/env python3
"""
Overlap PreToolUse conflict check hook.

Called before file edits to check if anyone else is working on the same files.
Displays a warning if overlap is detected, but does NOT block the edit.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import is_configured, get_current_session
from api import api_request


def extract_file_path(tool_input: dict, tool_name: str) -> str | None:
    """Extract the file path from tool input based on tool type."""
    if tool_name in ("Write", "Edit"):
        return tool_input.get("file_path")
    elif tool_name == "MultiEdit":
        edits = tool_input.get("edits", [])
        if edits:
            return edits[0].get("file_path")
    elif tool_name == "NotebookEdit":
        return tool_input.get("notebook_path")
    return None


def format_overlap_warning(overlaps: list) -> str:
    """Format overlap information into a warning message."""
    if not overlaps:
        return ""

    lines = ["[Overlap] Potential conflict detected:"]
    lines.append("")

    for overlap in overlaps[:3]:  # Limit to 3 overlaps
        user_name = overlap.get("user_name", "Someone")
        device_name = overlap.get("device_name", "")
        scope = overlap.get("semantic_scope", "")
        summary = overlap.get("summary", "")
        files = overlap.get("files", [])

        device_info = f" ({device_name})" if device_name else ""
        lines.append(f"  {user_name}{device_info} is working on {scope or 'this area'}:")

        if summary:
            lines.append(f"    {summary}")

        if files:
            file_list = ", ".join(files[:3])
            if len(files) > 3:
                file_list += f" +{len(files) - 3} more"
            lines.append(f"    Files: {file_list}")

        lines.append("")

    lines.append("  Consider coordinating to avoid conflicts.")

    return "\n".join(lines)


def main():
    # Read hook input from stdin
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    # Check if configured
    if not is_configured():
        sys.exit(0)

    # Get current session (we need it to exclude ourselves from results)
    session_id = get_current_session()
    if not session_id:
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
        pass

    try:
        # Check for overlaps
        response = api_request("POST", "/api/v1/check", {
            "files": [file_path],
        })

        overlaps = response.get("data", {}).get("overlaps", [])

        if overlaps:
            # Format and output warning
            warning = format_overlap_warning(overlaps)

            # Output as additional context for Claude
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": warning,
                    # We don't block - just inform
                    "permissionDecision": "ask",
                }
            }
            print(json.dumps(output))

    except Exception as e:
        # Log error but don't block
        print(f"[Overlap] Check failed: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
