//! The Assist gate client for the SignalGrid desktop shell.
//!
//! WHY THERE IS A CORE CRATE AND NOT JUST AN APP. The decisions that matter here are
//! made before any window exists: what an unrecognised outcome means, whether a
//! non-JSON body is an allow, whether a plaintext URL may be used at all. Code that
//! lives in a window can only be checked by running the app; this can be checked by
//! `cargo test`, on Linux, in seconds, with no display server. That is the same split
//! `native/android/core` uses, for the same reason.
//!
//! WHAT IT DOES NOT DO. It does not perform I/O. There is no HTTP client here — the
//! shell owns the transport and hands the result in. That keeps every rule in this
//! crate testable without a network, and keeps the crate honest about what it knows:
//! it is given a status and a body, and it says what may be concluded from them.

pub mod assist;
pub mod endpoint;
pub mod wire;

pub use assist::{Assist, AssistDecision};
pub use endpoint::{validate as validate_endpoint, Endpoint};
pub use wire::parse as parse_assist_response;
