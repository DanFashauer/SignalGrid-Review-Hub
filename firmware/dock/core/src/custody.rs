//! Sensor readings in, a custody event out.
//!
//! This is the whole of the dock's judgement, and it is small on purpose. Everything a
//! SmartDock does that could mislead the fabric happens here:
//!
//!   · reporting a value for a sensor that did not answer
//!   · letting a tamper clear itself
//!   · inferring custody from the absence of evidence
//!
//! Each has a rule below and a test that fails if the rule is removed.

use crate::state::{
    BadgeBindingState, BatteryHealthState, ChargeState, CustodyState, DockState, TamperState,
};

/// What one sensor said this cycle.
///
/// THREE STATES, NOT TWO. `NotReported` and `Faulted` are both "no value", but they are
/// different facts: a sensor that is simply absent from this build is not the same as
/// one that answered with garbage or timed out. Collapsing them into `Option::None`
/// would throw away the only information an operator could act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reading<T> {
    Value(T),
    /// No such sensor on this dock revision, or not polled this cycle.
    NotReported,
    /// The sensor was polled and failed: timeout, checksum error, out-of-range.
    Faulted,
}

impl<T: Copy> Reading<T> {
    pub fn value(self) -> Option<T> {
        match self {
            Reading::Value(v) => Some(v),
            _ => None,
        }
    }

    pub fn is_faulted(self) -> bool {
        matches!(self, Reading::Faulted)
    }
}

/// What the hardware measured this cycle. Every field is a `Reading`, because on real
/// hardware every one of them can be missing, and a struct that cannot express that
/// forces the caller to invent a value.
#[derive(Debug, Clone, Copy)]
pub struct SensorFrame {
    /// Bay occupancy — a physical switch or hall sensor.
    pub bay_occupied: Reading<bool>,
    /// The charge controller's view. `None` inside `Value` means "no battery seen".
    pub charge_percent: Reading<Option<u8>>,
    pub charging: Reading<bool>,
    /// Battery health, if the dock can read it at all. Most cannot.
    pub battery_health: Reading<BatteryHealthState>,
    /// Enclosure switch: true means the case is closed and intact.
    pub enclosure_intact: Reading<bool>,
    /// The reader case's badge state, relayed through the dock.
    pub badge: Reading<BadgeBindingState>,
    /// Has a worker checked this device out through the host app?
    pub checkout_registered: Reading<bool>,
    /// Is the bay flagged for maintenance by the operator?
    pub maintenance_flagged: Reading<bool>,
    /// Has the dock been able to reach the control plane this cycle?
    pub uplink_ok: Reading<bool>,
}

impl SensorFrame {
    /// A frame in which nothing answered. The honest starting point for a dock that has
    /// just powered on and polled nothing yet — and the shape every field defaults to,
    /// so a partially-filled frame reports unknown rather than zero.
    pub const fn silent() -> Self {
        SensorFrame {
            bay_occupied: Reading::NotReported,
            charge_percent: Reading::NotReported,
            charging: Reading::NotReported,
            battery_health: Reading::NotReported,
            enclosure_intact: Reading::NotReported,
            badge: Reading::NotReported,
            checkout_registered: Reading::NotReported,
            maintenance_flagged: Reading::NotReported,
            uplink_ok: Reading::NotReported,
        }
    }
}

/// The event a dock reports. Field-for-field the shape `DockCustodyRecord` expects in
/// `lib/signalgrid-core/src/dock.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CustodyEvent {
    pub dock_state: DockState,
    pub charge_state: ChargeState,
    pub battery_health: BatteryHealthState,
    pub tamper_state: TamperState,
    pub custody_state: CustodyState,
    pub badge_binding: BadgeBindingState,
}

/// Thresholds, named rather than inline so a reviewer can see the whole policy at once.
pub const CHARGE_CRITICAL_PERCENT: u8 = 10;
pub const CHARGE_LOW_PERCENT: u8 = 25;
pub const CHARGE_FULL_PERCENT: u8 = 98;

