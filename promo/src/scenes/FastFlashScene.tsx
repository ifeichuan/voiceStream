import {AbsoluteFill, useCurrentFrame, interpolate} from 'remotion';
import {ShimmerSweep} from '../components/remocn/ShimmerSweep';

interface Card {
  raw: string;
  clean: string;
}

const CARDS: Card[] = [
  {raw: '明天那个会我可能晚一点到 你先帮我跟他们说一下', clean: '明天的会我可能会晚一点到，你先帮我跟他们说一下。'},
  {raw: '这个 bug 先别关 我感觉还有一个边界情况没测', clean: '这个 bug 先别关，我感觉还有一个边界情况还没测。'},
  {raw: '帮我写个 commit message 就说修复 agent 快捷键和听写模式冲突', clean: 'fix: prevent agent shortcut from conflicting with dictation mode'},
  {raw: '把刚才那段会议记录提炼一下重点 三条以内', clean: '会议要点：\n1. 项目排期延后一周\n2. QA 资源不足需要补人\n3. 周三发布暂缓'},
  {raw: '给设计同学发个消息 就说 demo 已经合到 main 了', clean: '@设计 demo 已合并到 main 分支。'},
];

const CARD_DURATIONS = [70, 50, 45, 40, 35];
const CARD_STARTS = CARD_DURATIONS.reduce<number[]>((acc, _, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + CARD_DURATIONS[i - 1]);
  return acc;
}, []);
const CARDS_END = CARD_STARTS[CARDS.length - 1] + CARD_DURATIONS[CARDS.length - 1];

export const FastFlashScene: React.FC = () => {
  const frame = useCurrentFrame();

  const sectionFade = interpolate(frame, [0, 20], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const wrapOpacity = interpolate(frame, [CARDS_END, CARDS_END + 20], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 70%)',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div style={{position: 'absolute', top: 60, left: 0, right: 0, textAlign: 'center', opacity: sectionFade}}>
        <ShimmerSweep text="快闪 · 多轮整理" baseColor="#4dc9f6" shineColor="#ffffff" fontSize={16} fontWeight={500} letterSpacing={4} />
      </div>

      <div style={{width: 1300, opacity: wrapOpacity}}>
        {CARDS.map((card, i) => {
          const start = CARD_STARTS[i];
          const dur = CARD_DURATIONS[i];
          const end = start + dur;
          if (frame < start || frame >= end) return null;

          const local = frame - start;
          const cardOpacity = interpolate(local, [0, 5, dur - 6, dur], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
          const cardLift = interpolate(local, [0, 8], [10, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

          return (
            <div key={i} style={{opacity: cardOpacity, transform: `translateY(${cardLift}px)`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24}}>
              <div style={{background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '28px 32px', minHeight: 220}}>
                <div style={{fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, marginBottom: 14, fontFamily: 'SF Mono, monospace'}}>RAW</div>
                <p style={{margin: 0, fontSize: 22, color: 'rgba(255,255,255,0.8)', lineHeight: 1.6, fontFamily: '-apple-system, sans-serif', whiteSpace: 'pre-line'}}>{card.raw}</p>
              </div>
              <div style={{background: 'rgba(77, 201, 246, 0.05)', border: '1px solid rgba(77, 201, 246, 0.25)', borderRadius: 12, padding: '28px 32px', minHeight: 220}}>
                <div style={{fontSize: 11, color: '#4dc9f6', letterSpacing: 2, marginBottom: 14, fontFamily: 'SF Mono, monospace'}}>POLISHED</div>
                <p style={{margin: 0, fontSize: 22, color: '#ffffff', lineHeight: 1.6, fontWeight: 500, fontFamily: '-apple-system, sans-serif', whiteSpace: 'pre-line'}}>{card.clean}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{position: 'absolute', bottom: 50, left: 0, right: 0, textAlign: 'center', opacity: interpolate(frame, [40, 70], [0, 0.7], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}}>
        <span style={{fontSize: 14, color: 'rgba(255,255,255,0.45)', fontFamily: 'SF Mono, monospace', letterSpacing: 3}}>每段平均 1.2s · 越用越快</span>
      </div>
    </AbsoluteFill>
  );
};
