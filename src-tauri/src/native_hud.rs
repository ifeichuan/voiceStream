#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;

    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSBackingStoreType, NSColor, NSFont, NSGlassEffectView,
        NSGlassEffectViewStyle, NSLineBreakMode, NSPanel, NSScreen, NSStatusWindowLevel,
        NSTextAlignment, NSTextField, NSView, NSWindowCollectionBehavior, NSWindowStyleMask,
    };
    use objc2_foundation::{ns_string, NSPoint, NSRect, NSSize, NSString};
    use tauri::AppHandle;

    const PANEL_HEIGHT: f64 = 42.0;
    const PANEL_MIN_WIDTH: f64 = 148.0;
    const PANEL_MAX_WIDTH: f64 = 360.0;
    const PANEL_BOTTOM_MARGIN: f64 = 24.0;
    const PANEL_RADIUS: f64 = PANEL_HEIGHT / 2.0;
    const SHOW_SEED_SIZE: f64 = 34.0;
    const WIDTH_SHRINK_THRESHOLD: f64 = 18.0;

    const WAVE_X: f64 = 12.0;
    const WAVE_WIDTH: f64 = 28.0;
    const WAVE_HEIGHT: f64 = 32.0;
    const WAVE_BOTTOM: f64 = 5.0;
    const TEXT_X: f64 = 48.0;
    const TEXT_RIGHT_PADDING: f64 = 12.0;
    const TEXT_HEIGHT: f64 = 17.0;
    const UNDERLINE_HEIGHT: f64 = 1.5;
    const UNDERLINE_OFFSET: f64 = 1.0;
    const BAR_WIDTH: f64 = 2.6;
    const BAR_GAP: f64 = 1.3;
    const BAR_MIN_HEIGHT: f64 = 6.0;
    const BAR_WEIGHTS: [f32; 7] = [0.4, 0.58, 0.78, 1.0, 0.82, 0.62, 0.44];

    thread_local! {
        static HUD: RefCell<Option<NativeHud>> = const { RefCell::new(None) };
    }

    #[derive(Clone, Copy)]
    enum HudMode {
        Recording,
        Processing,
        Success,
        Error,
    }

    struct NativeHud {
        panel: Retained<NSPanel>,
        glass: Retained<NSGlassEffectView>,
        content: Retained<NSView>,
        finalized_label: Retained<NSTextField>,
        partial_label: Retained<NSTextField>,
        finalized_underline: Retained<NSView>,
        bars: Vec<Retained<NSView>>,
        level: f32,
        mode: HudMode,
        finalized_text: String,
        partial_text: String,
        visible: bool,
        displayed_width: f64,
        session_peak_width: f64,
    }

    impl NativeHud {
        fn new(mtm: MainThreadMarker) -> Self {
            let panel = NSPanel::initWithContentRect_styleMask_backing_defer(
                NSPanel::alloc(mtm),
                NSRect::new(
                    NSPoint::new(0.0, 0.0),
                    NSSize::new(PANEL_MIN_WIDTH, PANEL_HEIGHT),
                ),
                NSWindowStyleMask::NonactivatingPanel | NSWindowStyleMask::FullSizeContentView,
                NSBackingStoreType::Buffered,
                false,
            );

            unsafe { panel.setReleasedWhenClosed(false) };
            panel.setOpaque(false);
            panel.setBackgroundColor(Some(&NSColor::clearColor()));
            panel.setHasShadow(true);
            panel.setIgnoresMouseEvents(true);
            panel.setMovableByWindowBackground(false);
            panel.setFloatingPanel(true);
            panel.setBecomesKeyOnlyIfNeeded(true);
            panel.setHidesOnDeactivate(false);
            panel.setLevel(NSStatusWindowLevel);
            panel.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::Transient
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );

            let window_content = panel.contentView().expect("panel content view missing");

            let glass = NSGlassEffectView::initWithFrame(
                NSGlassEffectView::alloc(mtm),
                NSRect::new(
                    NSPoint::new(0.0, 0.0),
                    NSSize::new(PANEL_MIN_WIDTH, PANEL_HEIGHT),
                ),
            );
            glass.setStyle(NSGlassEffectViewStyle::Regular);
            glass.setCornerRadius(PANEL_RADIUS);
            glass.setTintColor(Some(&glass_tint()));
            glass.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );

            let content = NSView::initWithFrame(
                NSView::alloc(mtm),
                NSRect::new(
                    NSPoint::new(0.0, 0.0),
                    NSSize::new(PANEL_MIN_WIDTH, PANEL_HEIGHT),
                ),
            );
            content.setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
            glass.setContentView(Some(&content));
            window_content.addSubview(&glass);

            let finalized_label = NSTextField::labelWithString(ns_string!(""), mtm);
            finalized_label.setTextColor(Some(&text_color()));
            finalized_label.setFont(Some(&NSFont::boldSystemFontOfSize(13.5)));
            finalized_label.setAlignment(NSTextAlignment::Left);
            finalized_label.setUsesSingleLineMode(true);
            finalized_label.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
            finalized_label.setAllowsDefaultTighteningForTruncation(true);
            finalized_label.setMaximumNumberOfLines(1);
            finalized_label.setAlphaValue(0.98);
            content.addSubview(&finalized_label);

            let finalized_underline = NSView::initWithFrame(
                NSView::alloc(mtm),
                NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, UNDERLINE_HEIGHT)),
            );
            finalized_underline.setWantsLayer(true);
            if let Some(layer) = finalized_underline.layer() {
                let cg = underline_color().CGColor();
                layer.setBackgroundColor(Some(&cg));
                layer.setCornerRadius(UNDERLINE_HEIGHT / 2.0);
                layer.setMasksToBounds(true);
            }
            content.addSubview(&finalized_underline);

            let partial_label = NSTextField::labelWithString(ns_string!("Listening..."), mtm);
            partial_label.setTextColor(Some(&text_color()));
            partial_label.setFont(Some(&NSFont::boldSystemFontOfSize(13.5)));
            partial_label.setAlignment(NSTextAlignment::Left);
            partial_label.setUsesSingleLineMode(true);
            partial_label.setLineBreakMode(NSLineBreakMode::ByTruncatingTail);
            partial_label.setAllowsDefaultTighteningForTruncation(true);
            partial_label.setMaximumNumberOfLines(1);
            partial_label.setAlphaValue(0.92);
            content.addSubview(&partial_label);

            let mut bars = Vec::with_capacity(BAR_WEIGHTS.len());
            for _ in 0..BAR_WEIGHTS.len() {
                let bar = NSView::initWithFrame(
                    NSView::alloc(mtm),
                    NSRect::new(
                        NSPoint::new(0.0, 0.0),
                        NSSize::new(BAR_WIDTH, BAR_MIN_HEIGHT),
                    ),
                );
                bar.setWantsLayer(true);
                if let Some(layer) = bar.layer() {
                    let color = bar_color(HudMode::Recording);
                    let cg = color.CGColor();
                    layer.setBackgroundColor(Some(&cg));
                    layer.setCornerRadius(BAR_WIDTH / 2.0);
                    layer.setMasksToBounds(true);
                }
                content.addSubview(&bar);
                bars.push(bar);
            }

            panel.orderOut(None);

            let mut hud = Self {
                panel,
                glass,
                content,
                finalized_label,
                partial_label,
                finalized_underline,
                bars,
                level: 0.0,
                mode: HudMode::Recording,
                finalized_text: String::new(),
                partial_text: "Listening...".to_string(),
                visible: false,
                displayed_width: PANEL_MIN_WIDTH,
                session_peak_width: PANEL_MIN_WIDTH,
            };
            hud.apply_layout(false);
            hud
        }

        fn reset_recording_session(&mut self) {
            self.level = 0.0;
            self.displayed_width = PANEL_MIN_WIDTH;
            self.session_peak_width = PANEL_MIN_WIDTH;
        }

        fn set_text(&mut self, text: &str, mode: HudMode) {
            match mode {
                HudMode::Success => self.set_transcript_parts(text, "", mode),
                HudMode::Recording | HudMode::Processing | HudMode::Error => {
                    self.set_transcript_parts("", text, mode)
                }
            }
        }

        fn set_transcript_parts(&mut self, finalized: &str, partial: &str, mode: HudMode) {
            self.finalized_text.clear();
            self.finalized_text.push_str(finalized);
            self.partial_text.clear();
            self.partial_text.push_str(partial);
            self.mode = mode;
            self.finalized_label
                .setStringValue(&NSString::from_str(finalized));
            self.partial_label
                .setStringValue(&NSString::from_str(partial));
            self.update_text_styles();
            self.update_bar_colors();
            self.update_width_state();
            self.apply_layout(self.visible);
        }

        fn set_level(&mut self, next_level: f32) {
            let clamped = next_level.clamp(0.0, 1.0);
            let delta = clamped - self.level;
            let smoothing = if delta >= 0.0 { 0.5 } else { 0.18 };
            self.level = (self.level + delta * smoothing).clamp(0.0, 1.0);
            self.layout_bars();
        }

        fn show(&mut self) {
            let target = self.target_frame();

            if self.visible {
                self.apply_layout(true);
                return;
            }

            let seed = anchored_frame(SHOW_SEED_SIZE, SHOW_SEED_SIZE);

            self.visible = true;
            self.panel.setAlphaValue(0.98);
            self.panel.setFrame_display_animate(seed, false, false);
            self.glass.setFrame(NSRect::new(
                NSPoint::new(0.0, 0.0),
                NSSize::new(SHOW_SEED_SIZE, SHOW_SEED_SIZE),
            ));
            self.content.setFrame(self.glass.frame());
            self.layout_bars();
            self.panel.orderFrontRegardless();
            self.panel.setFrame_display_animate(target, false, true);
            self.apply_layout(true);
        }

        fn hide(&mut self) {
            self.visible = false;
            self.panel.orderOut(None);
        }

        fn apply_layout(&mut self, animate: bool) {
            let target = self.target_frame();
            if self.visible {
                self.panel.setFrame_display_animate(target, false, animate);
            } else {
                self.panel.setFrame_display_animate(target, false, false);
            }

            let width = target.size.width;
            self.glass.setFrame(NSRect::new(
                NSPoint::new(0.0, 0.0),
                NSSize::new(width, PANEL_HEIGHT),
            ));
            self.content.setFrame(NSRect::new(
                NSPoint::new(0.0, 0.0),
                NSSize::new(width, PANEL_HEIGHT),
            ));

            let label_width = (width - TEXT_X - TEXT_RIGHT_PADDING).max(72.0);
            let has_finalized_text = !self.finalized_text.trim().is_empty();
            let finalized_width = if has_finalized_text {
                self.measured_text_width(&self.finalized_label)
            } else {
                0.0
            };
            let finalized_frame_width = finalized_width.min(label_width);
            let partial_frame_width = (label_width - finalized_frame_width).max(0.0);
            let label_y = (PANEL_HEIGHT - TEXT_HEIGHT) / 2.0 - 1.0;
            self.finalized_label.setFrame(NSRect::new(
                NSPoint::new(TEXT_X, label_y),
                NSSize::new(finalized_frame_width, TEXT_HEIGHT),
            ));
            self.partial_label.setFrame(NSRect::new(
                NSPoint::new(TEXT_X + finalized_frame_width, label_y),
                NSSize::new(partial_frame_width, TEXT_HEIGHT),
            ));
            let underline_width = if has_finalized_text {
                finalized_frame_width.max(0.0)
            } else {
                0.0
            };
            self.finalized_underline
                .setHidden(!has_finalized_text || underline_width <= 0.0);
            self.finalized_underline.setFrame(NSRect::new(
                NSPoint::new(TEXT_X, label_y - UNDERLINE_OFFSET),
                NSSize::new(underline_width, UNDERLINE_HEIGHT),
            ));
            self.layout_bars();
        }

        fn measured_panel_width(&self) -> f64 {
            let measured = (self.measured_text_width(&self.finalized_label)
                + self.measured_text_width(&self.partial_label))
            .max(72.0);
            (measured + TEXT_X + TEXT_RIGHT_PADDING).clamp(PANEL_MIN_WIDTH, PANEL_MAX_WIDTH)
        }

        fn measured_text_width(&self, label: &Retained<NSTextField>) -> f64 {
            label.sizeToFit();
            label.frame().size.width
        }

        fn update_width_state(&mut self) {
            let measured = self.measured_panel_width();

            match self.mode {
                HudMode::Recording | HudMode::Processing => {
                    self.session_peak_width = self.session_peak_width.max(measured);
                    self.displayed_width = self.session_peak_width;
                }
                HudMode::Success | HudMode::Error => {
                    self.session_peak_width = self.session_peak_width.max(measured);
                    let shrinking_by = self.displayed_width - measured;
                    if measured > self.displayed_width || shrinking_by > WIDTH_SHRINK_THRESHOLD {
                        self.displayed_width = measured;
                    }
                }
            }
        }

        fn target_frame(&self) -> NSRect {
            anchored_frame(self.displayed_width, PANEL_HEIGHT)
        }

        fn update_bar_colors(&self) {
            for bar in &self.bars {
                if let Some(layer) = bar.layer() {
                    let color = bar_color(self.mode);
                    let cg = color.CGColor();
                    layer.setBackgroundColor(Some(&cg));
                }
            }
        }

        fn update_text_styles(&self) {
            self.finalized_label.setTextColor(Some(&text_color()));
            self.partial_label
                .setTextColor(Some(&partial_text_color(self.mode)));
            self.partial_label.setAlphaValue(match self.mode {
                HudMode::Recording => 0.9,
                HudMode::Processing => 0.94,
                HudMode::Success => 0.0,
                HudMode::Error => 0.96,
            });

            if let Some(layer) = self.finalized_underline.layer() {
                let cg = underline_color().CGColor();
                layer.setBackgroundColor(Some(&cg));
            }
        }

        fn layout_bars(&self) {
            let total_bar_width = BAR_WIDTH * BAR_WEIGHTS.len() as f64
                + BAR_GAP * (BAR_WEIGHTS.len().saturating_sub(1) as f64);
            let start_x = WAVE_X + ((WAVE_WIDTH - total_bar_width) / 2.0);
            let floor = match self.mode {
                HudMode::Recording => 0.14,
                HudMode::Processing => 0.16,
                HudMode::Success => 0.08,
                HudMode::Error => 0.04,
            };
            let visible_level = self.level.max(floor).powf(0.68);

            for (index, bar) in self.bars.iter().enumerate() {
                let jitter = match index {
                    0 => 0.97,
                    1 => 1.03,
                    2 => 0.99,
                    3 => 1.0,
                    4 => 1.02,
                    5 => 0.98,
                    _ => 1.04,
                };
                let weight = BAR_WEIGHTS[index] * jitter as f32;
                let shaped = (visible_level * weight).clamp(0.0, 1.0);
                let height = (BAR_MIN_HEIGHT + (WAVE_HEIGHT - BAR_MIN_HEIGHT) * shaped as f64)
                    .clamp(BAR_MIN_HEIGHT, WAVE_HEIGHT);
                let x = start_x + index as f64 * (BAR_WIDTH + BAR_GAP);
                let y = WAVE_BOTTOM + (WAVE_HEIGHT - height) / 2.0;
                bar.setFrame(NSRect::new(
                    NSPoint::new(x, y),
                    NSSize::new(BAR_WIDTH, height),
                ));
            }
        }
    }

    fn glass_tint() -> Retained<NSColor> {
        NSColor::colorWithSRGBRed_green_blue_alpha(0.16, 0.18, 0.24, 0.26)
    }

    fn text_color() -> Retained<NSColor> {
        NSColor::labelColor()
    }

    fn partial_text_color(mode: HudMode) -> Retained<NSColor> {
        match mode {
            HudMode::Recording => NSColor::secondaryLabelColor(),
            HudMode::Processing => NSColor::labelColor(),
            HudMode::Success => NSColor::labelColor(),
            HudMode::Error => NSColor::labelColor(),
        }
    }

    fn underline_color() -> Retained<NSColor> {
        NSColor::colorWithSRGBRed_green_blue_alpha(0.9, 0.96, 1.0, 0.72)
    }

    fn bar_color(mode: HudMode) -> Retained<NSColor> {
        match mode {
            HudMode::Recording => NSColor::colorWithSRGBRed_green_blue_alpha(0.68, 0.9, 1.0, 0.98),
            HudMode::Processing => {
                NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 0.83, 0.42, 0.98)
            }
            HudMode::Success => NSColor::colorWithSRGBRed_green_blue_alpha(0.66, 0.97, 0.76, 0.98),
            HudMode::Error => NSColor::colorWithSRGBRed_green_blue_alpha(1.0, 0.66, 0.66, 0.98),
        }
    }

    fn anchored_frame(width: f64, height: f64) -> NSRect {
        let mtm = MainThreadMarker::new().expect("native HUD must run on main thread");
        let visible = NSScreen::mainScreen(mtm)
            .map(|screen| screen.visibleFrame())
            .unwrap_or_else(|| NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(width, height)));
        let x = visible.origin.x + (visible.size.width - width) / 2.0;
        let y = visible.origin.y + PANEL_BOTTOM_MARGIN;
        NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
    }

    fn with_hud(app: &AppHandle, mut update: impl FnMut(&mut NativeHud) + Send + 'static) {
        let app = app.clone();
        let _ = app.run_on_main_thread(move || {
            HUD.with(|state| {
                let mtm = MainThreadMarker::new().expect("native HUD must run on main thread");
                let mut state = state.borrow_mut();
                let hud = state.get_or_insert_with(|| NativeHud::new(mtm));
                update(hud);
            });
        });
    }

    pub fn initialize(app: &AppHandle) {
        with_hud(app, |_| {});
    }

    pub fn show_recording(app: &AppHandle) {
        with_hud(app, |hud| {
            hud.reset_recording_session();
            hud.set_text("Listening...", HudMode::Recording);
            hud.show();
        });
    }

    pub fn show_processing(app: &AppHandle) {
        show_processing_text(app, "Transcribing...");
    }

    pub fn show_processing_text(app: &AppHandle, text: &str) {
        let text = text.to_string();
        with_hud(app, move |hud| {
            hud.set_level(0.14);
            hud.set_text(&text, HudMode::Processing);
            hud.show();
        });
    }

    pub fn show_success(app: &AppHandle, text: &str) {
        let text = text.to_string();
        with_hud(app, move |hud| {
            hud.set_level(0.18);
            hud.set_text(&text, HudMode::Success);
            hud.show();
        });
    }

    pub fn show_error(app: &AppHandle, text: &str) {
        let text = text.to_string();
        with_hud(app, move |hud| {
            hud.set_level(0.08);
            hud.set_text(&text, HudMode::Error);
            hud.show();
        });
    }

    pub fn update_transcript(app: &AppHandle, finalized: &str, partial: &str) {
        let finalized = finalized.to_string();
        let partial = partial.to_string();
        with_hud(app, move |hud| {
            if hud.visible && matches!(hud.mode, HudMode::Recording) {
                hud.set_transcript_parts(&finalized, &partial, HudMode::Recording);
            }
        });
    }

    pub fn update_level(app: &AppHandle, level: f32) {
        with_hud(app, move |hud| {
            if hud.visible {
                hud.set_level(level);
            }
        });
    }

    pub fn hide(app: &AppHandle) {
        with_hud(app, |hud| {
            hud.hide();
        });
    }
}

#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub fn initialize(_app: &tauri::AppHandle) {}
#[cfg(not(target_os = "macos"))]
pub fn show_recording(_app: &tauri::AppHandle) {}
#[cfg(not(target_os = "macos"))]
pub fn show_processing(_app: &tauri::AppHandle) {}
#[cfg(not(target_os = "macos"))]
pub fn show_processing_text(_app: &tauri::AppHandle, _text: &str) {}
#[cfg(not(target_os = "macos"))]
pub fn show_success(_app: &tauri::AppHandle, _text: &str) {}
#[cfg(not(target_os = "macos"))]
pub fn show_error(_app: &tauri::AppHandle, _text: &str) {}
#[cfg(not(target_os = "macos"))]
pub fn update_transcript(_app: &tauri::AppHandle, _finalized: &str, _partial: &str) {}
#[cfg(not(target_os = "macos"))]
pub fn update_level(_app: &tauri::AppHandle, _level: f32) {}
#[cfg(not(target_os = "macos"))]
pub fn hide(_app: &tauri::AppHandle) {}
