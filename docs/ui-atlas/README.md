# Astra UI Atlas — Visual Release Book (RC 349007f)

取扱説明書ではない。**全 UI を RC .app の実画像で 1 画面 1 ページに固定し、ページ単位で KEEP / FIX / NOT_ENOUGH_EVIDENCE を出す**ための資料。
画像は署名済み RC .app が `--selftest` で描いたものだけ。モック・Figma・別ビルドは入れない。

```
RC SHA            349007f
RC exe sha256     390b36331def91786ec9addfc842ad25a89b58f576a596914a020e00bdc37c87
RC built          2026-09-05T12:44:01+09:00   captured 2026-09-05T19:14:32+09:00
codesign          com.astra.desktop / 6RR7572ZLU
required screens  61   with RC image 48   NO_CAPTURE_PATH 13
strips            2 / 5
light == dark     13 面（voice.idle, voice.preparing, voice.listening, voice.thinking, voice.context, voice.context-expanded, dock.running, dock.context-detail, dock.confirmation, dock.result, meeting.controller, meeting.notes, meeting.captions）
```

| ファイル | 中身 |
|---|---|
| `Astra-UI-Atlas.pdf` | 1 画面 1 ページ。表紙に集計、末尾に strip と reality gate |
| `index.html` | PDF の元。ブラウザで開くと同じもの |
| `contact-sheet.png` | 全画面の一覧（light）。赤枠は撮る経路が無い画面 |
| `manifest.json` | 正本。説明は人が書き、image / sha256 / size / rc は build が埋める |
| `screens/<id>.<light,dark>.png` | 個別 PNG |
| `strips/<id>.png` | 60fps frame から T0 / +50 / +100 / +200 / final |

## 画面一覧

