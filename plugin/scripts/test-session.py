#!/usr/bin/env python3
"""
Test script to verify session creation works.
Run this manually to test the session-start hook logic.

Usage:
    python3 plugin/scripts/test-session.py
"""

import json
import sys
import os
from pathlib import Path

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import get_config, is_configured, save_current_session, get_current_session, CONFIG_DIR, SESSION_FILE

print("=== Overlap Session Test ===\n")

# 1. Check configuration
print("1. Checking configuration...")
config = get_config()
print(f"   Config dir: {CONFIG_DIR}")
print(f"   Session file: {SESSION_FILE}")
print(f"   Server URL: {config.get('server_url', 'NOT SET')}")
print(f"   Team token: {'SET' if config.get('team_token') else 'NOT SET'}")
print(f"   User token: {'SET' if config.get('user_token') else 'NOT SET'}")
print(f"   Is configured: {is_configured()}")
print()

# 2. Check if session file directory exists
print("2. Checking directories...")
print(f"   Home dir: {Path.home()}")
print(f"   Config dir exists: {CONFIG_DIR.exists()}")
print(f"   Session file exists: {SESSION_FILE.exists()}")
print()

# 3. Try to create config dir
print("3. Testing directory creation...")
try:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    print(f"   SUCCESS: Config dir created/exists at {CONFIG_DIR}")
except Exception as e:
    print(f"   FAILED: Could not create config dir: {e}")
print()

# 4. Test file write
print("4. Testing file write...")
test_session_id = "test-session-12345"
try:
    save_current_session(test_session_id)
    print(f"   SUCCESS: Wrote session file")

    # Verify it was written
    saved = get_current_session()
    if saved == test_session_id:
        print(f"   SUCCESS: Read back session ID matches: {saved}")
    else:
        print(f"   MISMATCH: Expected {test_session_id}, got {saved}")
except Exception as e:
    print(f"   FAILED: {e}")
print()

# 5. Show file contents
print("5. Session file contents...")
if SESSION_FILE.exists():
    with open(SESSION_FILE) as f:
        print(f"   {f.read()}")
else:
    print("   File does not exist")
print()

# 6. Test API connection (if configured)
if is_configured():
    print("6. Testing API connection...")
    try:
        from api import api_request, get_hostname, get_device_name, get_git_info

        hostname = get_hostname()
        device_name = get_device_name()
        print(f"   Hostname: {hostname}")
        print(f"   Device name: {device_name}")

        # Try to start a test session
        request_data = {
            "session_id": f"test-{os.getpid()}",
            "device_name": device_name,
            "hostname": hostname,
            "is_remote": False,
            "worktree": os.getcwd(),
        }

        print(f"   Calling API...")
        response = api_request("POST", "/api/v1/sessions/start", request_data)
        print(f"   Response: {json.dumps(response, indent=2)}")

        server_session_id = response.get("data", {}).get("session_id")
        if server_session_id:
            print(f"   SUCCESS: Got session ID from server: {server_session_id}")
            save_current_session(server_session_id)
            print(f"   SUCCESS: Saved session ID locally")
        else:
            print(f"   WARNING: No session_id in response")

    except Exception as e:
        print(f"   FAILED: {e}")
        import traceback
        traceback.print_exc()
else:
    print("6. Skipping API test (not configured)")

print("\n=== Test Complete ===")
