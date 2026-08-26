/**
 * 端末でできること。正本 §25、UI/UX §22。
 *
 * **できないことを、黙って落とさない。**
 * 会議を始めてから「相手の声が入っていなかった」と気付くのが、いちばん悪い。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { capabilities as bridge, type DeviceCapability } from '../host/tauri.js';
import './settings.css';

/** 能力の呼び名。内部の識別子をそのまま出さない。 */
const LABEL: Readonly<Record<string, string>> = {
  'audio.microphone': 'マイク',
  'audio.system': 'システム音声',
  'stt.local': '手元の文字起こし',
  'stt.local.japanese': '日本語モデル',
};

/** 理由と、次にすること。§21「影響と次の選択肢を書く」。 */
const REASON: Readonly<Record<string, string>> = {
  no_input_device: 'マイクが見つかりません。接続を確認してください。',
  microphone_permission_denied: 'マイクの使用を許可してください。',
  not_implemented: 'まだ対応していません。会議では自分の声だけが記録されます。',
  library_not_installed: '文字起こしの部品が入っていません。',
  library_not_loadable: '文字起こしの部品を読み込めません。入れ直してください。',
  library_version_mismatch: '文字起こしの部品の版が合いません。',
  model_not_installed: '日本語モデルが入っていません。',
  model_corrupt: '日本語モデルが壊れています。入れ直してください。',
};

export function DeviceCapabilities(): ReactElement {
  const [report, setReport] = useState<readonly DeviceCapability[] | null>(null);

  const load = useCallback(() => {
    void bridge.report().then((next) => setReport(next));
  }, []);

  useEffect(load, [load]);

  if (report === null) {
    // まだ分からないことを「使えない」と書かない
    return <p className="astra-empty">この環境では端末の状態を確認できません。</p>;
  }

  return (
    <section className="astra-capabilities" aria-label="この端末でできること">
      <ul>
        {report.map((capability) => (
          <li
            key={capability.capability}
            className="astra-capability"
            data-available={capability.available}
          >
            <span className="astra-capability__name">
              {LABEL[capability.capability] ?? capability.capability}
            </span>
            {/* §19: 状態を色だけで表さない */}
            <span className="astra-capability__state">
              {capability.available ? '使えます' : '使えません'}
            </span>
            {capability.available ? (
              capability.implementation && (
                <span className="astra-capability__detail">{capability.implementation}</span>
              )
            ) : (
              <span className="astra-capability__reason">
                {REASON[capability.reason ?? ''] ?? capability.reason ?? '理由が分かりません'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
