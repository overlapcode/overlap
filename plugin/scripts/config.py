"""
Overlap plugin configuration.

This module loads configuration from:
1. Environment variables (OVERLAP_*)
2. Config file (~/.claude/overlap/config.json)

Sessions are stored in a unified sessions.json with a status field:
- "pending": saved at SessionStart, not yet registered with server
- "active": registered with server, has an overlap_session_id
"""

import fcntl
import hashlib
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Store in ~/.claude/overlap/ as recommended by Claude Code docs
CONFIG_DIR = Path.home() / ".claude" / "overlap"
CONFIG_FILE = CONFIG_DIR / "config.json"
SESSIONS_FILE = CONFIG_DIR / "sessions.json"  # Unified session store


def _log(level: str, message: str, **kwargs) -> None:
    """Lazy-import logger to avoid circular dependency."""
    try:
        import logger
        getattr(logger, level)(message, **kwargs)
    except ImportError:
        pass


def get_config() -> dict:
    """Load configuration from file and environment."""
    config = {
        "server_url": None,
        "team_token": None,
        "user_token": None,
    }

    # Load from config file
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE) as f:
                file_config = json.load(f)
                config.update(file_config)
        except json.JSONDecodeError as e:
            _log("warn", "Config file has invalid JSON", path=str(CONFIG_FILE), error=str(e))
        except IOError as e:
            _log("warn", "Failed to read config file", path=str(CONFIG_FILE), error=str(e))

    # Override with environment variables
    if os.environ.get("OVERLAP_SERVER_URL"):
        config["server_url"] = os.environ["OVERLAP_SERVER_URL"]
    if os.environ.get("OVERLAP_TEAM_TOKEN"):
        config["team_token"] = os.environ["OVERLAP_TEAM_TOKEN"]
    if os.environ.get("OVERLAP_USER_TOKEN"):
        config["user_token"] = os.environ["OVERLAP_USER_TOKEN"]

    return config


def save_config(config: dict) -> None:
    """Save configuration to file."""
    import sys
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2)
        _log("info", "Config saved", path=str(CONFIG_FILE))
        print(f"[Overlap] Config: Saved config to {CONFIG_FILE}", file=sys.stderr)
    except Exception as e:
        _log("error", "Failed to save config", path=str(CONFIG_FILE))
        print(f"[Overlap] Config: FAILED to save config: {e}", file=sys.stderr)
        raise


def _get_transcript_key(transcript_path: str) -> str:
    """Get a safe key for a transcript path (hash to avoid filesystem issues)."""
    normalized = os.path.expanduser(transcript_path)
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


LOCK_FILE = CONFIG_DIR / "sessions.lock"


def _load_sessions() -> dict:
    """Load all sessions from file (caller should hold lock for read-modify-write)."""
    if SESSIONS_FILE.exists():
        try:
            with open(SESSIONS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def _save_sessions(sessions: dict) -> None:
    """Save all sessions to file (caller should hold lock for read-modify-write)."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(SESSIONS_FILE, "w") as f:
        json.dump(sessions, f, indent=2)


@contextmanager
def _locked_sessions():
    """Context manager for atomic read-modify-write of sessions.json.

    Usage:
        with _locked_sessions() as (sessions, save):
            sessions["key"] = value
            save(sessions)
    """
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        sessions = _load_sessions()
        yield sessions, _save_sessions
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def get_session_for_transcript(transcript_path: str) -> Optional[str]:
    """Get the Overlap session ID for a registered Claude transcript."""
    entry = get_session_entry(transcript_path)
    if not entry:
        return None
    # Backward compat: old entries have overlap_session_id but no status field.
    # Treat any entry with an overlap_session_id as active.
    if entry.get("overlap_session_id"):
        return entry["overlap_session_id"]
    return None


def get_session_entry(transcript_path: str) -> Optional[dict]:
    """Get the full session entry for a transcript (pending or active)."""
    sessions = _load_sessions()
    key = _get_transcript_key(transcript_path)
    return sessions.get(key)


def save_session_for_transcript(
    transcript_path: str,
    overlap_session_id: Optional[str],
    worktree: str,
    status: str = "active",
    session_info: Optional[dict] = None,
) -> None:
    """Save a session entry for a Claude transcript.

    Args:
        transcript_path: Claude's transcript file path
        overlap_session_id: Server session ID (None for pending)
        worktree: Working directory path
        status: "pending" or "active"
        session_info: Additional session data (device, git info, etc.)
    """
    import sys
    try:
        with _locked_sessions() as (sessions, save):
            key = _get_transcript_key(transcript_path)
            existing = sessions.get(key, {})
            entry = {
                **existing,
                "overlap_session_id": overlap_session_id,
                "transcript_path": transcript_path,
                "worktree": worktree,
                "status": status,
                "created_at": existing.get("created_at", datetime.now(timezone.utc).isoformat()),
            }
            if session_info:
                entry["session_info"] = session_info
            sessions[key] = entry
            save(sessions)
        _log("info", "Session saved", overlap_session_id=overlap_session_id, status=status)
        print(f"[Overlap] Config: Saved session ({status})", file=sys.stderr)
    except Exception as e:
        _log("error", "Failed to save session", overlap_session_id=str(overlap_session_id))
        print(f"[Overlap] Config: FAILED to save session: {e}", file=sys.stderr)
        raise


def clear_session_for_transcript(transcript_path: str) -> None:
    """Clear the session for a Claude transcript."""
    try:
        with _locked_sessions() as (sessions, save):
            key = _get_transcript_key(transcript_path)
            if key in sessions:
                del sessions[key]
                save(sessions)
                _log("info", "Session cleared", transcript_path=transcript_path)
    except Exception as e:
        _log("warn", "Failed to clear session", transcript_path=transcript_path, error=str(e))


def update_session_heartbeat_time(transcript_path: str) -> None:
    """Update the last heartbeat timestamp for client-side throttling."""
    with _locked_sessions() as (sessions, save):
        key = _get_transcript_key(transcript_path)
        if key in sessions:
            sessions[key]["last_heartbeat_at"] = datetime.now(timezone.utc).isoformat()
            save(sessions)


def gc_stale_sessions(max_age_hours: int = 48) -> int:
    """Remove session entries older than max_age_hours. Returns count removed."""
    with _locked_sessions() as (sessions, save):
        now = datetime.now(timezone.utc)
        to_remove = []

        for key, entry in sessions.items():
            created_at = entry.get("created_at", "")
            if not created_at:
                to_remove.append(key)
                continue
            try:
                created = datetime.fromisoformat(created_at)
                if (now - created).total_seconds() > max_age_hours * 3600:
                    to_remove.append(key)
            except (ValueError, TypeError):
                to_remove.append(key)

        if to_remove:
            for key in to_remove:
                del sessions[key]
            save(sessions)

        return len(to_remove)


def is_configured() -> bool:
    """Check if the plugin is properly configured."""
    config = get_config()
    return all([
        config.get("server_url"),
        config.get("team_token"),
        config.get("user_token"),
    ])