/// The dock's persistent state across cycles.
///
/// Exists for ONE reason: the tamper latch. Everything else here is a pure function of
/// the current frame, and would be simpler stateless — but a tamper that evaluates
/// fresh each cycle un-trips itself the moment the switch stops answering, which turns
/// the most security-relevant signal the dock has into the least reliable one.
#[derive(Debug, Clone, Copy, Default)]
pub struct DockUnit {
    tamper_latched: bool,
}

impl DockUnit {
    pub const fn new() -> Self {
        DockUnit {
            tamper_latched: false,
        }
    }

    /// True once tamper has been confirmed and not yet acknowledged.
    pub fn tamper_latched(&self) -> bool {
        self.tamper_latched
    }

    /// Clear the latch. DELIBERATELY EXPLICIT: only an operator acknowledging the event
    /// clears it, never the passage of time and never a sensor that starts answering
    /// again. A latch that clears itself is not a latch.
    pub fn acknowledge_tamper(&mut self) {
        self.tamper_latched = false;
    }

    /// Evaluate one cycle.
    pub fn evaluate(&mut self, frame: &SensorFrame) -> CustodyEvent {
        let tamper_state = self.tamper(frame);
        let dock_state = dock_state(frame);
        let badge_binding = frame.badge.value().unwrap_or(BadgeBindingState::Unknown);

        CustodyEvent {
            dock_state,
            charge_state: charge_state(frame),
            // Never inferred. A dock that cannot read health says unknown, and the
            // fabric treats that as a reason to be more careful, not less.
            battery_health: frame
                .battery_health
                .value()
                .unwrap_or(BatteryHealthState::Unknown),
            tamper_state,
            custody_state: custody_state(frame, dock_state, tamper_state),
            badge_binding,
        }
    }

    fn tamper(&mut self, frame: &SensorFrame) -> TamperState {
        match frame.enclosure_intact {
            // Breach observed. Latch it: the next cycle must not report "none" simply
            // because the enclosure was closed again, or because the switch went quiet.
            Reading::Value(false) => {
                self.tamper_latched = true;
                TamperState::Confirmed
            }
            Reading::Value(true) => {
                if self.tamper_latched {
                    // The switch says intact, but a breach was seen and never
                    // acknowledged. Reporting "none" here would erase the event.
                    TamperState::Confirmed
                } else {
                    TamperState::None
                }
            }
            // The switch was polled and failed. That is a fact about the SENSOR, and
            // the vocabulary has a word for it — distinct from "no reading".
            Reading::Faulted => {
                if self.tamper_latched {
                    TamperState::Confirmed
                } else {
                    TamperState::SensorUnavailable
                }
            }
            Reading::NotReported => {
                if self.tamper_latched {
                    TamperState::Confirmed
                } else {
                    TamperState::Unknown
                }
            }
        }
    }
}

fn dock_state(frame: &SensorFrame) -> DockState {
    // An offline dock is reporting through a store-and-forward path, so it can still
    // describe itself — but "I cannot reach the control plane" outranks occupancy,
    // because a stale occupancy reading presented as current is the misleading one.
    if frame.uplink_ok == Reading::Value(false) {
        return DockState::Offline;
    }
    if frame.maintenance_flagged == Reading::Value(true) {
        return DockState::Reserved;
    }
    // A faulted occupancy sensor is a faulted BAY, not an empty one. "Empty" would
    // invite the fabric to conclude the device left with someone.
    if frame.bay_occupied.is_faulted() {
        return DockState::Faulted;
    }
    match frame.bay_occupied.value() {
        Some(true) => DockState::Occupied,
        Some(false) => DockState::Empty,
        None => DockState::Unknown,
    }
}

