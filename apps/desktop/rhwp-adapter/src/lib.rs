//! Stable HOP-facing boundary around the upstream `rhwp` crate.
//!
//! Keep direct `rhwp` imports and feature forwarding in this crate. Product crates
//! depend on this adapter so an upstream package/module move has one repair point.

#[cfg(feature = "native-skia")]
pub use rhwp::document_core::queries::rendering::PngExportOptions;
pub use rhwp::parser::extract_thumbnail_only;
pub use rhwp::DocumentCore;

/// Split a paragraph for a normal HOP editing action.
///
/// Upstream also accepts paragraph metadata for merge-undo restoration. That
/// internal recovery protocol does not belong in the desktop command payload.
pub fn split_paragraph_for_editing(
    core: &mut DocumentCore,
    section_index: usize,
    paragraph_index: usize,
    char_offset: usize,
) -> Result<String, String> {
    core.split_paragraph_native(section_index, paragraph_index, char_offset, None)
        .map_err(|error| error.to_string())
}
