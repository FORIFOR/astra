# Astra Context Bridge（Chrome 拡張）

仕様書 §9 / §10。ブラウザでしか取れない文脈（Notion / Gmail など）を Astra に渡す。

## 送るもの・送らないもの

送る:

- URL / タイトル
- 選択しているテキスト（最大 2000 文字）
- focus している要素の role と block id
- **画面に見えている**ブロック（最大 12 件・各 400 文字）

送らない:

- ページの DOM 全文
- 見えていない部分
- Cookie / localStorage / 認証情報

## 入れ方（ユーザー操作が要る）

拡張のインストールと Native Messaging host の登録は、ブラウザの設定変更なので
**利用者自身が行う**。Astra は自動では入れない。

1. `chrome://extensions` → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」
   → `apps/browser-extension` を選ぶ
2. 表示された拡張 ID を控える
3. Native Messaging host を登録する:

```bash
scripts/install-native-messaging-host.sh <拡張ID>
```

4. Astra を再起動する

## 検証

host 側（Astra）のプロトコルと Notion Adapter は
`AstraMac --selftest browser` で検査している（ブラウザ無しで走る）。
拡張を入れた実ブラウザとの往復は、上の手順を踏むまで **external verification pending**。
