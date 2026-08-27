/**
 * マイクのアイコン。Deepgram の AgentMicrophoneButton が使う lucide の path をそのまま。
 * 絵文字（🎙）は OS ごとに姿が変わり、状態で色を変えられないので使わない。
 */
import type { ReactElement } from 'react';

export function MicIcon({
  muted = false,
  size = 18,
}: {
  muted?: boolean;
  size?: number;
}): ReactElement {
  return (
    <svg
      className="astra-mic-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {muted ? (
        <>
          <path d="M2 2l20 20" />
          <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
          <path d="M5 10v2a7 7 0 0 0 12 5" />
          <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
          <path d="M12 19v3" />
        </>
      ) : (
        <>
          <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <path d="M12 19v3" />
        </>
      )}
    </svg>
  );
}
