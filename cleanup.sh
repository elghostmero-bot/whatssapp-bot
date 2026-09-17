#!/bin/bash
echo "Cleaning up old Chrome/WhatsApp profiles..."
rm -rf ~/.wwebjs_auth 2>/dev/null
rm -rf ~/.config/google-chrome 2>/dev/null
rm -rf /tmp/puppeteer* 2>/dev/null
echo "Cleanup complete"
