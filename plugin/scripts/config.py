"""
Overlap plugin configuration.

This module loads configuration from:
1. Environment variables (OVERLAP_*)
2. Config file (~/.overlap/config.json)
"""

import json
import os
from pathlib import Path
from typing import Optional

CONFIG_DIR = Path.home() / ".overlap"
CONFIG_FILE = CONFIG_DIR / "config.json"
SESSION_FILE = CONFIG_DIR / "session.json"


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
        except (json.JSONDecodeError, IOError):
            pass

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
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def get_current_session() -> Optional[str]:
    """Get the current session ID if one is active."""
    if SESSION_FILE.exists():
        try:
            with open(SESSION_FILE) as f:
                data = json.load(f)
                return data.get("session_id")
        except (json.JSONDecodeError, IOError):
            pass
    return None


def save_current_session(session_id: str) -> None:
    """Save the current session ID."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(SESSION_FILE, "w") as f:
        json.dump({"session_id": session_id}, f)


def clear_current_session() -> None:
    """Clear the current session."""
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()


def is_configured() -> bool:
    """Check if the plugin is properly configured."""
    config = get_config()
    return all([
        config.get("server_url"),
        config.get("team_token"),
        config.get("user_token"),
    ])
