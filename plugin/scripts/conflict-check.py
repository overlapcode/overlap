#!/usr/bin/env python3
"""
Overlap PreToolUse conflict check hook.

Called before file edits to check if anyone else is working on the same files.
Displays a warning if overlap is detected, but does NOT block the edit.

Uses transcript_path to look up the Overlap session ID.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logger
from config import is_configured, get_session_for_transcript
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
    # Set up logging context
    logger.set_context(hook="PreToolUse")

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

    # Look up Overlap session for this Claude session
    overlap_session_id = get_session_for_transcript(transcript_path)
    logger.set_context(hook="PreToolUse", session_id=overlap_session_id)

    if not overlap_session_id:
        logger.debug("No Overlap session for this transcript, skipping")
        sys.exit(0)

    # Extract file path from tool input
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    file_path = extract_file_path(tool_input, tool_name)
    if not file_path:
        logger.debug("No file path in tool input", tool_name=tool_name)
        sys.exit(0)

    # Make path relative to cwd for privacy
    cwd = input_data.get("cwd", os.getcwd())
    original_path = file_path
    try:
        if os.path.isabs(file_path):
            file_path = os.path.relpath(file_path, cwd)
    except ValueError as e:
        # Can't make relative (different drive on Windows, etc.)
        logger.debug("Could not make path relative", path=file_path, error=str(e))

    logger.info("Checking for conflicts",
                tool_name=tool_name,
                file_path=file_path)

    try:
        # Check for overlaps
        response = api_request("POST", "/api/v1/check", {
            "files": [file_path],
        })

        overlaps = response.get("data", {}).get("overlaps", [])
        logger.info("Conflict check complete",
                    file_path=file_path,
                    overlap_count=len(overlaps))

        if overlaps:
            # Log overlap details
            logger.info("Overlaps detected",
                        overlaps=[{
                            "user": o.get("user_name"),
                            "scope": o.get("semantic_scope"),
                            "files": o.get("files", [])[:3]
                        } for o in overlaps[:3]])

            # Format and output warning
            warning = format_overlap_warning(overlaps)
            print(f"[Overlap] ConflictCheck: Found {len(overlaps)} overlaps", file=sys.stderr)

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
        logger.error("Conflict check failed", exc=e, file_path=file_path)
        import traceback
        print(f"[Overlap] Check failed: {e}", file=sys.stderr)
        print(f"[Overlap] Traceback: {traceback.format_exc()}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
