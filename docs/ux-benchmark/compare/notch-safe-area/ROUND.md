# Notch safe area — 2026-09-08

reference : Apple NSScreen.safeAreaInsets (https://developer.apple.com/documentation/appkit/nsscreen/safeareainsets, 2026-09-08), physical screen obstruction must not cover interactive content; retain Astra's attached Dock surface.
hypothesis: Extend only the background into the camera band and place the existing content below the OS-provided top inset, preserving all content dimensions.
measured  : Built-in Retina Display 1728×1117pt; safeAreaInsets.top=32pt; auxiliary top areas x=0…771 and x=956…1728; idle content token 220×44pt. User reports text hidden by the physical camera notch.
candidates: A=current top-aligned content (0pt inset); B=move the entire Dock down by safeAreaInsets.top; C=background stays at screen top, content inset by safeAreaInsets.top (user approved C).
gate      : First verify top attachment, unchanged content size, camera clearance, zero-inset screens and screen changes; capture geometry and representative states; inspect golden differences; run verify-all before commit. Release remains NO-GO until all independent release gates pass.

## Measured result

- Swift tests: 43 passed, including camera-band clearance and a no-notch screen at a negative desktop origin.
- Signed bundle: build, strict signature verification and launch passed. Final executable SHA-256: `f0457cb938b7d4da9ba79235d9a744b4a2678c47dcd296ccb0ad36f859c330b7`.
- `dock8`: 19 states passed. All 18 attached Dock states gained exactly 32pt in height, retained the same width and top=0. Workspace remains 1080×680pt.
- `pixel-comparison.json`: aligning by 32pt leaves zero content changes above 16/255 in all 18 Dock states. Only the original top hairline and corner boxes are excluded, since that outer edge now belongs to the added band. Workspace dynamic pixels differ by 0.0708%.
- Light and dark `shots`: 16 surfaces each passed. Historical RC comparison has 8/10 exact surfaces in each mode after alignment; the idle hint differs because this process cannot register the shortcut (「クリック」 vs shortcut badges), and the meeting canvas has dynamic pixel differences. Neither historical RC baseline is overwritten.
- AX geometry: SKIP (`AX not trusted`). Window-server bounds are saved separately beside the Dock images; the `contentLayout` entry is the declared layout, not AX measurement.
- Screen-parameter changes clear the cached screen and recompute the inset. Actual external-monitor switching is not measured on this single-display setup.
- Motion gate: PASS, five transitions retained the window identity, top/center within 2pt, zero missing frames.
- Full `verify-all.sh`: FAIL. Actual dictation insertion still fails (`inserted=false`). The guide gate initially used a stale debug executable and rejected the new window height; after the debug rebuild, its targeted rerun with the already validated current light captures passed. Its intentional fault-injection selfcheck also passed. Confirmation, recording crash recovery, three journeys, and 43 Swift tests passed. Gateway-dependent checks skipped while the gateway was unavailable.
- No commit or release approval: AX measurement, dictation, live release prerequisites and distribution signing remain unresolved.

## AX許可後の再検証（上記は許可前の履歴）

- AstraのAX・マイク・画面収録が許可済み。実入力を含む5秒録音E2EはofflineでPASS。
- 新しい環境別golden `environments/macos-26.6.2-2x-safe-top-32` はlight/dark各10面。承認済みノッチ対応のDock3面だけを更新、他7面は元RCの画像を保持。元の環境別基準も保持。
- 32ptを揃えた本文画素比較はidle差0、listening差35px（0.11283%）、preparing差14px（0.04513%）。従来の上端枠線と上角だけ比較対象外。目視でも本文の配置を確認。既存の画像許容差0.5%は変更しない。
- AX geometryを6状態で採取し、別実行で2pt以内の一致を確認。本文/ボタンの上端はidle44.5pt、listening/agent48pt、meeting/notes52ptで、32ptのカメラ帯にかからない。占有ゲート7状態PASS。
- 密度はキャプチャに記録した実際のsafe-area分を除いた本文領域で測定。PNG寸法と記録の不一致はFAIL。窓全体の占有検査はsafe-areaも含めたまま。承認済みgoldenからDock3面専用密度基準を採取（83.8/92.6/94.3%）。idle旧基準80.9%、元RC画像の実測82.0%に対し、新画像は上枠線がカメラ帯へ移ったため本文の地の割合が83.8%となる。本文の画素増減を隠す変更ではなく、境界が変わる承認済み構造変更として記録する。通常画面/他の面の基準と1.5ポイントの許容差は保持。
- Developer ID証明書は作成済み。配布署名はcodesignの待機で中断し（キーチェーン許可の要否は本人へ確認依頼中）、未完成appを`dist/Astra-unfinished-signing-20260908.app`へ退避。公証資格情報は未登録。Developer IDによる完成配布物はまだない。

追加検証: dock8/light+dark各19状態PASS、実マイク/画面収録/単発とstreaming音声認識PASS。axtreeの旧名称参照とdockanimのsafe-areaなし到達判定を修正し、それぞれ実AX検出とアニメーション検証PASS。後続のsession/acceptance/sessionsyncもPASS。一括verify-allの最終再実行は未完了のため、commit条件成立とは扱わない。
