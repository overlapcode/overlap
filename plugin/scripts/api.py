"""
Overlap API client.

Simple HTTP client for communicating with the Overlap server.
"""

import json
import socket
import subprocess
import sys
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from config import get_config


def api_request(
    method: str,
    endpoint: str,
    data: Optional[dict] = None,
    timeout: int = 5
) -> dict:
    """
    Make an API request to the Overlap server.

    Args:
        method: HTTP method (GET, POST, etc.)
        endpoint: API endpoint (e.g., /api/v1/sessions/start)
        data: JSON data to send (for POST/PUT)
        timeout: Request timeout in seconds

    Returns:
        Response data as dict

    Raises:
        Exception: If request fails
    """
    config = get_config()

    if not config.get("server_url"):
        raise Exception("Overlap server URL not configured")

    url = f"{config['server_url'].rstrip('/')}{endpoint}"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.get('user_token', '')}",
        "X-Team-Token": config.get("team_token", ""),
    }

    body = json.dumps(data).encode() if data else None

    request = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode())
    except HTTPError as e:
        error_body = e.read().decode()
        try:
            error_data = json.loads(error_body)
            raise Exception(error_data.get("error", f"HTTP {e.code}"))
        except json.JSONDecodeError:
            raise Exception(f"HTTP {e.code}: {error_body}")
    except URLError as e:
        raise Exception(f"Connection error: {e.reason}")
    except socket.timeout:
        raise Exception("Request timed out")


def get_hostname() -> str:
    """Get the current machine's hostname."""
    return socket.gethostname()


def get_device_name() -> str:
    """Get a friendly device name."""
    hostname = get_hostname()
    # Try to get a more descriptive name on macOS
    try:
        result = subprocess.run(
            ["scutil", "--get", "ComputerName"],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return hostname


def get_git_info(cwd: str) -> dict:
    """Get git repository information."""
    info = {
        "repo_name": None,
        "remote_url": None,
        "branch": None,
    }

    try:
        # Get remote URL
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=2
        )
        if result.returncode == 0:
            info["remote_url"] = result.stdout.strip()
            # Extract repo name from URL
            remote = info["remote_url"]
            if remote.endswith(".git"):
                remote = remote[:-4]
            info["repo_name"] = remote.split("/")[-1]

        # Get current branch
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=2
        )
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()

    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return info


def is_remote_session() -> bool:
    """Check if running in a remote session (SSH, etc.)."""
    # Check common remote indicators
    if os.environ.get("SSH_CLIENT") or os.environ.get("SSH_TTY"):
        return True
    if os.environ.get("CLAUDE_CODE_REMOTE") == "true":
        return True
    return False


# Import os for is_remote_session
import os
