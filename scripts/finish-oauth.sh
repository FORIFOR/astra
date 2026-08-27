#!/usr/bin/env bash
#
# 最後の 1 つ（OAuth）を終わらせるための確認。
#
# **何が足りないかを言い、埋まっていれば実際に繋いで確かめる。**
# 「たぶん動く」で終わらせないために、疎通まで見る。
#
#   ./scripts/finish-oauth.sh
#
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-}"
CLIENT_ID="${ASTRA_OAUTH_GOOGLE_CLIENT_ID:-}"
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
todo() { printf '  \033[33m→\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

missing=0

say "1. Google Cloud のプロジェクト"
if [ -n "$PROJECT" ]; then
  ok "GOOGLE_CLOUD_PROJECT=$PROJECT"
else
  bad "GOOGLE_CLOUD_PROJECT が設定されていません"
  todo "export GOOGLE_CLOUD_PROJECT=astra-production-506721"
  missing=$((missing + 1))
fi

say "2. 資格情報（ADC）"
if gcloud auth application-default print-access-token >/dev/null 2>&1; then
  ok "ADC で token を取得できます"
else
  bad "ADC が通っていません"
  todo "gcloud auth application-default login"
  missing=$((missing + 1))
fi

say "3. 必要な API"
# **有効なものと足りないものを、両方言う。**足りないものだけ言うと、
# 何が既に済んでいるのか分からない。
if [ -n "$PROJECT" ]; then
  enabled="$(gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' 2>/dev/null || true)"
  for api in speech.googleapis.com texttospeech.googleapis.com translate.googleapis.com \
             gmail.googleapis.com calendar-json.googleapis.com; do
    if printf '%s\n' "$enabled" | grep -qx "$api"; then
      ok "$api"
    else
      bad "$api が無効です"
      todo "gcloud services enable $api --project=$PROJECT"
      missing=$((missing + 1))
    fi
  done
else
  todo "プロジェクトが決まっていないので確認できません"
fi

say "4. OAuth Client（デスクトップ用）"
if [ -n "$CLIENT_ID" ]; then
  ok "ASTRA_OAUTH_GOOGLE_CLIENT_ID が設定されています"
else
  bad "ASTRA_OAUTH_GOOGLE_CLIENT_ID が設定されていません"
  todo "https://console.cloud.google.com/apis/credentials で"
  todo "  「認証情報を作成」→「OAuth クライアント ID」→ 種類は「デスクトップ アプリ」"
  todo "  client secret は要りません（native app は秘密を保てない / RFC 8252 §8.5）"
  todo "export ASTRA_OAUTH_GOOGLE_CLIENT_ID='<作った Client ID>'"
  missing=$((missing + 1))
fi

say "いまの状態"
if [ "$missing" -eq 0 ]; then
  ok "必須の設定は揃っています"
  printf '\n  能力の名乗り:\n'
  node -e '
    const run = async () => {
      const { capabilityReport } = await import("./services/capabilities/dist/report.js");
      const { meetingProvidersFromEnv } = await import("./services/meeting/dist/factory.js");
      const { researchProvidersFromEnv } = await import("./services/research/dist/factory.js");
      const { assertNoStandIns } = await import("./packages/contracts/dist/index.js");
      const p = process.env.GOOGLE_CLOUD_PROJECT;
      const env = {
        ...process.env,
        GOOGLE_STT_RECOGNIZER: `projects/${p}/locations/us/recognizers/_`,
        GOOGLE_TRANSLATE_PARENT: `projects/${p}/locations/global`,
      };
      const report = capabilityReport({
        meeting: await meetingProvidersFromEnv(env),
        research: researchProvidersFromEnv(env, { host: { async execute() { return { result: {} }; } } }),
        env,
      });
      for (const i of report.items) {
        const mark = i.isStandIn ? "\x1b[33m…\x1b[0m" : "\x1b[32m✓\x1b[0m";
        console.log(`    ${mark} ${i.capability.padEnd(18)} ${i.verification.padEnd(15)} ${i.implementation}`);
      }
      try {
        assertNoStandIns(report, "production");
        console.log("\n  \x1b[32m本番として起動できます\x1b[0m");
      } catch (error) {
        console.log(`\n  \x1b[31mまだ起動できません\x1b[0m — ${error.message}`);
        process.exitCode = 1;
      }
    };
    run().catch((error) => { console.error(error); process.exit(1); });
  '
else
  printf '\n  あと %s つ。上の → を上から実行してください。\n' "$missing"
  exit 1
fi