| id | title | status | light | dark |
|---|---|---|---|---|
| `voice.idle` | Voice HUD — Idle | CAPTURED | [png](screens/voice.idle.light.png) | [png](screens/voice.idle.dark.png) |
| `voice.preparing` | Voice HUD — Preparing | CAPTURED | [png](screens/voice.preparing.light.png) | [png](screens/voice.preparing.dark.png) |
| `voice.listening` | Voice HUD — Listening | CAPTURED | [png](screens/voice.listening.light.png) | [png](screens/voice.listening.dark.png) |
| `voice.thinking` | Voice HUD — Thinking | CAPTURED | [png](screens/voice.thinking.light.png) | [png](screens/voice.thinking.dark.png) |
| `voice.context` | Voice HUD — Context detected (compact) | CAPTURED | [png](screens/voice.context.light.png) | [png](screens/voice.context.dark.png) |
| `voice.context-expanded` | Voice HUD — Context expanded | CAPTURED | [png](screens/voice.context-expanded.light.png) | [png](screens/voice.context-expanded.dark.png) |
| `voice.quick-actions` | Voice HUD — Quick actions | NO_CAPTURE_PATH | — | — |
| `dock.running` | Task Dock — Running (agent steps) | CAPTURED | [png](screens/dock.running.light.png) | [png](screens/dock.running.dark.png) |
| `dock.context-detail` | Task Dock — Context detail | CAPTURED | [png](screens/dock.context-detail.light.png) | [png](screens/dock.context-detail.dark.png) |
| `dock.confirmation` | Task Dock — Confirmation (before side effect) | CAPTURED | [png](screens/dock.confirmation.light.png) | [png](screens/dock.confirmation.dark.png) |
| `dock.confirmation-edit` | Task Dock — Edit confirmation | NO_CAPTURE_PATH | — | — |
| `dock.result` | Task Dock — Done / Result | CAPTURED | [png](screens/dock.result.light.png) | [png](screens/dock.result.dark.png) |
| `dock.result-failed` | Task Dock — Error / Recovery | NO_CAPTURE_PATH | — | — |
| `dock.entering-recording` | Task Dock — Entering recording | NO_CAPTURE_PATH | — | — |
| `meeting.controller` | Meeting — Controller (recording active) | CAPTURED | [png](screens/meeting.controller.light.png) | [png](screens/meeting.controller.dark.png) |
| `meeting.preparing` | Meeting — Recording preparing | NO_CAPTURE_PATH | — | — |
| `meeting.paused` | Meeting — Paused | NO_CAPTURE_PATH | — | — |
| `meeting.notes` | Meeting — Live Notes | CAPTURED | [png](screens/meeting.notes.light.png) | [png](screens/meeting.notes.dark.png) |
| `meeting.captions` | Meeting — Captions | CAPTURED | [png](screens/meeting.captions.light.png) | [png](screens/meeting.captions.dark.png) |
| `meeting.ask` | Meeting — Ask Astra | NO_CAPTURE_PATH | — | — |
| `meeting.workspace` | Meeting — Expanded Workspace | CAPTURED | [png](screens/meeting.workspace.light.png) | [png](screens/meeting.workspace.dark.png) |
| `recording.workspace` | Recording Workspace — Overview | CAPTURED | [png](screens/recording.workspace.light.png) | [png](screens/recording.workspace.dark.png) |
| `recording.transcript` | Recording Workspace — Long transcript | CAPTURED | [png](screens/recording.transcript.light.png) | [png](screens/recording.transcript.dark.png) |
| `recording.rag` | Recording Workspace — RAG panel | CAPTURED | [png](screens/recording.rag.light.png) | [png](screens/recording.rag.dark.png) |
| `recording.agent-timeline` | Recording Workspace — Agent timeline | CAPTURED | [png](screens/recording.agent-timeline.light.png) | [png](screens/recording.agent-timeline.dark.png) |
| `recording.meeting-canvas` | Recording Workspace — Meeting canvas | CAPTURED | [png](screens/recording.meeting-canvas.light.png) | [png](screens/recording.meeting-canvas.dark.png) |
| `main.home` | Main — Home | CAPTURED | [png](screens/main.home.light.png) | [png](screens/main.home.dark.png) |
| `main.home-recording-now` | Main — Home (recording now) | CAPTURED | [png](screens/main.home-recording-now.light.png) | [png](screens/main.home-recording-now.dark.png) |
| `main.home-upcoming` | Main — Home (upcoming meeting) | CAPTURED | [png](screens/main.home-upcoming.light.png) | [png](screens/main.home-upcoming.dark.png) |
| `main.new-recording-sheet` | Main — New recording sheet | CAPTURED | [png](screens/main.new-recording-sheet.light.png) | [png](screens/main.new-recording-sheet.dark.png) |
| `main.work-tasks` | Main — Work / Tasks | CAPTURED | [png](screens/main.work-tasks.light.png) | [png](screens/main.work-tasks.dark.png) |
| `main.work-agents` | Main — Work / Agents | CAPTURED | [png](screens/main.work-agents.light.png) | [png](screens/main.work-agents.dark.png) |
| `main.library-meetings` | Main — Library / Meetings | CAPTURED | [png](screens/main.library-meetings.light.png) | [png](screens/main.library-meetings.dark.png) |
| `main.library-files` | Main — Library / Files | CAPTURED | [png](screens/main.library-files.light.png) | [png](screens/main.library-files.dark.png) |
| `main.apps-plugins` | Main — Apps / Plugins | CAPTURED | [png](screens/main.apps-plugins.light.png) | [png](screens/main.apps-plugins.dark.png) |
| `main.apps-connectors` | Main — Apps / Connectors | CAPTURED | [png](screens/main.apps-connectors.light.png) | [png](screens/main.apps-connectors.dark.png) |
| `main.scale-compact` | Main — UI scale: compact | CAPTURED | [png](screens/main.scale-compact.light.png) | [png](screens/main.scale-compact.dark.png) |
| `main.scale-comfortable` | Main — UI scale: comfortable (default) | CAPTURED | [png](screens/main.scale-comfortable.light.png) | [png](screens/main.scale-comfortable.dark.png) |
| `main.scale-large` | Main — UI scale: large | CAPTURED | [png](screens/main.scale-large.light.png) | [png](screens/main.scale-large.dark.png) |
| `session.recording` | Session — Recording (Home card) | CAPTURED | [png](screens/session.recording.light.png) | [png](screens/session.recording.dark.png) |
| `session.processing` | Session — Processing | CAPTURED | [png](screens/session.processing.light.png) | [png](screens/session.processing.dark.png) |
| `session.ready` | Session — Ready | CAPTURED | [png](screens/session.ready.light.png) | [png](screens/session.ready.dark.png) |
| `session.project` | Session — Filed to project | CAPTURED | [png](screens/session.project.light.png) | [png](screens/session.project.dark.png) |
| `session.detail` | Session — Detail (opened) | CAPTURED | [png](screens/session.detail.light.png) | [png](screens/session.detail.dark.png) |
| `provenance.meeting-detail` | Meeting detail — Summary / Decisions / Actions | CAPTURED | [png](screens/provenance.meeting-detail.light.png) | [png](screens/provenance.meeting-detail.dark.png) |
| `provenance.library-after-end` | Journey B — Library after ending | CAPTURED | [png](screens/provenance.library-after-end.light.png) | — |
| `provenance.source` | Journey B — Selected source | CAPTURED | [png](screens/provenance.source.light.png) | — |
| `provenance.reopened` | Journey B — Reopened later | CAPTURED | [png](screens/provenance.reopened.light.png) | — |
| `system.mic-denied` | System — Microphone denied | CAPTURED | [png](screens/system.mic-denied.light.png) | [png](screens/system.mic-denied.dark.png) |
| `system.mic-recovered` | Journey C — Recovered after permission | CAPTURED | [png](screens/system.mic-recovered.light.png) | — |
| `system.after-sharing` | Journey C — After sharing (secret mode) | CAPTURED | [png](screens/system.after-sharing.light.png) | — |
| `system.confirm-cancel` | Journey C — Confirmation, cancelled | CAPTURED | [png](screens/system.confirm-cancel.light.png) | — |
| `system.interrupted` | System — Interrupted recording (Home) | CAPTURED | [png](screens/system.interrupted.light.png) | [png](screens/system.interrupted.dark.png) |
| `system.interrupted-journey` | Journey C — Interrupted | CAPTURED | [png](screens/system.interrupted-journey.light.png) | — |
| `system.resumed` | Journey C — Resumed | CAPTURED | [png](screens/system.resumed.light.png) | — |
| `system.stt-unavailable` | System — On-device STT unavailable | NO_CAPTURE_PATH | — | — |
| `system.calendar-permission` | System — Calendar permission (purpose-first) | NO_CAPTURE_PATH | — | — |
| `system.accessibility-permission` | System — Accessibility / Input Monitoring | NO_CAPTURE_PATH | — | — |
| `system.update-available` | System — Update available | NO_CAPTURE_PATH | — | — |
| `system.update-unavailable` | System — Up to date / cannot check | NO_CAPTURE_PATH | — | — |
| `system.generic-failure` | System — Generic action failure | NO_CAPTURE_PATH | — | — |
| `settings.permissions` | Settings — 許可（OS）/ shortcuts | NO_CAPTURE_PATH | — | — |
| `components.neutral` | Control — neutral | CAPTURED | [png](screens/components.neutral.light.png) | [png](screens/components.neutral.dark.png) |
| `components.hover` | Control — hover | CAPTURED | [png](screens/components.hover.light.png) | [png](screens/components.hover.dark.png) |
| `components.focus` | Control — focus | CAPTURED | [png](screens/components.focus.light.png) | [png](screens/components.focus.dark.png) |
| `components.pressed` | Control — pressed | CAPTURED | [png](screens/components.pressed.light.png) | [png](screens/components.pressed.dark.png) |

