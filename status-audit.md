# 1. 現状の要約

- **調査対象**: 指定欄が空欄だったため、作業対象のリポジトリと公開サイトから `FORIFOR/genie` を対象に確定した。集計用固定識別子は **`forifor-genie`**。
- **確認日時**: レポート作成 2026-09-15 00:00 JST。公開ページのHTTP取得は主に 2026-09-14 23:58 JST、GitHub APIは 2026-09-15 00:00 JST（日本時間）。
- **公開先**: 英語・日本語の公式サイト、ORBITのブラウザデモ、GitHubリポジトリ／Release、Zenn記事、YouTubeのGenie関連動画3本を確認した。TikTokは公開URL・アカウント記録が資料と公開PRにあるが、今回の取得ではWAF待機のため本文と反応値を独立確認できなかった。Facebookは公開URLのOGメタデータから投稿タイトル・Genie記事本文を確認できたが、反応値は未取得。App Store・料金／決済ページは確認できない。
- **発信元**: GitHubは公開ユーザー `FORIFOR`、YouTubeはチャンネル表示名「フォリフォリ」、Zennは `forifori` を公開ページから確認した。TikTok `@foriforapps` は資料記載・PR記載のみで本文を再取得できず、Facebook Page ID `61593966556275` は公開URLのOGメタデータで本文を確認した。両者の他プロジェクトとの共用状態や投稿方法は未確認。X、Instagram、LinkedIn、note、Qiita、Reddit、Hacker News、Product Huntのプロジェクト専用アカウントは確認できず、存在を推測していない。
- **発信内容と導線**: 「依頼→AI作業→使える成果物」を、HTML試作、Webコピー改善、次の行動の3実演で示し、GitHubの初回テストガイド・テスター募集Issueへ誘導している。ZennはGitHub・YouTube・ORBITへリンクする。YouTubeの公開説明には旧 `Astra` と旧 `https://github.com/FORIFOR/astra` が残り、現行Genie導線と不一致である。
- **実測できた結果**: GitHubはスター **0**、フォーク **0**、watchers **0**。GitHub APIの返却14日窓（2026-08-31〜09-13 UTC）は閲覧15／ユニーク14、clone 543／ユニーク207だが、所有者・CI・検証を除外できずテスター数ではない。v0.1.4 assetはDMG 1、ZIP 2、ガイドPDF 1、SHA256SUMS 1。Zennはいいね1・コメント0（PV未取得）。YouTubeは xOQnOKG_Ndg が253再生／0高評価、x74kQKDzHsU が12／0、uSIxI4MGzrg が7／0（公開HTML取得値）。
- **まだ分からないこと**: Webの訪問・CTA・登録・継続、Zenn PV、YouTubeのコメント・維持率・登録者増減、TikTokの現在の投稿・分析値、Facebookの反応数値、外部テスター人数、問い合わせ・商談・売上・費用は未確認または取得不可。公開Issue #7はオープンでコメント0件だが、応募者数0とは扱わない。
- **公開状態の注意**: GitHubの最新stable表示は旧名 `Astra 0.1.1`、現行名 `Genie 0.1.4` はpre-release。ローカル作業ツリーには13ファイルの未コミット変更があり、公開main（`a3d5a93`）には反映されていない。

# 2. プロジェクト基本情報

