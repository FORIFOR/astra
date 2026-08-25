# docs

## 仕様書の階層

```text
new_ai_platform_design_spec_v0.1.md          正本（製品仕様）
  ├─ astra_ui_ux_detailed_spec_v0.1.docx     従属: UI/UX を実装可能な粒度へ
  └─ phase-0-implementation-spec.md          従属: Phase 0 を実装可能な粒度へ
```

| パス                                       | 役割                                                              | 状態                 |
| ------------------------------------------ | ----------------------------------------------------------------- | -------------------- |
| `spec/new_ai_platform_design_spec_v0.1.md` | **正本**。製品仕様 v0.1                                           | 凍結（読み取り専用） |
| `spec/astra_ui_ux_detailed_spec_v0.1.docx` | UI/UX 詳細仕様 v0.1。正本の §2・§4・§13・§23 等を UI 粒度へ具体化 | 凍結（読み取り専用） |
| `spec/astra_ui_ux_detailed_spec_v0.1.md`   | 上記 docx からの機械抽出（閲覧用）。**正本は .docx 側**           | 生成物               |
| `spec/astra_ui_ux_concept.png`             | UI/UX 仕様 図0-1 のコンセプト参照                                 | 参考図               |
| `spec/phase-0-implementation-spec.md`      | Phase 0 実装仕様                                                  | 更新される           |
| `adr/`                                     | 個別の設計判断                                                    | 更新される           |

## 優先順位

1. 製品仕様（正本）
2. UI/UX 詳細仕様 — UI の見た目・状態・操作については正本より詳しく、**UI に関してはこちらが優先**
3. Phase 0 実装仕様

矛盾が見つかった場合は、上位の文書を優先し、下位の文書側を修正する。
上位と異なる判断を採る場合は、Phase 0 実装仕様 §17 の逸脱表に登録してから実装する。

突合の結果は Phase 0 実装仕様 §20「UI/UX 仕様との突合」にまとめてある。
