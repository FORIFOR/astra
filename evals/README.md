# evals

正本 §25 の受け入れスイート。実装仕様 §14.2 の形式に従う。

```text
evals/<domain>/<case-id>/
  meta.yaml     { phase, tags, blocking }
  *.test.ts     実行内容
```

`blocking: true` のケースは CI を止める。現状 `actions/phase0` `phase2` `phase3` `phase4` が blocking。

```sh
pnpm test:acceptance     # 使い捨て DB を用意して受け入れテストを実行
```

| ディレクトリ                                        | 対象                                 | 状態         |
| --------------------------------------------------- | ------------------------------------ | ------------ |
| `actions/phase0`                                    | 実装仕様 §16 の AC-1〜AC-16          | **blocking** |
| `actions/phase2`                                    | Phase 2 実装仕様 §5 の AC2-1〜AC2-12 | **blocking** |
| `actions/phase3`                                    | Phase 3 実装仕様 §0 の AC3-1〜AC3-12 | **blocking** |
| `actions/phase4`                                    | Phase 4 実装仕様 §0 の AC4-1〜AC4-12 | **blocking** |
| `conversation` `stt` `meeting` `research` `plugins` | 正本 §25 の各スイート                | Phase 1 以降 |
