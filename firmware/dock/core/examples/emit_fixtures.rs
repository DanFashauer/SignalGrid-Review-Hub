//! Emit one encoded custody record per line, for the contract gate to check.
//!
//! This runs THE ACTUAL FIRMWARE — the same `DockUnit::evaluate` and `wire::encode` that
//! a dock would run — rather than restating what it is expected to produce. That is the
//! point: `scripts/check-dock-firmware-contract.mjs` then compares this output against
//! the vocabularies it derives from `lib/signalgrid-core/src/types.ts`, so a firmware
//! that starts emitting "OK" instead of "none" fails a build rather than a deployment.
//!
//! An example rather than a test because it has output worth capturing, and because
//! examples may use `std` while the library itself stays `no_std`.
//!
//!   cargo run --example emit_fixtures

use signalgrid_dock_firmware::{
    encode, BadgeBindingState, BatteryHealthState, DockIdentity, DockUnit, Reading, SensorFrame,
    MAX_RECORD_BYTES,
};

fn identity(observed_at: &'static str) -> DockIdentity<'static> {
    DockIdentity {
        device_ref: "dev_fixture_0001",
        hardware_vendor: "fixture-vendor",
        hardware_model: "smartdock-ref",
        case_serial: "CS-FIXTURE-01",
        dock_id: "dock_fixture_a",
        bay_id: "bay_01",
        observed_at,
        source_reference: "firmware/dock/core@fixture",
    }
}

fn nominal() -> SensorFrame {
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

fn main() {
    // Each entry is a scenario, and between them they must exercise more than one value
    // of every vocabulary — otherwise the gate would pass a firmware that answers
    // "unknown" to everything. The gate asserts that spread rather than trusting it.
    let mut emitted = 0usize;

    let mut emit = |label: &str, unit: &mut DockUnit, frame: &SensorFrame| {
        let event = unit.evaluate(frame);
        let mut buf = [0u8; MAX_RECORD_BYTES];
        match encode(&identity("2026-08-08T15:00:00Z"), &event, &mut buf) {
            Ok(n) => {
                println!("{}", core::str::from_utf8(&buf[..n]).unwrap());
                emitted += 1;
            }
            Err(e) => {
                // Loudly, and with a non-zero exit: a fixture emitter that silently
                // skips the case it could not encode is how a gate ends up checking
                // fewer records than it thinks.
                eprintln!("FAILED to encode scenario {label}: {e:?}");
                std::process::exit(1);
            }
        }
    };

    // 1. Nominal: docked, charging, intact, checked in.
    emit("nominal", &mut DockUnit::new(), &nominal());

    // 2. Silence: nothing answered. Every field must be `unknown`.
    emit("silent", &mut DockUnit::new(), &SensorFrame::silent());

    // 3. Checked out: bay empty, checkout registered.
    let mut f = nominal();
    f.bay_occupied = Reading::Value(false);
    f.checkout_registered = Reading::Value(true);
    f.badge = Reading::Value(BadgeBindingState::Present);
    emit("checked_out", &mut DockUnit::new(), &f);

    // 4. Walked off: bay empty, nobody signed it out.
    let mut f = nominal();
    f.bay_occupied = Reading::Value(false);
    f.checkout_registered = Reading::Value(false);
    emit("unsigned_departure", &mut DockUnit::new(), &f);

    // 5. Tamper, then the case closed again — the latch must hold across both.
    let mut latched = DockUnit::new();
    let mut f = nominal();
    f.enclosure_intact = Reading::Value(false);
    f.badge = Reading::Value(BadgeBindingState::Forced);
    emit("tamper_open", &mut latched, &f);
    f.enclosure_intact = Reading::Value(true);
    emit("tamper_reclosed", &mut latched, &f);

    // 6. A broken enclosure switch, with no prior breach.
    let mut f = nominal();
    f.enclosure_intact = Reading::Faulted;
    emit("tamper_sensor_dead", &mut DockUnit::new(), &f);

    // 7. Offline: no uplink this cycle.
    let mut f = nominal();
    f.uplink_ok = Reading::Value(false);
    emit("offline", &mut DockUnit::new(), &f);

    // 8. Maintenance.
    let mut f = nominal();
    f.maintenance_flagged = Reading::Value(true);
    emit("maintenance", &mut DockUnit::new(), &f);

    // 9. Faulted bay sensor.
    let mut f = nominal();
    f.bay_occupied = Reading::Faulted;
    emit("bay_sensor_faulted", &mut DockUnit::new(), &f);

    // 10-13. The charge ladder, plus no battery at all.
    for (percent, badge) in [
        (5u8, BadgeBindingState::Absent),
        (20, BadgeBindingState::Removed),
        (99, BadgeBindingState::Present),
    ] {
        let mut f = nominal();
        f.charging = Reading::Value(false);
        f.charge_percent = Reading::Value(Some(percent));
        f.badge = Reading::Value(badge);
        f.battery_health = Reading::Value(BatteryHealthState::Degraded);
        emit("charge_ladder", &mut DockUnit::new(), &f);
    }
    let mut f = nominal();
    f.charge_percent = Reading::Value(None);
    f.battery_health = Reading::Value(BatteryHealthState::Failing);
    emit("no_battery", &mut DockUnit::new(), &f);

    eprintln!("emitted {emitted} record(s)");
}
