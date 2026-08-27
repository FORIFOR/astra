/** 設定 → 声。音を手元の外へ出すかどうかは、話している最中ではなく、ここで決める。 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  onCloudCorrectionChange,
  readCloudCorrection,
  writeCloudCorrection,
} from '../voice/cloudCorrection.js';

export function VoiceSettings(): ReactElement {
  const [allowed, setAllowed] = useState(readCloudCorrection);
  useEffect(() => onCloudCorrectionChange(setAllowed), []);
  return (
    <section className="astra-voice-settings" aria-label="声">
      <h3 className="astra-menu__title">声</h3>
      <label className="astra-voice-settings__row">
        <input
          type="checkbox"
          checked={allowed}
          onChange={(event) => {
            setAllowed(event.target.checked);
            writeCloudCorrection(event.target.checked);
          }}
        />
        <span>
          Google で発話を高精度に確定する
          <span className="astra-voice-settings__hint">
            オンにすると、聞き取った音声を Google に送って文字を確定します。オフなら音はこの Mac
            の外へ出ません。
          </span>
        </span>
      </label>
    </section>
  );
}
