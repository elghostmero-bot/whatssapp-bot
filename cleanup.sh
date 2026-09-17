#!/bin/bash
set -e

AUTH_PATH="/app/.wwebjs_auth"

if [ -d "$AUTH_PATH" ]; then
  echo "🧹 Cleaning up Chrome locks..."
  
  # Remove singleton lock files
  rm -f "$AUTH_PATH/SingletonLock" 2>/dev/null || true
  rm -f "$AUTH_PATH/Default/SingletonLock" 2>/dev/null || true
  
  # Remove lock files recursively
  find "$AUTH_PATH" -name "*.lock" -delete 2>/dev/null || true
  find "$AUTH_PATH" -name "LOCK" -delete 2>/dev/null || true
  find "$AUTH_PATH" -name "chrome_profile.lock" -delete 2>/dev/null || true
  
  # Fix permissions
  chmod -R 755 "$AUTH_PATH" 2>/dev/null || true
  
  echo "✓ Cleanup complete"
fi

