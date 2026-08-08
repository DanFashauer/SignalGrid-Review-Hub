//! SmartDock firmware core — the dock's judgement, with no operating system under it.
//!
//! `#![no_std]` is not decoration. This crate builds for `thumbv7em-none-eabihf`, a
//! Cortex-M4F with no allocator, and CI compiles it for that target on every change.
//! "It compiles" from an x86 host proves almost nothing about a firmware; compiling for
//! the actual instruction set, with no `std` to fall back on, proves it could be flashed.
//!
//! WHAT THIS DOES NOT CLAIM. No hardware has run this. There is no driver layer, no
//! bootloader, no secure element, no attestation of the firmware image itself, and no
//! transport. `SensorFrame` is where a driver layer would hand readings in; everything
//! from that point is here and tested. Anything about behaviour on a real dock remains
//! unproven until a real dock runs it — see `docs/SIGNALGRID_SMARTDOCK.md`.
//!
//! `std` returns only under `cfg(test)`, so the test harness can run on the host while
//! the shipped build stays bare-metal.

#![cfg_attr(not(test), no_std)]

pub mod custody;
pub mod state;
pub mod wire;

pub use custody::{CustodyEvent, DockUnit, Reading, SensorFrame};
pub use state::{
    BadgeBindingState, BatteryHealthState, ChargeState, CustodyState, DockState, TamperState,
};
pub use wire::{encode, DockIdentity, EncodeError};

/// The largest record this firmware can produce, with room for provisioning strings.
/// A dock sizes its transmit buffer from this rather than guessing — and if it guesses
/// too small, `encode` refuses instead of truncating.
pub const MAX_RECORD_BYTES: usize = 512;