| project_id | 項目 | 目指している状態 | 現在確認できる状態 | 根拠 | 確認日時 |
|---|---|---|---|---|---|
| forifor-genie | 集計用固定識別子 | 全プロジェクト横断で固定 | `forifor-genie` として本レポートで固定 | 本レポートの監査定義 | 2026-09-15 00:00 JST |
| forifor-genie | 現在の正式な公開名称 | Genieへ完全統一 | GitHub repo・サイト・v0.1.3/v0.1.4・ZennはGenie。v0.1.0〜v0.1.2、v0.1.1 latest stable、動画説明の一部はAstra | https://github.com/FORIFOR/genie ; https://genie-forifor.forifor.chatgpt.site/ja ; https://github.com/FORIFOR/genie/releases | 2026-09-15 00:00 JST |
| forifor-genie | 旧名称、別名 | 旧名を全公開先から除去 | AstraがRelease名・YouTube説明・GitHub traffic人気パスに残る | `/Users/shuhei/Projects/genie/docs/GENIE_RENAME.md`; GitHub traffic/popular/paths; YouTube公開HTML | 2026-09-15 00:00 JST |
| forifor-genie | リポジトリ名とURL | 現行ソースをmainで公開 | `FORIFOR/genie`、main、公開API確認。HTMLトップは監査時に504 | https://github.com/FORIFOR/genie | 2026-09-15 00:00 JST |
| forifor-genie | 製品を一文で説明 | 目標から複数工程の成果物まで一貫して自動化 | READMEは「目標を伝え、AIモデルと進め、native Mac workspaceに結果を残す。action plan、website message、small HTML prototype」 | GitHub公開README（gh API取得） | 2026-09-15 00:00 JST |
| forifor-genie | 主な想定利用者 | Mac上で実務をAIと進めたい開発者・個人開発者 | macOS 14+、ローカルgateway/worker/agent host/modelが必要な開発者向けpreview | README、docs/TESTING.md、サイト | 2026-09-15 00:00 JST |
| forifor-genie | 現在、利用者に最も取ってほしい行動 | 継続利用・事業相談 | まず1件試し、GitHub tester feedback Issueへ結果・つまずきを報告。starも補助CTA。 | README、サイト #start、Issue #7 | 2026-09-15 00:00 JST |
| forifor-genie | 実際に利用できる状態 | 登録不要で誰でも即時利用、または本番SaaS | ブラウザのORBITは即時閲覧可能。MacはDMG／sourceを取得できるが、複数のローカル依存サービスとモデルの準備が必要。SaaS登録・決済は確認できない | Release v0.1.4、README、docs/TESTING.md、サイト | 2026-09-15 00:00 JST |

**ローカルと公開mainの区別**: 監査対象のローカル作業ツリーは13ファイル変更中（`git status`）。これらは今回の監査で作成したファイル以外、公開・コミット・デプロイしていない。公開リポジトリのmain HEADは `a3d5a9395cab610eace2c75ac0a0d2ee1daec3ba`（2026-09-14 05:05 JST）。

# 3. アカウント台帳

詳細は [accounts.csv](./accounts.csv) を参照。アカウントの存在を確認できない媒体は「未確認」とし、アカウントなしとは断定していない。`資料記載のみ` は過去の作業記録・公開PRに書かれている状態で、今回のログイン済み管理画面や投稿本文の再取得を意味しない。

# 4. ホームページ・公開先台帳

詳細は [assets.csv](./assets.csv) を参照。英語／日本語ページ、ORBIT、GitHub、v0.1.4 Release、初回ガイド、テスターIssue、Zenn、YouTube 3本、資料記載のTikTok、公開本文を確認したFacebook、問い合わせフォームを分けた。HTTP 200は「ページを取得できた」だけで、登録・送信・決済・試用完了を意味しない。

リンク検査では、公式サイトの主要静的CSS・JS・動画・字幕・poster・ORBIT・保存成果物はHTTP 200だった。GitHubリポジトリトップはこの監査時にHTTP 504となったが、GitHub API・Release・Issueは取得できたため、リンク切れとは断定していない。

# 5. 発信履歴・運用状況

詳細は [activities.csv](./activities.csv) を参照。対象期間は原則 2026-08-16〜2026-09-15（公開開始以降）で、公開日時を取得できた活動を中心に記録した。下書き・予約済み・非公開候補は公開済み件数に含めていない。

- **実際の発信頻度**: GitHub Release 5件（8/31〜9/13）、公開Issue 2件（9/9、9/13）、Zenn 1本（9/14）、YouTube 3本（9/12公開）。TikTok 1本は資料上公開済みだが、公開日時と本文を再取得できない。Facebook投稿1本は公開URLのOGメタデータで本文を確認したが、公開日時と反応数値は未取得。各媒体の期間が異なり、単純合算をリーチとは扱わない。
- **発信テーマの内訳**: 製品紹介・操作デモ（YouTube 3、サイト3実演）、開発／検証記録（GitHub Release・Issue、Zenn 1）、テスター募集（Issue #7）、記事紹介（Facebook 1）。比較・役立ち情報・広告出稿は、このプロジェクトの公開実績として確認できない。
- **投稿後の返信・コミュニケーション**: Issue #1はコメント5（全てFORIFOR）、Issue #7はコメント0・reactionなし。SNSの返信・DM・広告管理は未確認。公開Issueのコメント0をテスター0と読み替えていない。
- **運用ルール・定期実行**: README、docs/growth、PR #8に手動／資料上の運用記録はあるが、公式API・予約投稿・定期ジョブの現行接続は確認できない。個人アカウント投稿や有料広告を行った証拠は今回確認しなかった。
- **直近の成功・失敗**: 公開URL取得とYouTube/Zennの公開状態・一部反応値は確認できた。旧Astraリンク残存、TikTok本文・SNS反応値の取得不可、Web解析未設定、外部テスター成果未測定が残る。GitHub traffic人気パスに旧 `/FORIFOR/astra` が残る。
- **調査範囲の制限**: GitHub traffic APIは14日窓。YouTube公開HTMLは再生数・高評価のみ。Zenn公開HTMLはいいね・コメントのみ。TikTok Studio・Facebook Page Insights・YouTube Studio・サイト解析ダッシュボードにはログイン／操作していない。

