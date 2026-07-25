.PHONY: generate test verify open

generate:
	./scripts/generate.sh

test:
	swift test --package-path SignalGridMobileCore

verify:
	./scripts/verify.sh

open: generate
	open SignalGridMobile.xcodeproj
