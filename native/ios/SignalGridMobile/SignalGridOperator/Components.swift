import SwiftUI
import SignalGridMobileCore

struct BrandMark: View {
    var size: CGFloat = 28

    var body: some View {
        Grid(horizontalSpacing: 3, verticalSpacing: 3) {
            GridRow {
                square(opacity: 1)
                square(opacity: 0.6)
            }
            GridRow {
                square(opacity: 0.6)
                square(opacity: 0.34)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func square(opacity: Double) -> some View {
        RoundedRectangle(cornerRadius: 2.5, style: .continuous)
            .fill(Color.sgAccent.opacity(opacity))
    }
}

struct SGCard<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.sgCard)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.sgBorder, lineWidth: 1)
            }
    }
}

struct PublicSafetyBanner: View {
    let compact: Bool

    init(compact: Bool = false) {
        self.compact = compact
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "testtube.2")
                .foregroundStyle(Color.sgAccent)
            VStack(alignment: .leading, spacing: 3) {
                Text("Synthetic demo")
                    .font(.subheadline.weight(.semibold))
                if !compact {
                    Text("Fixture-backed decisions only. No live vendor calls, tenant data, PHI/PII, or production remediation.")
                        .font(.caption)
                        .foregroundStyle(Color.sgMuted)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color.sgAccent.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.sgAccent.opacity(0.35), lineWidth: 1)
        }
    }
}

struct OutcomeBadge: View {
    let outcome: DecisionOutcome

    var body: some View {
        Text(outcome.title.uppercased())
            .font(.caption2.monospaced().weight(.bold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .foregroundStyle(Color.outcome(outcome))
            .background(Color.outcome(outcome).opacity(0.12))
            .clipShape(Capsule())
            .overlay {
                Capsule().stroke(Color.outcome(outcome).opacity(0.35), lineWidth: 1)
            }
            .accessibilityLabel("Decision outcome \(outcome.title)")
    }
}

struct MetricTile: View {
    let title: String
    let value: String
    var note: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption2.monospaced().weight(.medium))
                .foregroundStyle(Color.sgMuted)
            Text(value)
                .font(.title2.monospacedDigit().weight(.bold))
            if let note {
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(Color.sgMuted)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
        .background(Color.sgCard)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .stroke(Color.sgBorder, lineWidth: 1)
        }
    }
}

struct SectionHeading: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.headline)
            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Color.sgMuted)
            }
        }
    }
}

struct LoadingStateView: View {
    let label: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(Color.sgAccent)
            Text(label)
                .font(.caption)
                .foregroundStyle(Color.sgMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
    }
}

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(Color.sgMuted)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.sgMuted)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
    }
}

struct ErrorCard: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        SGCard {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(Color.sgDeny)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Could not load SignalGrid")
                        .font(.headline)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(Color.sgMuted)
                    Button("Try again", action: retry)
                        .buttonStyle(.borderedProminent)
                }
            }
        }
    }
}

struct KeyValueRow: View {
    let key: String
    let value: String
    var valueColor: Color = .sgInk

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(key)
                .font(.caption)
                .foregroundStyle(Color.sgMuted)
            Spacer(minLength: 12)
            Text(value)
                .font(.caption.monospaced())
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
    }
}

struct ModePill: View {
    let isLive: Bool

    var body: some View {
        Label(isLive ? "Live API" : "Offline demo", systemImage: isLive ? "network" : "shippingbox")
            .font(.caption2.monospaced().weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background((isLive ? Color.sgAllow : Color.sgAccent).opacity(0.12))
            .foregroundStyle(isLive ? Color.sgAllow : Color.sgAccent)
            .clipShape(Capsule())
    }
}

enum ISODate {}
