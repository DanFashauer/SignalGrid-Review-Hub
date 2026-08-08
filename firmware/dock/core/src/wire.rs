//! Encoding a [`CustodyEvent`] as the JSON the fabric expects, with no allocator.
//!
//! THE RULE THIS FILE EXISTS FOR: **a buffer that does not fit produces NOTHING.**
//!
//! The tempting embedded shortcut is to write until the buffer is full and send what
//! fits. Truncated JSON usually fails to parse, which is survivable — but sometimes it
//! parses, because the cut landed after a closing brace or dropped exactly the field
//! that would have raised assurance. A record that arrives missing its `tamperState` is
//! indistinguishable from a dock that had nothing to report. So every write is checked,
//! and a single overflow abandons the whole encode.
//!
//! Field names are camelCase to match `DockCustodyRecord` in
//! `lib/signalgrid-core/src/dock.ts`. `scripts/check-dock-firmware-contract.mjs` checks
//! what this actually emits against that TypeScript source.

use crate::custody::CustodyEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncodeError {
    /// The event did not fit. Nothing was emitted.
    BufferTooSmall,
    /// A configured string carried a character this encoder will not emit. See
    /// [`Writer::str`] — refusing is deliberate.
    UnencodableField(&'static str),
}

/// Identity fields, set once at provisioning. Borrowed rather than owned: a dock has no
/// allocator and these live in flash or a config partition.
#[derive(Debug, Clone, Copy)]
pub struct DockIdentity<'a> {
    pub device_ref: &'a str,
    pub hardware_vendor: &'a str,
    pub hardware_model: &'a str,
    pub case_serial: &'a str,
    pub dock_id: &'a str,
    pub bay_id: &'a str,
    /// RFC3339, produced by the caller's clock. Not generated here: a firmware core
    /// with a hidden clock is untestable, and this repo's rule is that decision paths
    /// take time as an input.
    pub observed_at: &'a str,
    pub source_reference: &'a str,
}

struct Writer<'a> {
    buf: &'a mut [u8],
    at: usize,
    overflowed: bool,
}

impl<'a> Writer<'a> {
    fn new(buf: &'a mut [u8]) -> Self {
        Writer {
            buf,
            at: 0,
            overflowed: false,
        }
    }

    fn raw(&mut self, s: &str) {
        let bytes = s.as_bytes();
        if self.overflowed || self.at + bytes.len() > self.buf.len() {
            self.overflowed = true;
            return;
        }
        self.buf[self.at..self.at + bytes.len()].copy_from_slice(bytes);
        self.at += bytes.len();
    }

    /// Write a JSON string.
    ///
    /// REFUSES rather than escapes. A dock's identity fields are serials, model names
    /// and IDs set at provisioning; none of them legitimately contains a quote, a
    /// backslash, or a control character. Rather than carry an escaper that could be
    /// subtly wrong — and would be the only place in this firmware where a config value
    /// changes shape on its way out — anything outside printable ASCII is an error the
    /// caller must fix at provisioning time, not a value silently mangled in the field.
    fn str(&mut self, s: &str, field: &'static str) -> Result<(), EncodeError> {
        if !s
            .bytes()
            .all(|b| (0x20..0x7f).contains(&b) && b != b'"' && b != b'\\')
        {
            return Err(EncodeError::UnencodableField(field));
        }
        self.raw("\"");
        self.raw(s);
        self.raw("\"");
        Ok(())
    }

    fn finish(self) -> Result<usize, EncodeError> {
        if self.overflowed {
            Err(EncodeError::BufferTooSmall)
        } else {
            Ok(self.at)
        }
    }
}

