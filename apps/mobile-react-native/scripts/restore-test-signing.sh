#!/usr/bin/env bash
# Debug/device-test signing only. Never generate a replacement key in CI.
set -euo pipefail
: "${SEMITRAX_TEST_KEYSTORE_BASE64:?Configure the persistent test keystore secret first}"
: "${SEMITRAX_TEST_CERT_SHA256:?Configure the expected test certificate fingerprint first}"
: "${GITHUB_ENV:?This script is for GitHub Actions}"
expected=$(printf '%s' "$SEMITRAX_TEST_CERT_SHA256" | tr '[:upper:]' '[:lower:]' | tr -d ':[:space:]')
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo "Invalid expected certificate fingerprint"; exit 1; }
umask 077
mkdir -p "$HOME/.android"
keyfile="$HOME/.android/debug.keystore"
printf '%s' "$SEMITRAX_TEST_KEYSTORE_BASE64" | base64 --decode > "$keyfile"
# Validate the alias/password used by Gradle's default debug signing configuration.
actual=$(keytool -exportcert -keystore "$keyfile" -alias androiddebugkey -storepass android | sha256sum | cut -d ' ' -f 1)
[[ "$actual" = "$expected" ]] || { rm -f "$keyfile"; echo "Signing certificate mismatch"; exit 1; }
printf 'SEMITRAX_VERIFIED_CERT_SHA256=%s\n' "$actual" >> "$GITHUB_ENV"
