import { useCallback, useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';

interface PhotoProps {
  src: string;
  srcSet: string;
  sizes: string;
  width: number;
  height: number;
}

const FRAMES = 121;

function PhotoMove({ photo, compact, onReady }: {
  photo: PhotoProps;
  compact: boolean;
  onReady: () => void;
}) {
  const frame = useCurrentFrame();
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // The server-rendered image may have loaded before React attached onLoad.
    if (image.current?.complete && image.current.naturalWidth > 0) onReady();
  }, [onReady]);
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <img
        ref={image} src={photo.src} srcSet={photo.srcSet} sizes={photo.sizes}
        width={photo.width} height={photo.height} alt="" onLoad={onReady}
        draggable={false}
        style={{
          width: '100%', height: '100%', display: 'block',
          // Anchor towards the playing surface: the hands leave the frame first.
          transformOrigin: '50% 35%',
          scale: interpolate(frame, [0, 100, FRAMES - 1], [1, compact ? 1.10 : 1.22, compact ? 1.10 : 1.22], {
            easing: Easing.inOut(Easing.quad), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
          }),
        }}
      />
    </AbsoluteFill>
  );
}

export default function ScrollPhotoPlayer(photo: PhotoProps) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerRef>(null);
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [compact, setCompact] = useState(true);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const track = host.current?.closest<HTMLElement>('[data-photo-track]');
    const stage = track?.querySelector<HTMLElement>('[data-photo-stage]');
    if (!track || !stage) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const small = matchMedia('(max-width: 767px), (max-height: 699px)');
    let raf = 0;
    let previousFrame = -1;
    const update = () => {
      raf = 0;
      if (motion.matches) return;
      const runway = track.offsetHeight - stage.offsetHeight;
      const top = parseFloat(getComputedStyle(stage).top) || 0;
      const progress = runway > 0 ? (top - track.getBoundingClientRect().top) / runway : 0;
      const frame = Math.round(Math.min(1, Math.max(0, progress)) * (FRAMES - 1));
      if (frame !== previousFrame && player.current) {
        player.current.seekTo(frame);
        previousFrame = frame;
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    const preferences = () => {
      setEnabled(!motion.matches);
      setCompact(small.matches);
      previousFrame = -1;
      schedule();
    };
    preferences();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    motion.addEventListener('change', preferences);
    small.addEventListener('change', preferences);
    const observer = new ResizeObserver(schedule);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      motion.removeEventListener('change', preferences);
      small.removeEventListener('change', preferences);
    };
  }, []);

  return (
    <div ref={host} style={{ opacity: ready && enabled ? 1 : 0 }} data-photo-player>
      <Player
        ref={player} component={PhotoMove}
        inputProps={{ photo, compact, onReady }}
        durationInFrames={FRAMES} fps={30}
        compositionWidth={photo.width} compositionHeight={photo.height}
        style={{ width: '100%' }} controls={false} autoPlay={false}
        clickToPlay={false} doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false} showVolumeControls={false}
        numberOfSharedAudioTags={0}
        errorFallback={() => null}
      />
    </div>
  );
}
