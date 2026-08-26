# evals

正本 §25 の受け入れスイート。実装仕様 §14.2 の形式に従う。

```text
evals/<domain>/<case-id>/
  meta.yaml     { phase, tags, blocking }
  *.test.ts     実行内容
```

`blocking: true` のケースは CI を止める。現状 `actions/phase0` `phase2` `phase3` `phase4` `phase5` `phase6` `phase7` `security` `product` `conversation` `research` が blocking。

```sh
pnpm test:acceptance     # 使い捨て DB を用意して受け入れテストを実行
```

| ディレクトリ                                        | 対象                                                 | 状態         |
| --------------------------------------------------- | ---------------------------------------------------- | ------------ |
| `actions/phase0`                                    | 実装仕様 §16 の AC-1〜AC-16                          | **blocking** |
| `actions/phase2`                                    | Phase 2 実装仕様 §5 の AC2-1〜AC2-12                 | **blocking** |
| `actions/phase3`                                    | Phase 3 実装仕様 §0 の AC3-1〜AC3-12                 | **blocking** |
| `actions/phase4`                                    | Phase 4 実装仕様 §0 の AC4-1〜AC4-14                 | **blocking** |
| `actions/phase5`                                    | Phase 5 実装仕様 §1 の AC5-1〜AC5-10                 | **blocking** |
| `actions/phase6`                                    | Phase 6 実装仕様 §0 の AC6-1〜AC6-10                 | **blocking** |
| `actions/phase7`                                    | Phase 7 実装仕様 §0 の AC7-1〜AC7-10                 | **blocking** |
| `actions/security`                                  | 正本 §25 の Action / Plugin 評価軸（敵対的）         | **blocking** |
| `actions/product`                                   | 正本 §30 Product Acceptance の Case A / B（通し）    | **blocking** |
| `actions/conversation`                              | 正本 §25 Conversation（30 turn / 話題の切替 / 混在） | **blocking** |
| `actions/research`                                  | 正本 §25 Research（新しさ / 引用 / 矛盾 / 裏付け）   | **blocking** |
| `conversation` `stt` `meeting` `research` `plugins` | 正本 §25 の各スイート                                | Phase 1 以降 |
