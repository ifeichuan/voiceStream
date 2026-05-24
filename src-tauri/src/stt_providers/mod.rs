pub mod assemblyai;
pub mod deepgram;
pub mod gladia;
pub mod local_zipformer;
pub mod openai;
pub mod soniox;

use crate::stt::{current_transcript_for_hud, SttTranscriptEvent};
use crate::native_hud;
use tauri::{AppHandle, Emitter};

/// Shared helper: emit transcript event and update HUD from shared TRANSCRIPT_STATE.
pub(crate) fn emit_transcript(
    app: &AppHandle,
    text: &str,
    is_final: bool,
) {
    let (finalized, partial) = current_transcript_for_hud();
    native_hud::update_transcript(app, &finalized, &partial);
    let _ = app.emit(
        "stt-transcript",
        SttTranscriptEvent {
            text: text.to_string(),
            is_final,
        },
    );
}

/// Shared helper: emit STT status event.
pub(crate) fn emit_status(app: &AppHandle, provider: &str, status: &str) {
    let _ = app.emit(
        "stt-status",
        crate::stt::SttStatusEvent {
            provider: provider.to_string(),
            status: status.to_string(),
        },
    );
}
