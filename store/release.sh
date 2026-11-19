#!/bin/bash
# Build a signed Play Store bundle (AAB) of Beyond Sagittarius in one command.
#
#   store/release.sh            # versionCode +1, same versionName
#   store/release.sh 1.1.0      # versionCode +1 and versionName 1.1.0
#   store/release.sh --same     # rebuild without bumping (only if this versionCode was never uploaded)
#
# Output: ~/beyond-sagittarius-release/beyond-sagittarius-<versionName>-<versionCode>.aab
# Needs: ~/tools/android-sdk, JDK 17+, and the upload key in ~/beyond-sagittarius-keys/ (see its README).
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/tools/android-sdk}"
HEAVY="$HOME/bin/heavy"; [ -x "$HEAVY" ] || HEAVY=""
V=android/app/version.properties
KEYS="${BS_KEYSTORE:-$HOME/beyond-sagittarius-keys/keystore.properties}"
[ -f "$KEYS" ] || { echo "No upload key at $KEYS (see ~/beyond-sagittarius-keys/README.md)"; exit 1; }

code=$(sed -n 's/^versionCode=//p' $V); name=$(sed -n 's/^versionName=//p' $V)
if [ "${1:-}" != "--same" ]; then
  code=$((code + 1)); [ -n "${1:-}" ] && name="$1"
  sed -i "s/^versionCode=.*/versionCode=$code/; s/^versionName=.*/versionName=$name/" $V
fi
echo "== Beyond Sagittarius $name (versionCode $code)"

$HEAVY npm run build
npx cap sync android
(cd android && $HEAVY ./gradlew --no-daemon --max-workers=4 -Dorg.gradle.jvmargs=-Xmx3g bundleRelease)

AAB=android/app/build/outputs/bundle/release/app-release.aab
OUT="$HOME/beyond-sagittarius-release"; mkdir -p "$OUT"
DEST="$OUT/beyond-sagittarius-$name-$code.aab"; cp "$AAB" "$DEST"
jarsigner -verify "$DEST" >/dev/null && echo "signed: ok"
python3 tools/android/check_aab.py "$DEST"
echo "== Upload $DEST in Play Console > Test and release > (track) > Create new release."
echo "   Then commit android/app/version.properties."
