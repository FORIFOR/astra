/**
 * 初期セットアップ。正本 §3。
 *
 * 守るのは 3 つ:
 *   - **画面に説明を並べない**（Step 1 は 1 文だけ）
 *   - **一度に全 permission を要求しない**（Step 5）
 *   - **動画ではなく 1 回の成功体験で終える**（Step 7）
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AstraClient } from '@astra/api-client';
import {
  INTEREST_AREAS,
  INTEREST_LABELS,
  PERMISSION_LABEL,
  PERMISSION_PURPOSE,
  isOsPermission,
  type InputPreference,
  type InterestArea,
  type OnboardingStep,
  type PackRecommendation,
} from '@astra/contracts';
import { ShortcutSettings } from '../settings/ShortcutSettings.js';
import './onboarding.css';

const PREFERENCES: { id: InputPreference; label: string }[] = [
  { id: 'voice', label: '音声中心' },
  { id: 'text', label: 'テキスト中心' },
  { id: 'both', label: '両方' },
];

export function Onboarding({
  client,
  onDone,
}: {
  client: AstraClient | null;
  onDone(): void;
}): ReactElement {
  const [step, setStep] = useState<OnboardingStep>('promise');
  const [preference, setPreference] = useState<InputPreference | null>(null);
  const [interests, setInterests] = useState<readonly InterestArea[]>([]);
  const [recommendations, setRecommendations] = useState<readonly PackRecommendation[]>([]);
  const [permissions, setPermissions] = useState<readonly string[]>([]);
  const [granted, setGranted] = useState<ReadonlySet<string>>(new Set());
  const [firstTaskId, setFirstTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!client) return;
      try {
        await client.updateOnboarding(patch);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [client],
  );

  useEffect(() => {
    if (step !== 'packs' || !client) return;
    void client
      .onboardingRecommendations(interests)
      .then((result) => {
        setRecommendations(result.items);
        setPermissions(result.permissions);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [step, client, interests]);

  const toggleInterest = (area: InterestArea): void =>
    setInterests((current) =>
      current.includes(area) ? current.filter((a) => a !== area) : [...current, area],
    );

  const installAll = async (): Promise<void> => {
    if (!client) return;
    setBusy(true);
    try {
      for (const pack of recommendations) {
        // 権限は見せた上で、そのまま渡す。**勝手に増やさない。**
        await client.installPlugin(pack.plugin_id as never, {
          version: '0.1.0',
          granted_scopes: pack.permissions as never,
        });
      }
      await save({ installed_plugins: recommendations.map((r) => r.plugin_id) });
      setStep('permissions');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** §3 Step 7。**動画ではなく、実際に 1 つ終わらせる。** */
  const runFirstTask = async (): Promise<void> => {
    if (!client) return;
    setBusy(true);
    try {
      const task = await client.createTask({
        kind: 'echo',
        input: { message: 'はじめまして' },
      });
      setFirstTaskId(task.id);
      await save({ first_task_id: task.id, step: 'done' });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const title = useMemo(() => TITLES[step], [step]);

  return (
    <main className="astra-onboarding" aria-label="初期セットアップ">
      {error ? <p role="alert">{error}</p> : null}

      {step === 'promise' && (
        <section aria-labelledby="astra-onboarding-promise">
          {/* §3 Step 1: 説明を並べず 1 文 */}
          <h1 id="astra-onboarding-promise" className="astra-onboarding__promise">
            話すか、打つだけ。調べる・作る・動かすまでやります。
          </h1>
          <button
            className="astra-onboarding__primary"
            type="button"
            onClick={() => setStep('input_preference')}
          >
            始める
          </button>
        </section>
      )}

      {step === 'input_preference' && (
        <section aria-label={title}>
          <h2>{title}</h2>
          <div className="astra-onboarding__choices">
            {PREFERENCES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={preference === option.id}
                onClick={() => {
                  setPreference(option.id);
                  void save({ input_preference: option.id, step: 'interests' });
                  setStep('interests');
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* 選んでも機能は変わらない。そう書いておく。 */}
          <p className="astra-onboarding__note">あとから変えられます。機能は変わりません。</p>
        </section>
      )}

      {step === 'interests' && (
        <section aria-label={title}>
          <h2>{title}</h2>
          <div className="astra-onboarding__choices">
            {INTEREST_AREAS.map((area) => (
              <button
                key={area}
                type="button"
                aria-pressed={interests.includes(area)}
                onClick={() => toggleInterest(area)}
              >
                {INTEREST_LABELS[area]}
              </button>
            ))}
          </div>
          <button
            className="astra-onboarding__primary"
            type="button"
            disabled={interests.length === 0}
            onClick={() => {
              void save({ interests: [...interests], step: 'packs' });
              setStep('packs');
            }}
          >
            次へ
          </button>
        </section>
      )}

      {step === 'packs' && (
        <section aria-label={title}>
          <h2>{title}</h2>
          {recommendations.length === 0 ? (
            <p>いま薦められるものはありません。</p>
          ) : (
            <ul className="astra-onboarding__packs">
              {recommendations.map((pack) => (
                <li key={pack.plugin_id}>
                  <span className="astra-onboarding__pack-name">{pack.name}</span>
                  {/* なぜ薦めているかを必ず出す */}
                  <span className="astra-onboarding__pack-why">{pack.because}</span>
                  {/* 入れる前に権限を見せる */}
                  <span className="astra-onboarding__pack-perms">
                    {pack.permissions.length === 0
                      ? '追加の許可は要りません'
                      : pack.permissions.join(' / ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            className="astra-onboarding__primary"
            type="button"
            disabled={busy}
            onClick={() => void installAll()}
          >
            まとめて追加
          </button>
          <button
            className="astra-onboarding__secondary"
            type="button"
            onClick={() => setStep('permissions')}
          >
            あとで
          </button>
        </section>
      )}

      {step === 'permissions' && (
        <section aria-label={title}>
          <h2>{title}</h2>
          {permissions.length === 0 ? (
            <p>いま必要な許可はありません。</p>
          ) : (
            <ul className="astra-onboarding__permissions">
              {permissions.map((permission) => (
                <li key={permission}>
                  <label>
                    <input
                      type="checkbox"
                      checked={granted.has(permission)}
                      onChange={() =>
                        setGranted((current) => {
                          const next = new Set(current);
                          if (next.has(permission)) next.delete(permission);
                          else next.add(permission);
                          return next;
                        })
                      }
                    />
                    {isOsPermission(permission) ? PERMISSION_LABEL[permission] : permission}
                  </label>
                  {/* 求める直前に、何のために要るかを言う。文言は正本と同じもの。 */}
                  <span className="astra-onboarding__why">
                    {isOsPermission(permission) ? PERMISSION_PURPOSE[permission] : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="astra-onboarding__note">
            いま許さなくても構いません。必要になったときに改めて聞きます。
          </p>
          <button
            className="astra-onboarding__primary"
            type="button"
            onClick={() => {
              void save({ granted_permissions: [...granted], step: 'shortcut' });
              setStep('shortcut');
            }}
          >
            次へ
          </button>
        </section>
      )}

      {step === 'shortcut' && (
        <section aria-label={title}>
          <h2>{title}</h2>
          {/*
           * 打鍵を文面に書かない。**実際に登録できたものを出す。**
           * ここに固定の綴りを書くと、OS / IME に取られていたときに
           * 「押しても出ない鍵」を教えることになる（§20）。
           */}
          <ShortcutSettings />
          <p className="astra-onboarding__note">押すと入力、長押しで話しかけられます。</p>
          <button
            className="astra-onboarding__primary"
            type="button"
            onClick={() => {
              void save({ step: 'first_task' });
              setStep('first_task');
            }}
          >
            次へ
          </button>
        </section>
      )}

      {step === 'first_task' && (
        <section aria-label={title}>
          {/* §3 Step 7: チュートリアル動画より、1 回の成功体験 */}
          <h2>今、面倒なことを1つ頼んでください。</h2>
          <button
            className="astra-onboarding__primary"
            type="button"
            disabled={busy}
            onClick={() => void runFirstTask()}
          >
            試してみる
          </button>
        </section>
      )}

      {step === 'done' && (
        <section aria-label="完了">
          <h2>準備ができました。</h2>
          {firstTaskId ? <p className="astra-onboarding__note">最初の仕事が動きました。</p> : null}
        </section>
      )}
    </main>
  );
}

const TITLES: Record<OnboardingStep, string> = {
  promise: '',
  input_preference: 'どちらが多いですか',
  interests: '何を任せたいですか',
  packs: '追加するもの',
  permissions: '必要な許可',
  shortcut: '呼び出し方',
  first_task: '最初の一つ',
  done: '完了',
};