/// Encode one event. On success returns the number of bytes written to `buf`.
///
/// On ANY error the caller must treat `buf` as meaningless — it may hold a partial
/// record, and that partial record must never be transmitted.
pub fn encode(
    identity: &DockIdentity<'_>,
    event: &CustodyEvent,
    buf: &mut [u8],
) -> Result<usize, EncodeError> {
    let mut w = Writer::new(buf);

    w.raw("{");
    for (key, value, field) in [
        ("deviceRef", identity.device_ref, "deviceRef"),
        ("hardwareVendor", identity.hardware_vendor, "hardwareVendor"),
        ("hardwareModel", identity.hardware_model, "hardwareModel"),
        ("caseSerial", identity.case_serial, "caseSerial"),
        ("dockId", identity.dock_id, "dockId"),
        ("bayId", identity.bay_id, "bayId"),
    ] {
        w.raw("\"");
        w.raw(key);
        w.raw("\":");
        w.str(value, field)?;
        w.raw(",");
    }

    for (key, value) in [
        ("chargeState", event.charge_state.wire()),
        ("batteryHealth", event.battery_health.wire()),
        ("dockState", event.dock_state.wire()),
        ("custodyState", event.custody_state.wire()),
        ("tamperState", event.tamper_state.wire()),
        ("badgeBinding", event.badge_binding.wire()),
    ] {
        w.raw("\"");
        w.raw(key);
        w.raw("\":\"");
        w.raw(value);
        w.raw("\",");
    }

    w.raw("\"observedAt\":");
    w.str(identity.observed_at, "observedAt")?;
    w.raw(",\"sourceReference\":");
    w.str(identity.source_reference, "sourceReference")?;
    w.raw("}");

    w.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::custody::{DockUnit, Reading, SensorFrame};
    use crate::state::{BadgeBindingState, BatteryHealthState};

    fn identity() -> DockIdentity<'static> {
        DockIdentity {
            device_ref: "dev_0d41",
            hardware_vendor: "acme",
            hardware_model: "smartdock-8",
            case_serial: "CS-00931",
            dock_id: "dock_ward_3a",
            bay_id: "bay_04",
            observed_at: "2026-08-08T15:00:00Z",
            source_reference: "firmware/1.0.0",
        }
    }

    fn an_event() -> CustodyEvent {
        let mut unit = DockUnit::new();
        unit.evaluate(&SensorFrame {
            bay_occupied: Reading::Value(true),
            charge_percent: Reading::Value(Some(80)),
            charging: Reading::Value(true),
            battery_health: Reading::Value(BatteryHealthState::Healthy),
            enclosure_intact: Reading::Value(true),
            badge: Reading::Value(BadgeBindingState::Absent),
            checkout_registered: Reading::Value(false),
            maintenance_flagged: Reading::Value(false),
            uplink_ok: Reading::Value(true),
        })
    }

    #[test]
    fn a_full_event_encodes_and_carries_every_field() {
        let mut buf = [0u8; 512];
        let n = encode(&identity(), &an_event(), &mut buf).expect("should fit");
        let s = core::str::from_utf8(&buf[..n]).unwrap();
        for key in [
            "deviceRef",
            "hardwareVendor",
            "hardwareModel",
            "caseSerial",
            "dockId",
            "bayId",
            "chargeState",
            "batteryHealth",
            "dockState",
            "custodyState",
            "tamperState",
            "badgeBinding",
            "observedAt",
            "sourceReference",
        ] {
            assert!(s.contains(key), "missing {key} in {s}");
        }
        assert!(s.starts_with('{') && s.ends_with('}'));
    }

    #[test]
    fn a_buffer_one_byte_short_produces_nothing_rather_than_a_truncated_record() {
        // The rule this file exists for. A record missing its tamperState is
        // indistinguishable from a dock with nothing to report.
        let mut buf = [0u8; 512];
        let n = encode(&identity(), &an_event(), &mut buf).unwrap();
        let mut small = [0u8; 512];
        assert_eq!(
            encode(&identity(), &an_event(), &mut small[..n - 1]),
            Err(EncodeError::BufferTooSmall)
        );
    }

    #[test]
    fn every_smaller_buffer_refuses_rather_than_emitting_something_parseable() {
        // Not one boundary — every one below the required size. A cut that happens to
        // land after a closing brace is the case that would slip through.
        let mut probe = [0u8; 512];
        let needed = encode(&identity(), &an_event(), &mut probe).unwrap();
        for size in 0..needed {
            let mut buf = [0u8; 512];
            assert_eq!(
                encode(&identity(), &an_event(), &mut buf[..size]),
                Err(EncodeError::BufferTooSmall),
                "a {size}-byte buffer must refuse"
            );
        }
    }

    #[test]
    fn a_field_that_would_need_escaping_is_refused_not_mangled() {
        let mut buf = [0u8; 512];
        for bad in [
            "ser\"ial",
            "back\\slash",
            "new\nline",
            "nul\0byte",
            "caf\u{e9}",
        ] {
            let mut id = identity();
            id.case_serial = bad;
            assert_eq!(
                encode(&id, &an_event(), &mut buf),
                Err(EncodeError::UnencodableField("caseSerial")),
                "must refuse {bad:?}"
            );
        }
    }

    #[test]
    fn an_unknown_heavy_event_still_encodes() {
        // The silent dock is the case most likely to be reported, and it must not be
        // the case that fails to serialise.
        let mut unit = DockUnit::new();
        let e = unit.evaluate(&SensorFrame::silent());
        let mut buf = [0u8; 512];
        let n = encode(&identity(), &e, &mut buf).expect("silence must be reportable");
        let s = core::str::from_utf8(&buf[..n]).unwrap();
        assert!(s.contains("\"tamperState\":\"unknown\""), "{s}");
    }
}
