import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface ToastNotificationProps {
  title?: string;
  message?: string;
  variant?: ToastVariant;
  cardColor?: string;
  textColor?: string;
  mutedColor?: string;
  speed?: number;
}

const VARIANT_COLORS: Record<ToastVariant, string> = {
  success: '#22c55e',
  error: '#ef4444',
  info: '#0ea5e9',
  warning: '#f59e0b',
};

function VariantIcon({variant, color}: {variant: ToastVariant; color: string}) {
  const p = {width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
  if (variant === 'success') return <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M8 12.5l2.8 2.8L16 9.8" /></svg>;
  if (variant === 'error') return <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>;
  if (variant === 'warning') return <svg {...p}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18v.01" /></svg>;
  return <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v.01M12 12v5" /></svg>;
}

export function ToastNotification({
  title = 'Deployment successful',
  message = 'Your changes are live',
  variant = 'success',
  cardColor = 'rgba(28, 28, 32, 0.95)',
  textColor = '#ffffff',
  mutedColor = 'rgba(255,255,255,0.6)',
  speed = 1,
}: ToastNotificationProps) {
  const frame = useCurrentFrame() * speed;
  const {fps, durationInFrames} = useVideoConfig();

  const enterFrames = 15;
  const exitFrames = 15;
  const exitStart = Math.max(enterFrames, durationInFrames - exitFrames);

  const enterProgress = spring({frame, fps, config: {damping: 14, stiffness: 140, mass: 0.7}, durationInFrames: enterFrames});
  const enterTranslate = interpolate(enterProgress, [0, 1], [40, 0]);
  const enterOpacity = interpolate(enterProgress, [0, 1], [0, 1], {extrapolateRight: 'clamp'});

  const exitTranslate = interpolate(frame, [exitStart, exitStart + exitFrames], [0, 40], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const exitOpacity = interpolate(frame, [exitStart, exitStart + exitFrames], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  const accent = VARIANT_COLORS[variant];

  return (
    <div style={{
      transform: `translateY(${enterTranslate + exitTranslate}px)`,
      opacity: Math.min(enterOpacity, exitOpacity),
      display: 'flex',
      alignItems: 'flex-start',
      gap: 14,
      padding: '16px 20px',
      minWidth: 320,
      maxWidth: 420,
      background: cardColor,
      borderRadius: 14,
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
      border: '1px solid rgba(255,255,255,0.08)',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 999, background: `${accent}1f`, flexShrink: 0}}>
        <VariantIcon variant={variant} color={accent} />
      </div>
      <div style={{display: 'flex', flexDirection: 'column', gap: 2}}>
        <span style={{fontSize: 16, fontWeight: 600, color: textColor, letterSpacing: '-0.01em'}}>{title}</span>
        <span style={{fontSize: 14, color: mutedColor, lineHeight: 1.4}}>{message}</span>
      </div>
    </div>
  );
}
