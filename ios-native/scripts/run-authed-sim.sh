#!/usr/bin/env bash
# Run the native portal AUTHENTICATED on the iOS Simulator — headless.
#
# Your password is read locally (read -s) and sent only to the prod login
# endpoint to obtain a session token; it is never stored or printed. The token
# is passed to the Debug build via the launch environment (NURU_ACCESS_TOKEN),
# which AuthStore picks up under #if DEBUG only.
#
# Usage:  ios-native/scripts/run-authed-sim.sh [simulator-name]
set -euo pipefail

API="https://pathway.nuruplace.org/v1"
BUNDLE="org.nuruplace.portal"
SCHEME="NuruPortal"
PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DD="/tmp/nuru-native-dd"
SIM_NAME="${1:-iPad Pro 13-inch (M5)}"

read -r -p "Portal email: " EMAIL
read -r -s -p "Password: " PASSWORD; echo

echo "→ Signing in…"
RESP="$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":$(printf '%s' "$EMAIL" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),\"password\":$(printf '%s' "$PASSWORD" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}")"
unset PASSWORD

# Handle a 2FA challenge if the account has it on.
if printf '%s' "$RESP" | grep -q '"mfa_required"'; then
  MFA_TOKEN="$(printf '%s' "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin)["mfa_token"])')"
  read -r -p "2FA code: " CODE
  RESP="$(curl -s -X POST "$API/auth/login/mfa" -H 'Content-Type: application/json' \
    -d "{\"mfa_token\":\"$MFA_TOKEN\",\"code\":\"$CODE\"}")"
fi

ACCESS="$(printf '%s' "$RESP"  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("access_token",""))')"
REFRESH="$(printf '%s' "$RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("refresh_token",""))')"
if [ -z "$ACCESS" ]; then
  echo "✗ Login failed: $RESP"; exit 1
fi
echo "✓ Got a session."

echo "→ Building (Debug, simulator)…"
xcodebuild -project "$PROJ_DIR/NuruPortal.xcodeproj" -scheme "$SCHEME" \
  -sdk iphonesimulator -configuration Debug \
  -destination "generic/platform=iOS Simulator" \
  CODE_SIGNING_ALLOWED=NO -derivedDataPath "$DD" build >/dev/null

APP="$DD/Build/Products/Debug-iphonesimulator/$SCHEME.app"
UDID="$(xcrun simctl list devices available | grep -F "$SIM_NAME" | head -1 | grep -oE '[0-9A-F-]{36}')"
[ -z "$UDID" ] && { echo "✗ No simulator named '$SIM_NAME'"; exit 1; }

xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator
xcrun simctl install "$UDID" "$APP"
echo "→ Launching authenticated…"
SIMCTL_CHILD_NURU_ACCESS_TOKEN="$ACCESS" \
SIMCTL_CHILD_NURU_REFRESH_TOKEN="$REFRESH" \
  xcrun simctl launch --terminate-running-process "$UDID" "$BUNDLE"
echo "✓ Running signed in on $SIM_NAME."
