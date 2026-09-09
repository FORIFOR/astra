# 状態説明とHomeからのメモ操作（2026-09-09）

reference : Astra DS-06（docs/DESIGN_SYSTEM.md §8）— 状態・操作結果・復旧の意味を面間で一致させる。2026-09-09確認。
hypothesis: 文字起こし不可は空欄側にも同じ理由を表示し、編集確定は確認へ戻ると明示する。Homeから明示的に開いたメモにはキー操作先を渡す。
measured  : 前回公証版9画面の独立レビューで、不可状態と「まだ発話がありません」が併存。編集中にも「外部に出る」。FKA実機で開始・停止は到達、Homeのメモ操作後もHomeが操作先。寸法・色・段の変更は0。
candidates: A=現状 / B=既存段内の状態文・編集説明を置換しHomeの明示操作時だけ既存Dockをkeyにする / C=説明段や別ウインドウを追加（採用しない）。
gate      : 状態別の実画面・既存確認のキャンセル/実行検証・Homeメモのkey window検証→geometry/occupation→light/dark画像と独立評価。自動表示では焦点を移さない。

結果（2026-09-09）: light/dark 各2面を `docs/golden-screenshots/release-state-recovery` に保存。geometry の6状態を記録・再照合、occupation を通過。home-meeting-focus は Notes/Ask の既存Dockへのキー移動、自動更新時のHome維持、共有中の非表示を通過。独立画像評価（gpt-6-astra / gpt-5.6-sol / gpt-5.6-terra）は両面とも3/3 KEEP。画像評価は実操作の証拠には用いない。配布版全体検証は dist/release-validation/state-recovery に別途記録する。
