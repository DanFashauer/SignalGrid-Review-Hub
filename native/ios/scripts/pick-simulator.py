#!/usr/bin/env python3
"""Pick one available simulator of a given device family, or fail saying so.

Usage:
    xcrun simctl list devices available -j | python3 pick-simulator.py iPhone
    python3 pick-simulator.py --self-test

Prints "<udid>\t<name>" on success. Exits non-zero with a message on stderr when
the family is not present.

WHY THIS IS A FILE AND NOT A LINE IN THE WORKFLOW. It has one behaviour worth
getting right, and that behaviour is a refusal: when no iPad exists on the runner,
this must fail rather than hand back an iPhone. CI used to pick "the first
available iOS simulator" and build against whatever came back, which is how the
iPad half of TARGETED_DEVICE_FAMILY "1,2" went years without ever being built. A
fallback here would restore exactly that: a green job that quietly tested the same
device twice. Being a file means the refusal has a test (--self-test), and means a
developer can run the same selection locally.

Matching is on the device NAME PREFIX, because that is what simctl gives us —
there is no device-family field in the JSON. "iPhone 17" and "iPad Pro 13-inch
(M4)" both start with their family, and no iPad model name begins with "iPhone".
"""

import json
import sys

USAGE = "usage: ... | pick-simulator.py <family>   (or: pick-simulator.py --self-test)"


def pick(payload, family):
    """Return (udid, name) for the first available simulator of `family`.

    Raises LookupError when there is none. Deliberately does NOT return None:
    a caller that forgets to check None gets a device; a caller that forgets to
    catch an exception gets a crash. Only one of those can be mistaken for success.
    """
    devices = payload.get("devices")
    if not isinstance(devices, dict):
        raise LookupError("simctl output had no 'devices' object — could not enumerate at all")
    hits = [
        d
        for runtime, entries in devices.items()
        if "iOS" in runtime
        for d in entries
        if d.get("isAvailable") and str(d.get("name", "")).startswith(family)
    ]
    if not hits:
        raise LookupError(f"no available {family} simulator in any iOS runtime")
    return hits[0]["udid"], hits[0]["name"]


def self_test():
    """Negative controls. The one that matters is the third: absence must raise."""
    fixture = {
        "devices": {
            "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
                {"udid": "AAA", "name": "iPhone 16", "isAvailable": True},
                {"udid": "BBB", "name": "iPhone 16 Pro", "isAvailable": False},
                {"udid": "CCC", "name": "iPad Pro 13-inch (M4)", "isAvailable": True},
            ],
            "com.apple.CoreSimulator.SimRuntime.watchOS-11-2": [
                {"udid": "DDD", "name": "Apple Watch Series 10", "isAvailable": True},
            ],
        }
    }
    failures = 0

    def check(label, ok):
        nonlocal failures
        if not ok:
            failures += 1
        print(f"  {'ok' if ok else 'FAIL'} — {label}")

    check("picks an available iPhone", pick(fixture, "iPhone") == ("AAA", "iPhone 16"))
    check("picks an iPad, not the iPhone that comes first", pick(fixture, "iPad")[0] == "CCC")

    # The whole point of the file. An absent family must raise, never fall back.
    try:
        pick(fixture, "iPad")  # present, so this must NOT raise
        no_fallback = True
    except LookupError:
        no_fallback = False
    check("a present family does not raise", no_fallback)

    empty = {"devices": {"com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
        {"udid": "AAA", "name": "iPhone 16", "isAvailable": True},
    ]}}
    try:
        pick(empty, "iPad")
        check("an absent family raises instead of falling back to iPhone", False)
    except LookupError:
        check("an absent family raises instead of falling back to iPhone", True)

    unavailable = {"devices": {"com.apple.CoreSimulator.SimRuntime.iOS-18-2": [
        {"udid": "BBB", "name": "iPad mini", "isAvailable": False},
    ]}}
    try:
        pick(unavailable, "iPad")
        check("an unavailable device does not count as available", False)
    except LookupError:
        check("an unavailable device does not count as available", True)

    try:
        pick({}, "iPhone")
        check("output with no devices object raises", False)
    except LookupError:
        check("output with no devices object raises", True)

    # A non-iOS runtime must not satisfy an iOS request.
    watch_only = {"devices": {"com.apple.CoreSimulator.SimRuntime.watchOS-11-2": [
        {"udid": "DDD", "name": "iPhone-shaped watch thing", "isAvailable": True},
    ]}}
    try:
        pick(watch_only, "iPhone")
        check("a non-iOS runtime does not satisfy an iOS request", False)
    except LookupError:
        check("a non-iOS runtime does not satisfy an iOS request", True)

    return failures


def main():
    args = sys.argv[1:]
    if args == ["--self-test"]:
        print("pick-simulator self-test:")
        failures = self_test()
        print("self-test: pass" if failures == 0 else f"self-test: {failures} FAILED")
        sys.exit(0 if failures == 0 else 1)
    if len(args) != 1:
        print(USAGE, file=sys.stderr)
        sys.exit(2)

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"could not parse simctl JSON: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        udid, name = pick(payload, args[0])
    except LookupError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    print(f"{udid}\t{name}")


if __name__ == "__main__":
    main()