# 6. 成果の実測値

詳細は [metrics.csv](./metrics.csv) を参照。

「0」はAPIまたは公開表示で0を確認した数値、「空欄」は取得不可・未確認である。GitHub clone・Release downloadはCI、検証、所有者アクセスを除外できないため、テスター人数に換算していない。GitHub trafficのユニーク値の日次合計は同一人の重複排除済み累計ではない。Webの訪問・CTA、Zenn PV、SNS詳細、テスター・事業成果・費用は空欄で、成果0を意味しない。

# 7. 発信から成果までの導線

| 段階 | 存在するか | 利用可能か | 計測されているか | 実測値 | 根拠 | 確認日時 |
|---|---|---|---|---|---|---|
| 発信アカウント → 投稿 | 一部確認済み | GitHub／Zenn／YouTube／Facebookは公開ページ利用可（FacebookはOG本文）。TikTokは本文未確認 | 媒体ごとに部分的。SNS Studioは未取得 | YouTube 3本、Zenn 1本、GitHub Release 5件、Facebook 1本。TikTokは資料記載のみ | accounts.csv、activities.csv | 2026-09-15 00:00 JST |
| 投稿 → ホームページ・GitHub・製品ページ | 確認済み | YouTube/Zenn/サイトにリンクあり。ただしYouTubeは旧Astra URL | UTM・クリックは未計測 | GitHub traffic referrer: github.com 8、旧サイト 2（API返却値） | GitHub traffic/referrers API、公開HTML | 2026-09-15 00:00 JST |
| ホームページ → 試用・登録・ダウンロード | 確認済み | ORBITは閲覧可能。Mac previewは依存サービス準備が必要。登録・決済なし | Web訪問・CTA計測は未設定 | GitHub Release asset: v0.1.4 DMG 1、ZIP 2 | サイト、README、Release API | 2026-09-15 00:00 JST |
| 試用・ダウンロード → 継続利用・フィードバック | 導線は存在 | Issue templateは開くが、送信は未実行。外部試用完了は未確認 | Issueコメントは観測可能 | Issue #7 コメント0（応募者数・試用人数ではない） | https://github.com/FORIFOR/genie/issues/7 | 2026-09-15 00:00 JST |
| フィードバック → 問い合わせ・有料利用 | 問い合わせフォームは存在 | フォーム表示のみ。送信・返信・決済は未検証 | 受信・CRM・決済計測は未確認 | https://genie-forifor.forifor.chatgpt.site/ja#business、assets.csv | 2026-09-15 00:00 JST |

現状は「公開先と試用導線は存在するが、投稿からサイト、試用、継続、事業成果を結び付ける計測がない／取得できない」状態である。投稿がスターや登録を増やしたとは断定できない。

# 8. 未確認事項と取得方法

