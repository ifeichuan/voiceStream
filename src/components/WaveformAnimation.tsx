import "./WaveformAnimation.css";

type WaveformSize = "compact" | "normal" | "large";

interface WaveformAnimationProps {
  size?: WaveformSize;
  bars?: number;
  color?: string;
  className?: string;
}

const sizeConfig: Record<WaveformSize, { height: string; barWidth: string; gap: string }> = {
  compact: { height: "32px", barWidth: "2.5px", gap: "2.5px" },
  normal: { height: "52px", barWidth: "4px", gap: "5px" },
  large: { height: "72px", barWidth: "5px", gap: "6px" },
};

export function WaveformAnimation({
  size = "normal",
  bars = 9,
  color,
  className,
}: WaveformAnimationProps) {
  const config = sizeConfig[size];

  return (
    <div
      className={`waveform-animation waveform-animation--${size}${className ? ` ${className}` : ""}`}
      style={{
        height: config.height,
        gap: config.gap,
        ...(color ? { "--waveform-color": color } as React.CSSProperties : {}),
      }}
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          style={{ width: config.barWidth }}
        />
      ))}
    </div>
  );
}
