"""
Overlap plugin logging.

Provides structured logging with:
- Log levels (DEBUG, INFO, WARN, ERROR)
- Automatic context (timestamp, hook, session)
- File rotation (5 files, 1MB each)
- Sensitive data sanitization
- Server sync (sends logs to Overlap server for admin viewing)
"""

from __future__ import annotations

import atexit
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.request import Request, urlopen
from urllib.error import URLError

# Log storage - same directory as other plugin data
LOG_DIR = Path.home() / ".claude" / "overlap" / "logs"
LOG_FILE = LOG_DIR / "overlap.log"
MAX_LOG_SIZE = 1_000_000  # 1MB
MAX_LOG_FILES = 5

# Server sync settings
LOG_BUFFER: list[dict] = []
MAX_BUFFER_SIZE = 50  # Send when buffer reaches this size
_syncing = False  # Prevent recursion when sending logs

# Log levels
DEBUG = 10
INFO = 20
WARN = 30
ERROR = 40

LEVEL_NAMES = {DEBUG: "DEBUG", INFO: "INFO", WARN: "WARN", ERROR: "ERROR"}

# Current context (set by each hook)
_context: dict[str, Any] = {}


def set_context(hook: str, session_id: Optional[str] = None, **kwargs) -> None:
    """Set logging context for current hook execution."""
    global _context
    _context = {
        "hook": hook,
        "session_id": session_id,
        "pid": os.getpid(),
        **kwargs
    }


def _sanitize(data: Any) -> Any:
    """Remove sensitive data from log entries."""
    if isinstance(data, dict):
        sanitized = {}
        for key, value in data.items():
            lower_key = key.lower()
            if any(s in lower_key for s in ("token", "key", "secret", "password", "auth")):
                sanitized[key] = "[REDACTED]" if value else None
            elif lower_key == "server_url" and value:
                # Keep domain, redact query params that might have tokens
                sanitized[key] = value.split("?")[0]
            else:
                sanitized[key] = _sanitize(value)
        return sanitized
    elif isinstance(data, list):
        return [_sanitize(item) for item in data]
    elif isinstance(data, str) and len(data) > 1000:
        return data[:1000] + f"... [truncated {len(data) - 1000} chars]"
    return data


def _rotate_logs() -> None:
    """Rotate log files if current exceeds max size."""
    if not LOG_FILE.exists():
        return

    try:
        if LOG_FILE.stat().st_size < MAX_LOG_SIZE:
            return
    except OSError:
        return

    # Rotate: overlap.log.4 -> deleted, .3 -> .4, etc.
    for i in range(MAX_LOG_FILES - 1, 0, -1):
        old = LOG_DIR / f"overlap.log.{i}"
        new = LOG_DIR / f"overlap.log.{i + 1}"
        if old.exists():
            try:
                if i == MAX_LOG_FILES - 1:
                    old.unlink()
                else:
                    old.rename(new)
            except OSError:
                pass

    # Current -> .1
    try:
        LOG_FILE.rename(LOG_DIR / "overlap.log.1")
    except OSError:
        pass


def _get_config() -> dict:
    """Get config without importing config module (avoid circular import)."""
    config_file = Path.home() / ".claude" / "overlap" / "config.json"
    config = {
        "server_url": os.environ.get("OVERLAP_SERVER_URL"),
        "team_token": os.environ.get("OVERLAP_TEAM_TOKEN"),
        "user_token": os.environ.get("OVERLAP_USER_TOKEN"),
    }

    if config_file.exists():
        try:
            with open(config_file) as f:
                file_config = json.load(f)
                # Only use file config if env var not set
                for key in config:
                    if not config[key] and key in file_config:
                        config[key] = file_config[key]
        except (json.JSONDecodeError, IOError):
            pass

    return config


def _sync_to_server() -> None:
    """Send buffered logs to the server."""
    global LOG_BUFFER, _syncing

    if _syncing or not LOG_BUFFER:
        return

    _syncing = True
    logs_to_send = LOG_BUFFER[:]
    LOG_BUFFER = []

    try:
        config = _get_config()
        if not all([config.get("server_url"), config.get("user_token"), config.get("team_token")]):
            return

        url = f"{config['server_url'].rstrip('/')}/api/v1/logs"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config['user_token']}",
            "X-Team-Token": config["team_token"],
        }

        # Transform logs for API
        api_logs = []
        for log in logs_to_send:
            api_log = {
                "level": log.get("level", "INFO"),
                "hook": log.get("hook"),
                "session_id": log.get("session_id"),
                "message": log.get("msg", ""),
                "data": log.get("data"),
                "error": log.get("error"),
                "timestamp": log.get("ts"),
            }
            api_logs.append(api_log)

        body = json.dumps({"logs": api_logs}).encode()
        request = Request(url, data=body, headers=headers, method="POST")

        with urlopen(request, timeout=5) as response:
            pass  # Success - don't log (would cause recursion)

    except (URLError, OSError, json.JSONDecodeError):
        # Failed to send - logs are still in local file
        pass
    finally:
        _syncing = False


