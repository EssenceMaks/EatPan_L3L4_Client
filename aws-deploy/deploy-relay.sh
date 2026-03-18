#!/bin/bash
# deploy-relay.sh — Deploy updated relay to EC2
# Usage: bash deploy-relay.sh
#
# Prerequisites:
#   - SSH key for EC2 (eatpan-relay.pem) in ~/.ssh/ or current dir
#   - EC2 instance running at relay.eatpan.com

EC2_HOST="ec2-user@relay.eatpan.com"
EC2_DIR="/opt/eatpan"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/eatpan-relay.pem}"

# Check SSH key
if [ ! -f "$SSH_KEY" ]; then
  echo "❌ SSH key not found: $SSH_KEY"
  echo "   Set SSH_KEY env var or place key at ~/.ssh/eatpan-relay.pem"
  exit 1
fi

echo "📦 Deploying relay to $EC2_HOST:$EC2_DIR..."

# Upload files
scp -i "$SSH_KEY" relay.mjs "$EC2_HOST:$EC2_DIR/relay.mjs"
scp -i "$SSH_KEY" ../polyfill.mjs "$EC2_HOST:$EC2_DIR/polyfill.mjs"

# Restart the relay service
echo "🔄 Restarting eatpan-relay service..."
ssh -i "$SSH_KEY" "$EC2_HOST" "cd $EC2_DIR && sudo systemctl restart eatpan-relay || (pm2 restart relay || node relay.mjs &)"

echo "✅ Relay deployed!"
echo "   Verify: ssh -i $SSH_KEY $EC2_HOST 'journalctl -u eatpan-relay -n 20'"
