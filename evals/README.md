# evals

正本 §25 の受け入れスイート。実装仕様 §14.2 の形式に従う。

```text
evals/<domain>/<case-id>/
  meta.yaml     { phase, tags, blocking }
  *.test.ts     実行内容
```

`blocking: true` のケースは CI を止める。Phase 0 では `actions/phase0` だけが blocking。

```sh
pnpm test:acceptance     # 使い捨て DB を用意して受け入れテストを実行
```

| ディレクトリ                                        | 対象                        | 状態         |
| --------------------------------------------------- | --------------------------- | ------------ |
| `actions/phase0`                                    | 実装仕様 §16 の AC-1〜AC-16 | **blocking** |
| `conversation` `stt` `meeting` `research` `plugins` | 正本 §25 の各スイート       | Phase 1 以降 |
