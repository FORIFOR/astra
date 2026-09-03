#!/usr/bin/env bash
# 操作ガイドの語が、アプリが**今**表示している語と同じかを機械で確かめる。
#
# 正本は Swift の `UserFacingFacts`（`--selftest facts` が FACT 行で吐く）。ガイド（docs/guide/build.py）は
# `fact("key")` / `shortcut("key")` でしか画面の語を書けない。protected の語をガイドに文字で書いたら落ちる。
# 過去に起きた欠陥: 設定の行が「録音の開始 / 停止」なのにガイドが「録音の開始 / 停止」と別の語で写していた、
# 許可の名前が 設定/エラー/ガイド で 3 通り（画面収録 / 画面の読み取り）あった。
#
#   bash scripts/verify-guide-facts.sh              # 全部の検査 + ガイド build
#   bash scripts/verify-guide-facts.sh --selfcheck  # 検査が本当に落ちるか（protected の語を書き戻した写しで確かめる）
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/apps/astra-macos/.build/debug/AstraMac"
BUILD="$ROOT/docs/guide/build.py"
[[ -x "$BIN" ]] || { echo "FAIL: 先に swift build --package-path apps/astra-macos" >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ガイドが必ず引く語（ここに無い key が facts から消えたら、ガイドが何を失ったか分かるように名前で落とす）
REQUIRED=(
  settings.shortcutRow settings.permissionsSection permission.request
  permission.microphone permission.screenRecording permission.accessibility permission.calendar permission.inputMonitoring
  dock.plan dock.context dock.suggested
  confirmation.confirm.example confirmation.cancel confirmation.edit
  recovery.resume recovery.discard session.interrupted
  nav.home nav.work nav.library nav.apps work.tasks work.agents library.meetings library.files apps.plugins apps.connectors
  menu.open menu.settings menu.guide menu.quit menu.checkUpdates
  recording.start recording.stop recording.menu.start recording.menu.stop recording.cannotStart
  recording.hero.recording recording.hero.paused recording.hero.silentSuffix
  meeting.notes meeting.notes.open meeting.detach notes.summary notes.decisions notes.actions source.label
  home.intent.placeholder listening.placeholder task.stop task.openWorkspace result.open result.copy result.openSettings
  hud.clickHint shortcut.recording.toggle shortcut.confirmation.proceed shortcut.escape
)

# 検査本体。$1 = build.py の path（--selfcheck は写しを渡す）。落ちたら 1。
check() {
  local build="$1" fail=0 facts="$TMP/facts.txt"
  "$BIN" --selftest facts >"$facts" 2>&1
  if ! grep -q '^SELFTEST_OK facts' "$facts"; then
    echo "  FAIL: --selftest facts が通らない"; grep -E 'FAIL' "$facts" | head -10; return 1
  fi
  grep -q $'^LOCALE\tja-JP$' "$facts" || { echo "  FAIL: facts の locale が ja-JP ではない"; fail=1; }
  awk -F'\t' '$1=="FACT"{print $2"\t"$3"\t"$4}' "$facts" >"$TMP/facts.tsv"
  local n; n=$(wc -l <"$TMP/facts.tsv" | tr -d ' ')
  # 重複 key
  local dup; dup=$(cut -f1 "$TMP/facts.tsv" | sort | uniq -d)
  [[ -z "$dup" ]] || { echo "  FAIL: fact key が重複: $dup"; fail=1; }
  # 必須 key
  local k missing=()
  for k in "${REQUIRED[@]}"; do grep -q "^$k"$'\t' "$TMP/facts.tsv" || missing+=("$k"); done
  [[ ${#missing[@]} -eq 0 ]] || { echo "  FAIL: 必須 fact が無い: ${missing[*]}"; fail=1; }
  # 許可は 5 つ（permission.request は動詞の札で許可名ではない）
  local perms; perms=$(cut -f1 "$TMP/facts.tsv" | grep -c '^permission\.' ); perms=$((perms-1))
  [[ "$perms" -eq 5 ]] || { echo "  FAIL: 許可名が 5 つではない（$perms）"; fail=1; }
  # 鍵: FACT の表示と SHORTCUT の表示・badge が同じ
  while IFS=$'\t' read -r _ key disp badges; do
    local fv; fv=$(awk -F'\t' -v k="$key" '$1==k{print $2}' "$TMP/facts.tsv")
    [[ "$fv" == "$disp" ]] || { echo "  FAIL: 鍵 $key の表示が FACT($fv) と SHORTCUT($disp) で違う"; fail=1; }
    [[ "$(tr -d ' ' <<<"$badges" | tr '[:upper:]' '[:lower:]')" == "$(tr '[:upper:]' '[:lower:]' <<<"$disp")" ]] \
      || { echo "  FAIL: 鍵 $key の badge($badges) が表示($disp) と違う"; fail=1; }
  done < <(grep $'^SHORTCUT\t' "$facts")
  # アプリ側: 鍵の表示（⌥Space 等）を画面の文字列に直書きしていないか。正本は GlobalShortcut.label() /
  # UserShortcut。直書きが残ると、割り当てを変えた日に画面とガイドが別々の鍵を言う。
  # 対象は SHORTCUT の表示値そのもの。ログ（NSLog）とコメントは除く。
  local src="$ROOT/apps/astra-macos/Sources/AstraMac"
  while IFS=$'\t' read -r _ _ disp _; do
    [[ "$disp" =~ [⌘⌥⌃⇧] ]] || continue   # esc のような素の語は他の語の一部と区別できない
    local hit; hit=$(grep -rn --include='*.swift' -F "\"" "$src" \
      | grep -F "$disp" | grep -v -E '^[^:]+:[0-9]+:\s*//|NSLog\(|/(Windowing/GlobalShortcut|App/UserFacingFacts|App/SelfTest)\.swift:' \
      | grep -E "\"[^\"]*$disp[^\"]*\"" || true)
    [[ -z "$hit" ]] || { echo "  FAIL: 鍵の表示 $disp を画面の文字列に直書き:"; sed 's/^/    /' <<<"$hit"; fail=1; }
  done < <(grep $'^SHORTCUT\t' "$facts")
  # ガイドが引く key が facts に在るか / protected の語がガイドに文字で書かれていないか
  python3 - "$build" "$TMP/facts.tsv" <<'PY' || fail=1
import re,sys
src=open(sys.argv[1],encoding='utf-8').read()
facts={}
for line in open(sys.argv[2],encoding='utf-8'):
    k,v,p=line.rstrip('\n').split('\t'); facts[k]=(v,p=='1')
bad=0
refs=set(re.findall(r'\b(?:fact|shortcut)\("([^"]+)"',src))
unknown=sorted(r for r in refs if r not in facts)
if unknown: print('  FAIL: ガイドが知らない fact を引いている:',' '.join(unknown)); bad=1
# 画面の語を書いてよいのは template（html=f\'\'\' … \'\'\'）の中だけ fact() 経由。template から fact()/shortcut() を抜いた残りを見る。
m=re.search(r"^html=f'''(.*?)'''",src,re.S|re.M)
if not m: print('  FAIL: build.py に html=f\'\'\' … \'\'\' の template が無い'); sys.exit(1)
body=re.sub(r'\{(?:fact|shortcut)\("[^"]+"(?:,\s*names=True)?\)\}','',m.group(1))
base=src[:m.start()].count('\n')+1
def where(i): return base+body[:i].count('\n')
hard=[(k,v) for k,(v,p) in facts.items() if p and v in body]
for k,v in hard:
    print(f'  FAIL: protected の語「{v}」({k}) がガイドに文字で書かれている（build.py:{where(body.index(v))} 付近）。fact("{k}") で引く')
if hard: bad=1
# 一字違いの写し（過去: 設定は「録音を開始 / 停止」なのにガイドは「録音の開始 / 停止」）。
# 同じ長さで助詞 1 字だけ違う（を→の のような写し違い）。5 字以上の語だけ見る。地の文の偶然の一致は助詞でなければ通す。
near=[]
for k,(v,p) in facts.items():
    if not p or len(v)<5 or v in body: continue
    L=len(v)
    for i in range(len(body)-L+1):
        w=body[i:i+L]
        d=[(x,y) for x,y in zip(v,w) if x!=y]
        if len(d)==1 and d[0][0] in 'をのがにではと' and d[0][1] in 'をのがにではと': near.append((k,v,w,where(i))); break
for k,v,w,ln in near:
    print(f'  FAIL: 「{w}」はアプリの語「{v}」({k}) と一字違い（build.py:{ln} 付近）。古い写し。fact("{k}") で引く')
if near: bad=1
# 過去に画面とガイドで割れた綴り。DS-06 の正本（FACTS.md §5）に無い方を書いたら落とす。
STALE=['録音の開始 / 停止','画面の読み取り']
stale=[t for t in STALE if t in body]
for t in stale: print(f'  FAIL: 古い綴り「{t}」がガイドに在る（build.py:{where(body.index(t))} 付近）')
if stale: bad=1
print(f'  facts {len(facts)} 件 / ガイドが引く key {len(refs)} 件 / 文字で書かれた protected {len(hard)} 件 / 一字違い {len(near)} 件 / 古い綴り {len(stale)} 件')
sys.exit(bad)
PY
  return $fail
}

if [[ "${1:-}" == "--selfcheck" ]]; then
  # 検査が本当に落ちるか。過去の欠陥をそのまま写しに書き戻す:
  #   1) 設定の行を昔の写し「録音の開始 / 停止」の文字に（一字違い）
  #   2) 許可名を fact() を通さず文字で（protected の語そのもの）
  #   3) ガイドが知らない key を引く
  ok=1
  fixture() {  # $1 名前 $2 置換前 $3 置換後
    cp "$BUILD" "$TMP/build-stale.py"
    python3 - "$TMP/build-stale.py" "$2" "$3" <<'PY'
import sys; p,old,new=sys.argv[1:]; s=open(p,encoding='utf-8').read()
assert s.count(old)>=1, f'写しに {old} が無い'
open(p,'w',encoding='utf-8').write(s.replace(old,new,1))
PY
    echo "  selfcheck $1:"
    if check "$TMP/build-stale.py" >"$TMP/selfcheck.log" 2>&1; then
      echo "    見逃した（検査が通ってしまった）"; ok=0
    else
      grep -E '^  FAIL' "$TMP/selfcheck.log" | head -2 | sed 's/^/  /'
    fi
  }
  fixture "1 一字違いの古い写し"  '{fact("settings.shortcutRow")}'        '録音の開始 / 停止'
  fixture "2 許可名を文字で"       '{fact("permission.screenRecording")}'  '画面収録'
  fixture "3 知らない key"         '{fact("settings.shortcutRow")}'        '{fact("settings.noSuchRow")}'
  [[ $ok -eq 1 ]] && { echo "GUIDE_FACTS_SELFCHECK_OK: 3 つの書き戻しを全部捕まえた"; exit 0; }
  echo "GUIDE_FACTS_SELFCHECK_FAIL"; exit 1
fi

fail=0
check "$BUILD" || fail=1
if [[ $fail -eq 0 ]]; then
  # ガイドを実際に組む（絵は、まっさらな data root で撮った初回起動の面。ASTRA_GUIDE_CLEAN_SHOTS が在ればそれを使う）
  shots="${ASTRA_GUIDE_CLEAN_SHOTS:-}"
  if [[ -z "$shots" || ! -f "$shots/06-main-home.png" ]]; then
    shots="$TMP/shots"
    pkill -9 -x AstraMac 2>/dev/null; sleep 0.5
    ASTRA_DATA_ROOT="$TMP/data" "$BIN" --selftest shots "$shots" 2>&1 | grep -E '^SELFTEST_(OK|FAIL)' || { echo "  FAIL: 初回起動の面が撮れない"; fail=1; }
  fi
  if [[ $fail -eq 0 ]]; then
    out="$( cd "$ROOT" && ASTRA_GUIDE_CLEAN_SHOTS="$shots" ASTRA_GUIDE_OUT="$TMP/out" ASTRA_GUIDE_BIN="$BIN" python3 "$BUILD" 2>&1 )" \
      && [[ -s "$TMP/out/Astra-操作ガイド.html" ]] && echo "  guide build: $out" \
      || { echo "  FAIL: ガイドが組めない"; tail -20 <<<"$out"; fail=1; }
  fi
fi
if [[ $fail -eq 0 ]]; then
  echo "GUIDE_FACTS_OK: ガイドの語はアプリの表示（UserFacingFacts）だけから来ている"
else
  echo "GUIDE_FACTS_FAIL"
fi
exit $fail
