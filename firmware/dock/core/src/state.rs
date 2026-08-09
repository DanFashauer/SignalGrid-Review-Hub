//! The vocabularies a dock may report, mirroring `lib/signalgrid-core/src/types.ts`.
//!
//! These strings are a CONTRACT, not a convenience. The fabric normalises them by exact
//! match; a dock that reports "OK" instead of "none" contributes nothing, and — worse —
//! contributes nothing *quietly*. `scripts/check-dock-firmware-contract.mjs` derives the
//! allowed values from the TypeScript source and checks what this firmware actually
//! emits, so a divergence fails a build rather than a deployment.
//!
//! EVERY VOCABULARY HAS AN `Unknown`. That is not padding. A dock whose tamper switch
//! has stopped answering does not know there is no tamper — it knows nothing — and the
//! fabric's rule is that an unknown raises assurance rather than lowering it. A firmware
//! that cannot say "unknown" is forced to lie, and it will lie in the reassuring
//! direction, because that is the direction with no error path.

macro_rules! wire_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            /// The exact string the fabric expects. Nothing else is acceptable.
            pub const fn wire(self) -> &'static str {
                match self {
                    $(Self::$variant => $wire),+
                }
            }

            /// Every value, so tests and the fixture emitter can enumerate the
            /// vocabulary instead of listing it again and drifting.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
        }
    };
}

wire_enum!(
    /// Is a device physically in the bay, and is the bay working?
    DockState {
        Occupied => "occupied",
        Empty => "empty",
        Reserved => "reserved",
        Faulted => "faulted",
        Offline => "offline",
        Unknown => "unknown",
    }
);

wire_enum!(
    /// Battery FILL, not battery health. A dock that can only see a charge pin has
    /// nothing to say about health, and must not have "healthy" inferred for it.
    ChargeState {
        Charging => "charging",
        Charged => "charged",
        Low => "low",
        Critical => "critical",
        NotPresent => "not_present",
        Unknown => "unknown",
    }
);

wire_enum!(
    /// Battery HEALTH — a separate axis from fill, and usually unknown at the dock.
    BatteryHealthState {
        Healthy => "healthy",
        Degraded => "degraded",
        Failing => "failing",
        Unknown => "unknown",
    }
);

wire_enum!(
    /// `SensorUnavailable` is deliberately distinct from `Unknown`: "the switch is
    /// broken and I know it" is a different fact from "I have no reading", and an
    /// operator can act on the first.
    TamperState {
        None => "none",
        Suspected => "suspected",
        Confirmed => "confirmed",
        SensorUnavailable => "sensor_unavailable",
        Unknown => "unknown",
    }
);

wire_enum!(
    CustodyState {
        CheckedIn => "checked_in",
        CheckedOut => "checked_out",
        Overdue => "overdue",
        Exception => "exception",
        Maintenance => "maintenance",
        Unknown => "unknown",
    }
);

wire_enum!(
    /// Read by the reader case, not the dock. `Unknown` means no reader signal, and is
    /// never to be treated as `Absent` — "nobody is holding a badge to it" and "I
    /// cannot hear the reader" are different, and only one of them is safe.
    BadgeBindingState {
        Present => "present",
        Removed => "removed",
        Forced => "forced",
        Absent => "absent",
        Unknown => "unknown",
    }
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_vocabulary_can_say_unknown() {
        // The property the whole design rests on, asserted rather than assumed.
        assert!(DockState::ALL.contains(&DockState::Unknown));
        assert!(ChargeState::ALL.contains(&ChargeState::Unknown));
        assert!(BatteryHealthState::ALL.contains(&BatteryHealthState::Unknown));
        assert!(TamperState::ALL.contains(&TamperState::Unknown));
        assert!(CustodyState::ALL.contains(&CustodyState::Unknown));
        assert!(BadgeBindingState::ALL.contains(&BadgeBindingState::Unknown));
    }

    #[test]
    fn wire_strings_are_distinct_within_each_vocabulary() {
        // Two variants sharing a string would silently collapse two different facts
        // into one on the wire.
        fn distinct(values: &[&'static str]) -> bool {
            for (i, a) in values.iter().enumerate() {
                if values[i + 1..].contains(a) {
                    return false;
                }
            }
            true
        }
        macro_rules! check {
            ($t:ty) => {{
                let mut v = [""; 8];
                let all = <$t>::ALL;
                for (i, s) in all.iter().enumerate() {
                    v[i] = s.wire();
                }
                assert!(
                    distinct(&v[..all.len()]),
                    "duplicate wire string in {}",
                    stringify!($t)
                );
            }};
        }
        check!(DockState);
        check!(ChargeState);
        check!(BatteryHealthState);
        check!(TamperState);
        check!(CustodyState);
        check!(BadgeBindingState);
    }

    #[test]
    fn wire_strings_are_lower_snake_case() {
        // The fabric matches exactly. A stray capital or hyphen is a signal that
        // arrives and is discarded.
        for s in DockState::ALL
            .iter()
            .map(|v| v.wire())
            .chain(ChargeState::ALL.iter().map(|v| v.wire()))
            .chain(BatteryHealthState::ALL.iter().map(|v| v.wire()))
            .chain(TamperState::ALL.iter().map(|v| v.wire()))
            .chain(CustodyState::ALL.iter().map(|v| v.wire()))
            .chain(BadgeBindingState::ALL.iter().map(|v| v.wire()))
        {
            assert!(
                !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                "not lower_snake_case: {s:?}"
            );
        }
    }
}
