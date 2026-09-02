# PUBLIC_COMPETITIVE_DESIGN_GATE — 公式ソースの種

**本文だけで優劣を言わない。** 画像を撮って初めて設計を比べられる。
本文から分かるのは「何ができると謳っているか」までで、
「それが画面でどう見えるか」は分からない。

## VoiceOS

```yaml
- id: voiceos-home
  url: https://www.voiceos.com/
  kind: official homepage
  capture: [hero / notch-style UI, "New Message" action card,
            "Point anywhere on your screen", voice-to-action]
  compare_axes: [state_legibility, screen_context, action_visibility, density]

- id: voiceos-changelog-0-1-25
  url: https://www.voiceos.com/changelog
  kind: official changelog
  capture: [notch 内の逐次応答, inline preview, first-run flow, build logs]
  compare_axes: [first_run, response_visibility, control_visibility, recovery]

- id: voiceos-jarvis
  url: https://www.voiceos.com/blog/jarvis-control-your-computer-with-your-voice
  kind: official blog
  capture: [always-available top-of-screen assistant]
  compare_axes: [ambient_presence, one_surface_positioning]
```

## SuperIntern

```yaml
- id: superintern-home
  url: https://super-intern.com/en
  kind: official homepage
  capture: [AI Canvas written during the call, Weekly Sync (PM view), Works Everywhere]
  compare_axes: [live_notes_hierarchy, meeting_density, clarity]

- id: superintern-translation
  url: https://super-intern.com/en/translation
  kind: official product page
  capture: [real-time transcription + translation, no-bot 比較, stealth mode]
  compare_axes: [caption_layout, privacy_ui, unobtrusiveness]

- id: superintern-changelog
  url: https://super-intern.com/en/changelog
  kind: official changelog
  capture: [desktop sign-in, manual re-upload, session continuity]
  compare_axes: [recovery_ux, first_run_auth, settings_complexity]

- id: superintern-otter-alternative
  url: https://super-intern.com/en/blog/otter-alternative
  kind: official blog
  capture: [AI Canvas Live Summary, AI Canvas, Live Translation]
  compare_axes: [canvas_readability, structure, translation_layout]

- id: superintern-minutes-2026
  url: https://super-intern.com/en/blog/2026-meeting-minutes-app-selection
  kind: official blog
  capture: [SuperIntern AI Canvas]
  compare_axes: [artifact_quality, note_structure, action_item_readability]

- id: superintern-v0-10
  url: https://super-intern.com/en/blog/v0-10update
  kind: official blog
  capture: [Speaker Diarization Demo]
  compare_axes: [transcript_attribution, speaker_labeling_clarity]

- id: superintern-v0-11
  url: https://super-intern.com/en/blog/v0-11update
  kind: official blog
  capture: [Real-Time Summary Streaming, Find in Transcript, Follow-up Email]
  compare_axes: [post_meeting_flow, summary_visibility, transcript_navigation]
```

## 比べるときの規則

1. **本文だけで優劣を言わない。**
   例: SuperIntern の本文に「項目ごとの出所」が書かれていない
   → **未記載であって、未実装ではない。**
2. **公開素材から操作の速さを推測しない。**
   絵から見られるのは 階層 / 密度 / 造形 / 読み取りやすさ / 操作の見えかた。
   完遂率・焦点を奪うか・初回成功率は別枠（実機が要る）。
3. **ブランド名を伏せる。** A / B / C として順序を入れ替え、10 回。
