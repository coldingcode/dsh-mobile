#!/usr/bin/env bash
set -eo pipefail

MODE="$1"
if [ -z "$MODE" ]; then MODE=unsigned; fi
OUT="$2"
if [ -z "$OUT" ]; then OUT="$PWD/dist/ios"; fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IOS_DIR="$ROOT/ios"
DERIVED="$ROOT/dist/DerivedData-ios"
mkdir -p "$OUT"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required: brew install xcodegen" >&2
  exit 1
fi

cd "$IOS_DIR"
xcodegen generate

XCCONFIG="$OUT/build.xcconfig"
: > "$XCCONFIG"
if [ -n "$MARKETING_VERSION" ]; then echo "MARKETING_VERSION = $MARKETING_VERSION" >> "$XCCONFIG"; fi
if [ -n "$CURRENT_PROJECT_VERSION" ]; then echo "CURRENT_PROJECT_VERSION = $CURRENT_PROJECT_VERSION" >> "$XCCONFIG"; fi
if [ -n "$IOS_BUNDLE_ID" ]; then echo "PRODUCT_BUNDLE_IDENTIFIER = $IOS_BUNDLE_ID" >> "$XCCONFIG"; fi

if [ "$MODE" = "unsigned" ]; then
  xcodebuild \
    -project dsh-mobile.xcodeproj \
    -scheme dsh-mobile \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$DERIVED" \
    -xcconfig "$XCCONFIG" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY="" \
    build

  APP_PATH="$(find "$DERIVED/Build/Products/Release-iphoneos" -maxdepth 1 -name '*.app' -print -quit)"
  if [ -z "$APP_PATH" ]; then
    echo "Built app not found" >&2
    exit 1
  fi
  rm -rf "$OUT/Payload" "$OUT/dsh-mobile-unsigned.ipa"
  mkdir -p "$OUT/Payload"
  cp -R "$APP_PATH" "$OUT/Payload/"
  (cd "$OUT" && zip -qry "dsh-mobile-unsigned.ipa" Payload)
  rm -rf "$OUT/Payload"
  echo "Unsigned IPA: $OUT/dsh-mobile-unsigned.ipa"
  exit 0
fi

if [ "$MODE" = "signed" ]; then
  if [ -z "$IOS_TEAM_ID" ]; then echo "IOS_TEAM_ID is required for a signed build" >&2; exit 1; fi
  if [ -z "$IOS_PROFILE_NAME" ]; then echo "IOS_PROFILE_NAME is required for a signed build" >&2; exit 1; fi
  if [ -z "$IOS_EXPORT_OPTIONS" ]; then echo "IOS_EXPORT_OPTIONS is required for a signed build" >&2; exit 1; fi

  ARCHIVE="$OUT/dsh-mobile.xcarchive"
  EXPORT_DIR="$OUT/export"
  rm -rf "$ARCHIVE" "$EXPORT_DIR"
  mkdir -p "$EXPORT_DIR"

  xcodebuild \
    -project dsh-mobile.xcodeproj \
    -scheme dsh-mobile \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" \
    -xcconfig "$XCCONFIG" \
    DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
    CODE_SIGN_STYLE=Manual \
    PROVISIONING_PROFILE_SPECIFIER="$IOS_PROFILE_NAME" \
    archive

  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$IOS_EXPORT_OPTIONS"

  IPA_PATH="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' -print -quit)"
  if [ -z "$IPA_PATH" ]; then
    echo "Exported IPA not found" >&2
    exit 1
  fi
  cp "$IPA_PATH" "$OUT/dsh-mobile-signed.ipa"
  echo "Signed IPA: $OUT/dsh-mobile-signed.ipa"
  exit 0
fi

echo "Unknown mode: $MODE (expected unsigned or signed)" >&2
exit 1
