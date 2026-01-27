"""Shared utilities for Overlap plugin hooks."""

import os


def extract_file_paths(tool_input: dict, tool_name: str) -> list[str]:
    """Extract ALL file paths from tool input based on tool type.

    Returns a list of file paths (may be empty).
    For MultiEdit, returns all edited files, not just the first.
    """
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
    return []


def make_relative(file_path: str, cwd: str) -> str:
    """Make an absolute file path relative to cwd for privacy."""
    try:
        if os.path.isabs(file_path):
            return os.path.relpath(file_path, cwd)
    except ValueError:
        pass  # Different drive on Windows
    return file_path
