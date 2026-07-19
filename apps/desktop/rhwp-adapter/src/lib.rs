//! Stable HOP-facing boundary around the upstream `rhwp` crate.
//!
//! Keep direct `rhwp` imports and feature forwarding in this crate. Product crates
//! depend on this adapter so an upstream package/module move has one repair point.

#[cfg(feature = "native-skia")]
pub use rhwp::document_core::queries::rendering::PngExportOptions;
pub use rhwp::parser::extract_thumbnail_only;
pub use rhwp::DocumentCore;