def _write_log(level: int, message: str, data: Optional[dict] = None,
               exc: Optional[Exception] = None) -> None:
    """Write a log entry to file and buffer for server sync."""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        _rotate_logs()

        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": LEVEL_NAMES.get(level, "INFO"),
            "msg": message,
            **_context
        }

        if data:
            entry["data"] = _sanitize(data)

        if exc:
            entry["error"] = {
                "type": type(exc).__name__,
                "message": str(exc),
                "traceback": traceback.format_exc()
            }

        # Write to local file
        with open(LOG_FILE, "a") as f:
            f.write(json.dumps(entry) + "\n")

        # Buffer for server sync (skip DEBUG and don't buffer while syncing)
        if level >= INFO and not _syncing:
            LOG_BUFFER.append(entry)

            # Send if buffer is full
            if len(LOG_BUFFER) >= MAX_BUFFER_SIZE:
                _sync_to_server()

    except Exception as e:
        # Last resort: stderr (don't recurse)
        print(f"[Overlap] Logger failed: {e}", file=sys.stderr)


def flush() -> None:
    """Flush buffered logs to server. Call at end of hook execution."""
    _sync_to_server()


# Register flush to run at exit
atexit.register(flush)


def debug(message: str, **data) -> None:
    """Log debug message (only when OVERLAP_DEBUG is set)."""
    if os.environ.get("OVERLAP_DEBUG"):
        _write_log(DEBUG, message, data if data else None)


def info(message: str, **data) -> None:
    """Log info message."""
    _write_log(INFO, message, data if data else None)


def warn(message: str, **data) -> None:
    """Log warning message."""
    _write_log(WARN, message, data if data else None)


def error(message: str, exc: Optional[Exception] = None, **data) -> None:
    """Log error message with optional exception."""
    _write_log(ERROR, message, data if data else None, exc)


class RequestContext:
    """Context manager for tracking HTTP request timing."""

    def __init__(self, method: str, url: str, payload_size: int = 0):
        self.request_id = datetime.now(timezone.utc).strftime("%H%M%S%f")[:12]
        self.method = method
        self.url = url.split("?")[0]  # Strip query params
        self.payload_size = payload_size
        self.start_time = datetime.now(timezone.utc)

    def log_start(self) -> None:
        """Log the start of the request."""
        info("HTTP request",
             request_id=self.request_id,
             method=self.method,
             url=self.url,
             payload_size=self.payload_size)

    def log_success(self, status: int) -> None:
        """Log a successful response."""
        elapsed_ms = self._elapsed_ms()
        info("HTTP response",
             request_id=self.request_id,
             status=status,
             elapsed_ms=elapsed_ms)

    def log_error(self, status: int, error_msg: Optional[str] = None,
                  exc: Optional[Exception] = None) -> None:
        """Log a failed response."""
        elapsed_ms = self._elapsed_ms()
        if exc:
            error("HTTP request failed",
                  exc=exc,
                  request_id=self.request_id,
                  elapsed_ms=elapsed_ms)
        else:
            warn("HTTP error response",
                 request_id=self.request_id,
                 status=status,
                 error_msg=error_msg,
                 elapsed_ms=elapsed_ms)

    def _elapsed_ms(self) -> float:
        """Calculate elapsed time in milliseconds."""
        return round((datetime.now(timezone.utc) - self.start_time).total_seconds() * 1000, 2)


def log_request(method: str, url: str, payload_size: int = 0) -> RequestContext:
    """
    Start logging an HTTP request.

    Returns a RequestContext that should be used to log the response.

    Usage:
        ctx = logger.log_request("POST", url, len(body))
        ctx.log_start()
        try:
            response = urlopen(...)
            ctx.log_success(response.status)
        except Exception as e:
            ctx.log_error(0, exc=e)
    """
    return RequestContext(method, url, payload_size)
