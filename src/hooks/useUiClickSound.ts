import { useEffect } from "react";
import { tiks } from "@rexa-developer/tiks";

const CLICKABLE_SELECTOR = [
  "button",
  "a[href]",
  "[role='button']",
  "input[type='checkbox']",
  "input[type='radio']",
  "select",
].join(",");

const IGNORED_SELECTOR = [
  "input:not([type='checkbox']):not([type='radio'])",
  "textarea",
  "[contenteditable='true']",
  "[data-ui-sound='off']",
  ".xterm",
].join(",");

function shouldPlayClickSound(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest(IGNORED_SELECTOR)) return false;

  const clickable = target.closest<HTMLElement>(CLICKABLE_SELECTOR);
  if (!clickable) return false;
  if (clickable.closest("[data-ui-sound='off']")) return false;

  const disabled = clickable.matches(":disabled,[aria-disabled='true']");
  return !disabled;
}

export function useUiClickSound() {
  useEffect(() => {
    tiks.init({ theme: "soft", volume: 0.18, respectReducedMotion: true });

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (!shouldPlayClickSound(event.target)) return;
      tiks.click();
    };

    document.addEventListener("pointerup", handlePointerUp, { capture: true });
    return () => document.removeEventListener("pointerup", handlePointerUp, { capture: true });
  }, []);
}