## Strips

| id | title | status | top edge drift | center drift | window creation | focus theft |
|---|---|---|---|---|---|---|
| `strip.idle-preparing-listening` | Idle → Preparing → Listening | NO_CAPTURE_PATH | — | — | — | — |
| `strip.dock-running` | Dock → Running | NO_CAPTURE_PATH | — | — | — | — |
| `strip.running-confirmation` | Running → Confirmation | NO_CAPTURE_PATH | — | — | — | — |
| `strip.controller-notes` | Meeting Controller → Notes | CAPTURED | 0 | 0 | 0 | 0 |
| `strip.notes-workspace` | Notes → Workspace | CAPTURED | 0 | 0 | 0 | 0 |

## Reality gates

| gate | status | where |
|---|---|---|
| REAL_MEETING | NOT_MEASURED | `docs/ux-benchmark/RC-SESSION-RUNBOOK.md §3` |
| ACCESSIBILITY | NOT_MEASURED | `docs/ux-benchmark/RC-SESSION-RUNBOOK.md §4 / a11y/RUNBOOK.md` |
| LIVE_TCC | NOT_MEASURED | `docs/ux-benchmark/RC-SESSION-RUNBOOK.md §5` |
| WORLD_CLASS hands-on | NOT_COMPARABLE | `docs/ux-benchmark/RC-SESSION-RUNBOOK.md §6` |

## 作り直し方

```bash
bash scripts/ui-atlas/capture-rc.sh apps/astra-macos/.build/Astra.app /tmp/astra-atlas   # RC .app だけが描く
python3 scripts/ui-atlas/build.py /tmp/astra-atlas                                      # docs/ui-atlas/ を組む
bash scripts/verify-ui-atlas.sh                                                          # UI_ATLAS_GATE
```

`NO_CAPTURE_PATH` の画面は、その面を RC に描かせる selftest が無い。**製品コードではなく test code** を足して、次の RC で撮る。

## リリース経路での位置（2026-09-05、本人の指示）

```
1. RC から全 UI Atlas 生成  →  2. GitHub 公開  →  3. 全画像を目視評価  →  4. VISUAL_IDEAL_GATE
   FAIL → そこだけ修正 / PASS → 5. 新しい最終 RC を凍結
6. REAL_MEETING → 7. ACCESSIBILITY → 8. LIVE_TCC → 9. Reality 結果を Atlas へ追記 → 10. FINAL_IDEAL_RELEASE_GATE → GO
```

残りの実機 gate を旧 RC でやる無駄を防ぐため、Atlas を先に見る。UI FIX が 1 つでも出たら、新 RC で撮り直す。

## 採点の仕方

1 ページずつ、評価軸（Hierarchy / Density / Alignment / Typography / Contrast / State legibility / Primary-action clarity / Screen occupation / Surface continuity / Calmness / Consistency / Trust-provenance / Error recovery clarity / Competitive polish）で見て、
`KEEP` / `FIX` / `NOT_ENOUGH_EVIDENCE` を id ごとに書く。全部 `KEEP` で `VISUAL_IDEAL_GATE = PASS`。
「以前の測定で大丈夫だったから KEEP」はしない。最終 RC の実画像そのものを見る。
