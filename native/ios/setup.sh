#!/bin/bash

# Enterprise Shell iOS App Setup Script
# This script generates the Xcode project using XcodeGen

set -e

echo "🚀 Enterprise Shell - iOS Project Setup"
echo "========================================="

# Check if XcodeGen is installed
if ! command -v xcodegen &> /dev/null; then
    echo "📦 XcodeGen not found. Installing via Homebrew..."
    if ! command -v brew &> /dev/null; then
        echo "❌ Error: Homebrew is not installed. Please install Homebrew first."
        echo "   Visit: https://brew.sh"
        exit 1
    fi
    brew install xcodegen
fi

echo "✅ XcodeGen is installed"

# Navigate to iOS directory
cd "$(dirname "$0")"

# Generate Xcode project
echo "🔧 Generating Xcode project..."
xcodegen generate

if [ $? -eq 0 ]; then
    echo "✅ Xcode project generated successfully!"
    echo ""
    echo "📱 To open the project:"
    echo "   open ios/EnterpriseShell.xcodeproj"
    echo ""
    echo "🔧 To build from command line:"
    echo "   xcodebuild -project ios/EnterpriseShell.xcodeproj -scheme EnterpriseShell -sdk ipados -configuration Debug build"
    echo ""
    echo "📝 Note: You'll need to:"
    echo "   1. Set your Development Team in Xcode"
    echo "   2. Configure the OIDC client ID and tenant ID in OIDCAuthService.swift"
    echo "   3. Configure the backend URL in BackendService.swift"
    echo "   4. Configure the badge reader protocol string in BadgeReaderManager.swift"
else
    echo "❌ Failed to generate Xcode project"
    exit 1
fi
