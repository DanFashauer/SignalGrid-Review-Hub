#!/bin/bash

# EnterpriseShell iOS Code Analysis Script
# Run this locally before pushing to catch issues early

set -e

# Run from the script's own directory (native/ios) so paths resolve no matter
# where it is invoked from.
cd "$(dirname "$0")"

echo "========================================"
echo "EnterpriseShell Code Analysis"
echo "========================================"

# Check if we're in the right directory
if [ ! -d "EnterpriseShell" ]; then
    echo "Error: EnterpriseShell/ not found next to this script"
    exit 1
fi

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0
WARNINGS=0

# Helper function
check_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    PASSED=$((PASSED+1))
}

check_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    FAILED=$((FAILED+1))
}

check_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
    WARNINGS=$((WARNINGS+1))
}

echo ""
echo "1. Checking for SwiftLint..."
if command -v swiftlint &> /dev/null; then
    if swiftlint --config .swiftlint.yml 2>&1; then
        check_pass "SwiftLint passed"
    else
        check_fail "SwiftLint found issues"
    fi
else
    check_warn "SwiftLint not installed (brew install swiftlint)"
fi

echo ""
echo "2. Checking for hardcoded credentials..."
HARDCODED=$(grep -rn "password\s*=\s*[\"']" EnterpriseShell --include="*.swift" | grep -v "TODO\|FIXME\|// " || true)
if [ -z "$HARDCODED" ]; then
    check_pass "No hardcoded passwords"
else
    check_fail "Found hardcoded credentials:"
    echo "$HARDCODED"
fi

echo ""
echo "3. Checking for insecure URLs..."
HTTP_URLS=$(grep -rn "http://" EnterpriseShell --include="*.swift" | grep -v "localhost\|TODO\|FIXME" || true)
if [ -z "$HTTP_URLS" ]; then
    check_pass "All URLs use HTTPS"
else
    check_fail "Found HTTP URLs:"
    echo "$HTTP_URLS"
fi

echo ""
echo "4. Checking for print statements..."
PRINT_STMTS=$(grep -rn "print(" EnterpriseShell --include="*.swift" | grep -v "AuditLogger\|// " || true)
if [ -z "$PRINT_STMTS" ]; then
    check_pass "No print statements (using AuditLogger)"
else
    check_warn "Found print statements:"
    echo "$PRINT_STMTS"
fi

echo ""
echo "5. Checking for TODO/FIXME without severity..."
BAD_TODOS=$(grep -rn "TODO:\|FIXME:" EnterpriseShell --include="*.swift" | grep -v "HIGH\|MEDIUM\|LOW" || true)
if [ -z "$BAD_TODOS" ]; then
    check_pass "TODOs have severity levels"
else
    check_warn "TODOs without severity:"
    echo "$BAD_TODOS"
fi

echo ""
echo "6. Checking delegate memory safety..."
STRONG_DELEGATES=$(grep -rn "var.*Delegate\s*:\s*\w\+[^?]" EnterpriseShell/Services --include="*.swift" | grep -v "weak\|?" || true)
if [ -z "$STRONG_DELEGATES" ]; then
    check_pass "Delegates are weak or optional"
else
    check_warn "Potential strong delegates:"
    echo "$STRONG_DELEGATES"
fi

echo ""
echo "7. Checking for force unwraps..."
FORCE_UNWRAPS=$(grep -rn "!\s*as\|!\s*is" EnterpriseShell/Services --include="*.swift" | grep -v "// " || true)
if [ -z "$FORCE_UNWRAPS" ]; then
    check_pass "No force unwraps"
else
    check_warn "Force unwraps found:"
    echo "$FORCE_UNWRAPS" | head -5
fi

echo ""
echo "8. Checking Keychain usage..."
KEYCHAIN_ITEMS=$(grep -rn "kSecAttrAccessibleWhenUnlockedThisDeviceOnly" EnterpriseShell --include="*.swift" | wc -l)
if [ "$KEYCHAIN_ITEMS" -gt 0 ]; then
    check_pass "Keychain secure access used ($KEYCHAIN_ITEMS items)"
else
    check_warn "No Keychain items with secure access"
fi

echo ""
echo "9. Counting lines of code..."
TOTAL_LOC=$(find EnterpriseShell -name "*.swift" -exec cat {} \; 2>/dev/null | wc -l)
echo "Total Swift LOC: $TOTAL_LOC"

echo ""
echo "10. File structure..."
SERVICE_COUNT=$(find EnterpriseShell/Services -name "*.swift" 2>/dev/null | wc -l)
VIEW_COUNT=$(find EnterpriseShell/Views -name "*.swift" 2>/dev/null | wc -l)
MODEL_COUNT=$(find EnterpriseShell/Models -name "*.swift" 2>/dev/null | wc -l)
echo "Services: $SERVICE_COUNT | Views: $VIEW_COUNT | Models: $MODEL_COUNT"

echo ""
echo "========================================"
echo "Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Warnings: ${YELLOW}$WARNINGS${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"

if [ $FAILED -gt 0 ]; then
    echo ""
    echo -e "${RED}Code analysis FAILED${NC}"
    exit 1
elif [ $WARNINGS -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}Code analysis passed with warnings${NC}"
    exit 0
else
    echo ""
    echo -e "${GREEN}Code analysis PASSED${NC}"
    exit 0
fi