| 未確認事項 | 現状 | 最小限の取得方法（変更を伴わないもの） | 根拠／確認日時 |
|---|---|---|---|
| TikTokアカウントの所有者・Business種別・最新投稿・Studio指標 | URLと動画IDは資料／PR記載。公開本文はWAF待機 | TikTok専用アカウントでStudioのプロフィール・動画詳細・期間別分析を読み取り、アカウント全体とGenie投稿を分離して転記 | https://github.com/FORIFOR/genie/pull/8、/Users/shuhei/Projects/genie/docs/growth/2026-09-14/metrics.json ／ 2026-09-15 00:00 JST |
| Facebook Pageの公開日時・反応・Insights | 公開OGメタデータで本文は確認済みだが、日時・反応値・管理画面は未取得 | Page管理画面の投稿一覧／Insightsを読み取り、Genie投稿だけを抽出 | /Users/shuhei/Projects/genie/docs/growth/2026-09-14/README.md ／ 2026-09-15 00:00 JST |
| YouTube Studioのコメント、維持率、登録者増減、流入 | 公開HTMLでは再生・高評価の一部のみ | チャンネル所有者のStudioで対象3動画の期間・指標を読み取り、チャンネル全体と動画を分離 | https://www.youtube.com/channel/UC57pskJSltkzC8oY_XLBozQ ／ 2026-09-15 00:00 JST |
| Zenn PV・流入 | 公開HTMLにPVなし | Zenn記事管理画面のPVと期間別流入を読み取り | https://zenn.dev/forifori/articles/genie-mac-workspace ／ 2026-09-15 00:00 JST |
| 公式サイト訪問、CTA、フォーム受信 | HTMLに解析タグなし。フォーム送信は未実行 | 既存のホスティング／フォーム管理画面で読み取り専用のアクセス・受信ログを確認。新規送信は不要 | https://genie-forifor.forifor.chatgpt.site/ja ／ 2026-09-14 23:58 JST |
| 外部テスター人数・継続利用・実際の成果 | Issue #7はコメント0。clone/downloadは自動化混在 | 既存のIssue、匿名フィードバック、配布ログを読み取り、本人／CI／テスターを識別できる範囲だけ集計 | https://github.com/FORIFOR/genie/issues/7 ／ 2026-09-15 00:00 JST |
| GitHub trafficの30日値・所有者／CI除外後の実利用 | APIは14日窓、cloneの出所は不明 | GitHubが提供する次回期間のtrafficを定期的に読み取り、CIログと突合（投稿や設定変更は不要） | GitHub traffic API ／ 2026-09-15 00:00 JST |
| 問い合わせ、商談、契約、売上、広告費、制作費 | 公開情報・フォーム表示からは取得不可 | 既存の受信箱／請求書／広告管理を読み取り、Genieに紐づくものだけを分離 | business form、公開README ／ 2026-09-15 00:00 JST |
| ローカル未コミット変更の公開反映 | 13ファイルが作業ツリー変更中。公開mainは `a3d5a93` | ownerがレビュー後に明示的なcommit／push／deployを行う（今回の監査では禁止のため実行しない） | `git status`、`git rev-parse HEAD` ／ 2026-09-15 00:00 JST |
| プロジェクト全体のOSSライセンス | GitHub `licenseInfo=null`、READMEも未設定と明記 | 権利者がライセンスを選択し、公開設定を更新する判断が必要。監査では変更しない | GitHub repo API、README ／ 2026-09-15 00:00 JST |

# 9. 優先して解消すべき問題、最大3件

| 優先度 | 現在確認できる事実 | 影響 | 最小限の解消条件 |
|---|---|---|---|
| 1 | YouTube 3本の説明欄に旧 `Astra`／旧GitHub URLが残り、GitHub trafficにも旧 `/FORIFOR/astra` 人気パスが残る | 現行Genieを試したい読者が旧導線へ進み、スター・試用・フィードバックの帰属が分散する | 各公開動画説明と旧URLの到達先を読み取り確認し、現行Genie URLに統一できたかを再監査する（公開操作は所有者判断） |
| 2 | サイト解析、SNS詳細分析、Zenn PV、試用完了、問い合わせの計測が未設定／未取得 | 発信が見られたか、試用・継続・事業成果につながったかを判定できない。0と未取得を区別して追跡できない | 既存の各管理画面を読み取り、project_id・媒体・投稿ID・期間を揃えた台帳を作る。新規投稿・課金・個人アカウント利用は不要 |
| 3 | 公開の最新stableはAstra 0.1.1、Genie 0.1.4はpre-release。Mac previewはgateway/worker/host/modelが必要で、DMGはmanaged launcherを含まない。licenseInfoもnull | 初見テスターが現在版・導入手順・利用許諾を誤解しやすく、企業導入可否も判断できない | 配布対象の安定版・名称・必要依存・ライセンス方針を所有者が決定し、公開案内とRelease表示を同じ状態に揃えてから再監査する |

この監査では、上記の問題に対する投稿、アカウント設定変更、コード変更、デプロイ、問い合わせ送信、登録、課金、広告出稿を行っていない。
