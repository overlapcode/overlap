#!/usr/bin/env python3
"""
Overlap PreToolUse conflict check hook.

Called before file edits to check if anyone else is working on the same files.
Displays a warning if overlap is detected and asks the user whether to proceed.

If this is the first tool use, lazily registers the session with the server.
"""

import json
import sys
import os

# Add scripts directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logger
from config import is_configured
from api import api_request, ensure_session_registered
from utils import extract_file_paths, make_relative


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

    # Get session info for lazy registration
    session_id = input_data.get("session_id", "")
    cwd = input_data.get("cwd", os.getcwd())

    # Ensure session is registered (lazy registration on first tool use)
    overlap_session_id = ensure_session_registered(transcript_path, session_id, cwd)
    logger.set_context(hook="PreToolUse", session_id=overlap_session_id)

    # Conflict check requires a registered session
    if not overlap_session_id:
        logger.debug("No Overlap session for this transcript, skipping")
        sys.exit(0)

    # Extract ALL file paths from tool input
    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    file_paths = extract_file_paths(tool_input, tool_name)
    if not file_paths:
        logger.debug("No file path in tool input", tool_name=tool_name)
        sys.exit(0)

    # Make paths relative to cwd for privacy
    cwd = input_data.get("cwd", os.getcwd())
    relative_paths = [make_relative(p, cwd) for p in file_paths]

    logger.info("Checking for conflicts",
                tool_name=tool_name,
                file_paths=relative_paths)

    try:
        # Check with NO retry (budget: 5s hook timeout, informational only)
        response = api_request("POST", "/api/v1/check", {
            "files": relative_paths,
        }, timeout=3, retries=0)

        overlaps = response.get("data", {}).get("overlaps", [])
        logger.info("Conflict check complete",
                    file_paths=relative_paths,
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
                    # Ask user whether to proceed despite conflict
                    "permissionDecision": "ask",
                }
            }
            print(json.dumps(output))

    except Exception as e:
        logger.error("Conflict check failed", exc=e, file_paths=relative_paths)
        print(f"[Overlap] Check failed: {e}", file=sys.stderr)

    sys.exit(0)


if __name__ == "__main__":
    main()
