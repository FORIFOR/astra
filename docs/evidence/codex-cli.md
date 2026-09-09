# Codex CLIで実検証する

Agent Hostは、端末でサインイン済みのCodex CLIを直接呼べる。AstraはCodexの認証ファイルを読まず、資格情報をAPIキーへ転用しない。

```bash
codex login status
ASTRA_LLM_CLI=codex ./scripts/reality/run-screenshot-e2e.sh
ASTRA_LLM_CLI=codex ./scripts/reality/run-work-context-release-gate.sh
```

通常のAgent Host起動でも `ASTRA_LLM_CLI=codex` を指定する。同じ環境変数をAstraアプリにも渡すと、画像送信先がOpenAIと表示される。実行先が未指定なら「接続したモデルの提供元」と表示し、Claudeだと断定しない。

- `ASTRA_CODEX_PATH`: CLIのパス（既定 `codex`）。
- `ASTRA_CODEX_MODEL`: 任意のモデル指定。省略時はCLI側の既定モデル。
- `ASTRA_LLM_CLI=claude_code`: 従来のClaude Code経路。呼び出し失敗後に無断で別サービスへ切り替えない。
- CLI指定なしのAgent Hostは両方をprobeし、従来どおりClaude Codeを優先、その次にCodexを選ぶ。

実行は使い捨てディレクトリ、read-only sandbox、ephemeral sessionで行う。user configは読み込まず、shell、apps、plugins、multi-agent、computer/browser useを無効にする。`search.web` のときだけweb searchを有効にする。画像は検証済みの添付パスのみ `--image` へ渡し、JSONLの完了turnから最終JSONを取り出す。失敗・途中切れ・JSONでない回答は成功扱いにしない。

CLIの引数は[公式Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)と、このPCの`codex exec --help` / `codex features list`で確認した。

## 2026-09-08の実測

実gateway・Temporal・Agent Host・Codexで画像E2EがPASS。画像内だけにあるnonceを17秒で回答した。これは合成PNGの実画像理解の証拠であり、OSの画面収録許可や実Meetの成功とは区別する。

Agent Hostとlanguage-model契約の138 tests、Swift41 testsがPASS。画像送信先のselftestも `cloudVision(provider: "OpenAI")` でPASS。Claude利用上限を、この検証の必須条件から外せた。