fn charge_state(frame: &SensorFrame) -> ChargeState {
    if frame.charge_percent.is_faulted() || frame.charging.is_faulted() {
        return ChargeState::Unknown;
    }
    match frame.charge_percent.value() {
        // The controller answered and saw no battery. That is a real observation.
        Some(None) => ChargeState::NotPresent,
        Some(Some(percent)) => {
            if frame.charging.value() == Some(true) && percent < CHARGE_FULL_PERCENT {
                ChargeState::Charging
            } else if percent >= CHARGE_FULL_PERCENT {
                ChargeState::Charged
            } else if percent <= CHARGE_CRITICAL_PERCENT {
                ChargeState::Critical
            } else if percent <= CHARGE_LOW_PERCENT {
                ChargeState::Low
            } else if frame.charging.value() == Some(true) {
                ChargeState::Charging
            } else {
                // Between low and full, not charging. There is no vocabulary word for
                // "fine and idle", and inventing one is not this firmware's job.
                ChargeState::Unknown
            }
        }
        None => ChargeState::Unknown,
    }
}

fn custody_state(frame: &SensorFrame, dock: DockState, tamper: TamperState) -> CustodyState {
    // A confirmed breach is an exception regardless of where the device is sitting.
    if tamper == TamperState::Confirmed {
        return CustodyState::Exception;
    }
    if frame.maintenance_flagged == Reading::Value(true) {
        return CustodyState::Maintenance;
    }
    match dock {
        // In the bay and accounted for.
        DockState::Occupied => match frame.checkout_registered.value() {
            // Physically docked but the host app still believes it is out with someone.
            // Neither fact is wrong; the pair is, and "exception" is what the fabric
            // has for a contradiction.
            Some(true) => CustodyState::Exception,
            Some(false) => CustodyState::CheckedIn,
            None => CustodyState::Unknown,
        },
        DockState::Empty => match frame.checkout_registered.value() {
            Some(true) => CustodyState::CheckedOut,
            // THE RULE THIS FUNCTION EXISTS FOR. An empty bay with no checkout record
            // is a device that left without being signed out. It is not `checked_out`
            // (nobody claimed it) and it is certainly not `checked_in`. Reporting
            // "unknown" here would also be wrong: the dock DID observe the bay empty
            // and DID observe no checkout, and those two together are an exception.
            Some(false) => CustodyState::Exception,
            None => CustodyState::Unknown,
        },
        // Faulted, offline, reserved, unknown: the dock cannot speak to custody.
        _ => CustodyState::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn healthy_docked() -> SensorFrame {
        SensorFrame {
            bay_occupied: Reading::Value(true),
            charge_percent: Reading::Value(Some(80)),
            charging: Reading::Value(true),
            battery_health: Reading::Value(BatteryHealthState::Healthy),
            enclosure_intact: Reading::Value(true),
            badge: Reading::Value(BadgeBindingState::Absent),
            checkout_registered: Reading::Value(false),
            maintenance_flagged: Reading::Value(false),
            uplink_ok: Reading::Value(true),
        }
    }

    // ── The happy path, so the rules below mean something ────────────────────

    #[test]
    fn a_docked_charging_device_reports_cleanly() {
        let mut unit = DockUnit::new();
        let e = unit.evaluate(&healthy_docked());
        assert_eq!(e.dock_state, DockState::Occupied);
        assert_eq!(e.charge_state, ChargeState::Charging);
        assert_eq!(e.tamper_state, TamperState::None);
        assert_eq!(e.custody_state, CustodyState::CheckedIn);
    }

    // ── Rule 1: a sensor that did not answer never produces a value ──────────

    #[test]
    fn a_silent_dock_reports_unknown_for_everything_it_cannot_see() {
        let mut unit = DockUnit::new();
        let e = unit.evaluate(&SensorFrame::silent());
        assert_eq!(e.dock_state, DockState::Unknown);
        assert_eq!(e.charge_state, ChargeState::Unknown);
        assert_eq!(e.battery_health, BatteryHealthState::Unknown);
        assert_eq!(e.tamper_state, TamperState::Unknown);
        assert_eq!(e.custody_state, CustodyState::Unknown);
        assert_eq!(e.badge_binding, BadgeBindingState::Unknown);
    }

    #[test]
    fn a_faulted_occupancy_sensor_is_a_faulted_bay_not_an_empty_one() {
        // "Empty" would invite the fabric to conclude the device left with someone.
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.bay_occupied = Reading::Faulted;
        assert_eq!(unit.evaluate(&f).dock_state, DockState::Faulted);
    }

    #[test]
    fn battery_health_is_never_inferred_from_charge() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.battery_health = Reading::NotReported;
        let e = unit.evaluate(&f);
        assert_eq!(e.charge_state, ChargeState::Charging);
        assert_eq!(
            e.battery_health,
            BatteryHealthState::Unknown,
            "a full battery says nothing about a healthy one"
        );
    }

    #[test]
    fn a_missing_badge_read_is_unknown_and_not_absent() {
        // "Nobody presented a badge" and "I cannot hear the reader" are different, and
        // only one of them is safe to act on.
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.badge = Reading::NotReported;
        assert_eq!(unit.evaluate(&f).badge_binding, BadgeBindingState::Unknown);
        f.badge = Reading::Faulted;
        assert_eq!(unit.evaluate(&f).badge_binding, BadgeBindingState::Unknown);
    }

    // ── Rule 2: tamper latches ───────────────────────────────────────────────

    #[test]
    fn a_breach_latches_and_does_not_clear_when_the_case_is_closed_again() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.enclosure_intact = Reading::Value(false);
        assert_eq!(unit.evaluate(&f).tamper_state, TamperState::Confirmed);

        // Closed again. A stateless evaluation would now say "none" and the breach
        // would never be seen by anyone.
        f.enclosure_intact = Reading::Value(true);
        assert_eq!(unit.evaluate(&f).tamper_state, TamperState::Confirmed);
        assert!(unit.tamper_latched());
    }

    #[test]
    fn a_breach_does_not_clear_when_the_sensor_goes_quiet() {
        // The attacker-shaped version: break the case, then break the switch.
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.enclosure_intact = Reading::Value(false);
        unit.evaluate(&f);
        for quiet in [Reading::NotReported, Reading::Faulted] {
            f.enclosure_intact = quiet;
            assert_eq!(unit.evaluate(&f).tamper_state, TamperState::Confirmed);
        }
    }

    #[test]
    fn only_an_acknowledgement_clears_the_latch() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.enclosure_intact = Reading::Value(false);
        unit.evaluate(&f);
        unit.acknowledge_tamper();
        f.enclosure_intact = Reading::Value(true);
        assert_eq!(unit.evaluate(&f).tamper_state, TamperState::None);
    }

    #[test]
    fn a_broken_switch_is_reported_as_broken_not_as_no_tamper() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.enclosure_intact = Reading::Faulted;
        assert_eq!(
            unit.evaluate(&f).tamper_state,
            TamperState::SensorUnavailable
        );
    }

    #[test]
    fn a_confirmed_tamper_makes_custody_an_exception_wherever_the_device_is() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.enclosure_intact = Reading::Value(false);
        assert_eq!(unit.evaluate(&f).custody_state, CustodyState::Exception);
    }

    // ── Rule 3: custody is never inferred from absence ───────────────────────

    #[test]
    fn an_empty_bay_with_no_checkout_is_an_exception_not_a_checkout() {
        // A device that left without being signed out. Nobody claimed it.
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.bay_occupied = Reading::Value(false);
        f.checkout_registered = Reading::Value(false);
        let e = unit.evaluate(&f);
        assert_eq!(e.dock_state, DockState::Empty);
        assert_eq!(e.custody_state, CustodyState::Exception);
    }

    #[test]
    fn an_empty_bay_with_a_checkout_is_a_normal_checkout() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.bay_occupied = Reading::Value(false);
        f.checkout_registered = Reading::Value(true);
        assert_eq!(unit.evaluate(&f).custody_state, CustodyState::CheckedOut);
    }

    #[test]
    fn a_docked_device_still_marked_checked_out_is_a_contradiction() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.checkout_registered = Reading::Value(true);
        assert_eq!(unit.evaluate(&f).custody_state, CustodyState::Exception);
    }

    #[test]
    fn custody_is_unknown_when_the_checkout_plane_did_not_answer() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.checkout_registered = Reading::NotReported;
        assert_eq!(unit.evaluate(&f).custody_state, CustodyState::Unknown);
    }

    // ── Uplink and maintenance ───────────────────────────────────────────────

    #[test]
    fn a_dock_that_cannot_reach_the_control_plane_says_so_first() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.uplink_ok = Reading::Value(false);
        let e = unit.evaluate(&f);
        assert_eq!(e.dock_state, DockState::Offline);
        assert_eq!(e.custody_state, CustodyState::Unknown);
    }

    #[test]
    fn a_maintenance_flagged_bay_reports_maintenance() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.maintenance_flagged = Reading::Value(true);
        let e = unit.evaluate(&f);
        assert_eq!(e.dock_state, DockState::Reserved);
        assert_eq!(e.custody_state, CustodyState::Maintenance);
    }

    // ── Charge thresholds ────────────────────────────────────────────────────

    #[test]
    fn charge_thresholds_are_ordered_and_exclusive() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.charging = Reading::Value(false);
        for (percent, expected) in [
            (0u8, ChargeState::Critical),
            (10, ChargeState::Critical),
            (11, ChargeState::Low),
            (25, ChargeState::Low),
            (26, ChargeState::Unknown), // no vocabulary word for "fine and idle"
            (98, ChargeState::Charged),
            (100, ChargeState::Charged),
        ] {
            f.charge_percent = Reading::Value(Some(percent));
            assert_eq!(unit.evaluate(&f).charge_state, expected, "at {percent}%");
        }
    }

    #[test]
    fn no_battery_seen_is_not_present_not_critical() {
        // "There is no battery" must not read as "the battery is nearly flat", which
        // would have the fabric chasing a charge problem that does not exist.
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.charge_percent = Reading::Value(None);
        assert_eq!(unit.evaluate(&f).charge_state, ChargeState::NotPresent);
    }

    #[test]
    fn a_faulted_charge_sensor_is_unknown_not_critical() {
        let mut unit = DockUnit::new();
        let mut f = healthy_docked();
        f.charge_percent = Reading::Faulted;
        assert_eq!(unit.evaluate(&f).charge_state, ChargeState::Unknown);
    }

    // ── The invariant, over the whole space rather than case by case ─────────

    #[test]
    fn no_sensor_frame_ever_produces_a_reassuring_answer_from_no_evidence() {
        // Brute-force every combination of "answered / did not answer / faulted" across
        // the frame, and assert that whenever a sensor gave nothing, the corresponding
        // field is never one of the reassuring values.
        // `Reading<T>` is generic, so "not reported or faulted" has to be built per
        // field rather than shared as one array.
        fn silent<T>(which: u8) -> Reading<T> {
            if which == 0 {
                Reading::NotReported
            } else {
                Reading::Faulted
            }
        }
        for enclosure in 0..2u8 {
            for occupancy in 0..2u8 {
                for charge in 0..2u8 {
                    for badge in 0..2u8 {
                        for checkout in 0..2u8 {
                            let mut unit = DockUnit::new();
                            let mut f = healthy_docked();
                            f.enclosure_intact = silent(enclosure);
                            f.bay_occupied = silent(occupancy);
                            f.charge_percent = silent(charge);
                            f.badge = silent(badge);
                            f.checkout_registered = silent(checkout);
                            let e = unit.evaluate(&f);

                            assert_ne!(
                                e.tamper_state,
                                TamperState::None,
                                "silent enclosure switch must not read as no-tamper"
                            );
                            assert_ne!(
                                e.dock_state,
                                DockState::Empty,
                                "silent occupancy must not read as empty"
                            );
                            assert_ne!(
                                e.dock_state,
                                DockState::Occupied,
                                "silent occupancy must not read as occupied"
                            );
                            assert_ne!(
                                e.badge_binding,
                                BadgeBindingState::Absent,
                                "silent reader must not read as absent"
                            );
                            assert_ne!(
                                e.custody_state,
                                CustodyState::CheckedIn,
                                "silence must not read as checked in"
                            );
                        }
                    }
                }
            }
        }
    }
}
