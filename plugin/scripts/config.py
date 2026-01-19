"""
Overlap plugin configuration.

This module loads configuration from:
1. Environment variables (OVERLAP_*)
2. Config file (~/.claude/overlap/config.json)

Sessions are keyed by Claude Code's transcript_path, which uniquely identifies
each Claude session (even multiple sessions in the same repo).
"""

import hashlib
import json
import os
from pathlib import Path
from typing import Optional

# Import logger - but handle case where it fails (avoid circular issues)
try:
    import logger as _logger
except ImportError:
    _logger = None  # type: ignore

# Store in ~/.claude/overlap/ as recommended by Claude Code docs
CONFIG_DIR = Path.home() / ".claude" / "overlap"
CONFIG_FILE = CONFIG_DIR / "config.json"
SESSIONS_FILE = CONFIG_DIR / "sessions.json"  # Keyed by transcript_path


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
            if _logger:
                _logger.warn("Config file has invalid JSON", path=str(CONFIG_FILE), error=str(e))
        except IOError as e:
            if _logger:
                _logger.warn("Failed to read config file", path=str(CONFIG_FILE), error=str(e))

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
        if _logger:
            _logger.info("Config saved", path=str(CONFIG_FILE))
        print(f"[Overlap] Config: Saved config to {CONFIG_FILE}", file=sys.stderr)
    except Exception as e:
        if _logger:
            _logger.error("Failed to save config", exc=e, path=str(CONFIG_FILE))
        print(f"[Overlap] Config: FAILED to save config: {e}", file=sys.stderr)
        raise


def _get_transcript_key(transcript_path: str) -> str:
    """Get a safe key for a transcript path (hash to avoid filesystem issues)."""
    # Normalize path and hash it
    normalized = os.path.expanduser(transcript_path)
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def _load_sessions() -> dict:
    """Load all sessions from file."""
    if SESSIONS_FILE.exists():
        try:
            with open(SESSIONS_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {}


def _save_sessions(sessions: dict) -> None:
    """Save all sessions to file."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(SESSIONS_FILE, "w") as f:
        json.dump(sessions, f, indent=2)


def get_session_for_transcript(transcript_path: str) -> Optional[str]:
    """Get the Overlap session ID for a Claude transcript."""
    sessions = _load_sessions()
    key = _get_transcript_key(transcript_path)
    session_data = sessions.get(key)
    if session_data:
        return session_data.get("overlap_session_id")
    return None


def save_session_for_transcript(transcript_path: str, overlap_session_id: str, worktree: str) -> None:
    """Save an Overlap session ID for a Claude transcript."""
    import sys
    from datetime import datetime, timezone
    try:
        sessions = _load_sessions()
        key = _get_transcript_key(transcript_path)
        sessions[key] = {
            "overlap_session_id": overlap_session_id,
            "transcript_path": transcript_path,  # Store original for debugging
            "worktree": worktree,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        _save_sessions(sessions)
        if _logger:
            _logger.info("Session saved", overlap_session_id=overlap_session_id, transcript_path=transcript_path)
        print(f"[Overlap] Config: Saved session for transcript", file=sys.stderr)
    except Exception as e:
        if _logger:
            _logger.error("Failed to save session", exc=e, overlap_session_id=overlap_session_id)
        print(f"[Overlap] Config: FAILED to save session: {e}", file=sys.stderr)
        raise


def clear_session_for_transcript(transcript_path: str) -> None:
    """Clear the session for a Claude transcript."""
    try:
        sessions = _load_sessions()
        key = _get_transcript_key(transcript_path)
        if key in sessions:
            del sessions[key]
            _save_sessions(sessions)
            if _logger:
                _logger.info("Session cleared", transcript_path=transcript_path)
    except Exception as e:
        if _logger:
            _logger.warn("Failed to clear session", transcript_path=transcript_path, error=str(e))


def get_lock_file_for_transcript(transcript_path: str) -> Path:
    """Get the lock file path for a Claude transcript."""
    key = _get_transcript_key(transcript_path)
    return CONFIG_DIR / f"session-{key}.lock"


def is_configured() -> bool:
    """Check if the plugin is properly configured."""
    config = get_config()
    return all([
        config.get("server_url"),
        config.get("team_token"),
        config.get("user_token"),
    ])
