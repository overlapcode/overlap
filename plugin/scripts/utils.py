"""Shared utilities for Overlap plugin hooks."""

import os


def extract_file_paths(tool_input: dict, tool_name: str) -> list[str]:
    """Extract ALL file paths from tool input based on tool type.

    Returns a list of file paths (may be empty).
    Supports edit tools, read tools, search tools, and bash commands.
    """
    # Edit tools
    if tool_name in ("Write", "Edit"):
        path = tool_input.get("file_path")
        return [path] if path else []
    elif tool_name == "MultiEdit":
        edits = tool_input.get("edits", [])
        seen = set()
        paths = []
        for edit in edits:
            path = edit.get("file_path")
            if path and path not in seen:
                seen.add(path)
                paths.append(path)
        return paths
    elif tool_name == "NotebookEdit":
        path = tool_input.get("notebook_path")
        return [path] if path else []

    # Read tools
    elif tool_name == "Read":
        path = tool_input.get("file_path")
        return [path] if path else []

    # Search tools — extract the search path/directory
    elif tool_name in ("Grep", "Glob"):
        path = tool_input.get("path")
        return [path] if path else []

    # Bash — try to extract meaningful context from the command
    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        return [command[:200]] if command else []

    return []


# Tools that represent edits/writes (bypass read throttle in Option C)
WRITE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "NotebookEdit"})


def is_write_tool(tool_name: str) -> bool:
    """Check if a tool is a write/edit tool (vs read/search)."""
    return tool_name in WRITE_TOOLS


def make_relative(file_path: str, cwd: str) -> str:
    """Make an absolute file path relative to cwd for privacy."""
    try:
        if os.path.isabs(file_path):
            return os.path.relpath(file_path, cwd)
    except ValueError:
        pass  # Different drive on Windows
    return file_path
