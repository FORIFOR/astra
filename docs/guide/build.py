# 操作ガイド（利用者向け）を、committed の golden から組み立てる。
# repo の root で:  python3 docs/guide/build.py  → ~/Downloads/Astra-操作ガイド/Astra-操作ガイド.html
# PDF は Chrome の headless で:
#   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
#     --no-pdf-header-footer --print-to-pdf=<out>.pdf "file://<out>.html"
# 絵は golden をそのまま使い、赤枠と番号だけ PIL で描く。文は下の html にある。
import base64, io, os
from PIL import Image, ImageDraw, ImageFont
G='docs/golden-screenshots/'
# まっさらな ASTRA_DATA_ROOT で撮った初回起動の Home（開発 DB の録りかけを絵に出さない）:
#   ASTRA_DATA_ROOT=/tmp/astra-guide-data .build/debug/AstraMac --selftest shots /tmp/astra-guide-shots
CLEAN=os.environ.get('ASTRA_GUIDE_CLEAN_SHOTS','/tmp/astra-guide-shots').rstrip('/')+'/'
OUT=os.path.expanduser(os.environ.get('ASTRA_GUIDE_OUT','~/Downloads/Astra-操作ガイド'))
FONT='/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc'
def font(sz):
    try: return ImageFont.truetype(FONT, sz)
    except: return ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', sz)

def annotate(path, marks, scale=1.0):
    """marks: list of (n, x0,y0,x1,y1). Draw red rounded box + numbered badge."""
    im=Image.open(path if path.startswith('/') else G+path).convert('RGB')
    d=ImageDraw.Draw(im)
    for n,x0,y0,x1,y1 in marks:
        d.rounded_rectangle((x0,y0,x1,y1), radius=8, outline=(220,38,38), width=3)
        r=14; cx,cy=x0-4,y0-4
        d.ellipse((cx-r,cy-r,cx+r,cy+r), fill=(220,38,38))
        f=font(16); w=d.textlength(str(n),font=f)
        d.text((cx-w/2, cy-11), str(n), fill='white', font=f)
    if scale!=1.0: im=im.resize((int(im.width*scale), int(im.height*scale)), Image.LANCZOS)
    b=io.BytesIO(); im.save(b,'PNG'); return base64.b64encode(b.getvalue()).decode()

def plain(path):
    return base64.b64encode(open(G+path,'rb').read()).decode()
def plainAbs(path):
    return base64.b64encode(open(path,'rb').read()).decode()

imgs={
 'home': annotate(CLEAN+'06-main-home.png', [(1,292,206,1144,276)]),
 'bar':  annotate('task-dock/08-meeting.png', [(1,772,22,806,56),(2,446,22,524,56)]),
 'notes': plain('task-dock/09-meeting-notes.png'),
 'ws':   annotate('04-recording-transcript.png', [(1,738,170,1058,496),(2,22,578,812,622),(3,816,584,1008,616)]),
 'detail': annotate('08-meeting-detail.png', [(1,612,144,642,170),(2,926,66,1216,156),(3,286,74,318,96)]),
 'recnow': annotate('12-recording-now.png', [(1,1052,218,1124,250)]),
 'ask':  annotate(CLEAN+'06-main-home.png', [(1,292,134,1144,180)]),
 'listen': plain('02-voice-hud-listening.png'),
 'agent': annotate('task-dock/06-agent.png', [(1,18,364,104,396),(2,566,364,704,396)]),
 'confirm': annotate('task-dock/07-confirmation.png', [(1,452,204,536,238),(2,300,204,370,238)]),
 'result': plain('task-dock/06c-result.png'),
 'nomic': annotate('09-permission-denied.png', [(1,738,120,1058,166)]),
 'denied': plainAbs('docs/ux-benchmark/astra/JC/01-denied.png'),
}
def img(k, w=None):
    st=f' style="max-width:{w}px"' if w else ''
    return f'<img src="data:image/png;base64,{imgs[k]}"{st} alt="">'

# メニューバーのメニューの絵は、手で写さず**いまのアプリに言わせる**（0.1.1 の絵は
# 「音声入力 … 長押し」のまま実物とずれていた）。先に swift build しておくこと。
import html as _html, subprocess
BIN=os.environ.get('ASTRA_GUIDE_BIN','apps/astra-macos/.build/debug/AstraMac')
def menu_html():
    if not os.path.exists(BIN): raise SystemExit(f'{BIN} が無い。先に swift build --package-path apps/astra-macos')
    out=subprocess.run([BIN,'--selftest','menutitles'],capture_output=True,text=True,timeout=60).stdout
    if 'SELFTEST_OK menutitles' not in out: raise SystemExit('menutitles が取れない:\n'+out)
    rows=[]
    for line in out.splitlines():
        f=line.split('\t')
        if f[0]!='MENU': continue
        if f[1]=='sep': rows.append('<div class="sep"></div>'); continue
        _,_,enabled,title,key=f
        k=f' <span class="k">⌘{key.upper()}</span>' if key else ''
        cls=' class="dim"' if enabled=='0' else ''
        rows.append(f'<div{cls}>{_html.escape(title)}{k}</div>')
    return '<div class="menu">\n '+'\n '.join(rows)+'\n</div>'
MENU=menu_html()

# 画面の語（押せる語・見出し・許可名・鍵）は手で写さない。`UserFacingFacts`（Swift）が正本で、
# `--selftest facts` の `FACT\t<key>\t<value>\t<protected>` を引く。無い key は build を落とす。
# protected の語をこのファイルに文字で書くと `scripts/verify-guide-facts.sh` が落とす。
def load_facts():
    out=subprocess.run([BIN,'--selftest','facts'],capture_output=True,text=True,timeout=60).stdout
    if 'SELFTEST_OK facts' not in out: raise SystemExit('facts が取れない:\n'+out)
    d={}
    for line in out.splitlines():
        f=line.split('\t')
        if f[0]=='FACT': d[f[1]]=f[2]
    return d
FACTS=load_facts()
USED_FACTS=set()
def fact(key):
    if key not in FACTS: raise SystemExit(f'ガイドが知らない fact を引いている: {key}')
    USED_FACTS.add(key)
    return _html.escape(FACTS[key])
def shortcut(key, names=False):
    """鍵の表示を修飾キー 1 つずつの <kbd> に分ける。names=True は初出用（記号に名前を添える）。"""
    v=fact(key); mods=[]
    while v and v[0] in '⌘⌥⌃⇧': mods.append(v[0]); v=v[1:]
    name={'⌘':'⌘ command','⌥':'⌥ option','⌃':'⌃ control','⇧':'⇧ shift'}
    parts=[(name[m] if names else m) for m in mods]+[v.lower() if v.isalpha() else v]
    return '+'.join(f'<kbd>{p}</kbd>' for p in parts)

html=f'''<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>Astra 操作ガイド</title>
<style>
 @page {{ size: A4; margin: 14mm; }}
 body {{ font-family: "Hiragino Sans","Hiragino Kaku Gothic ProN",-apple-system,sans-serif; color:#1a1a1a; max-width:820px; margin:0 auto; padding:24px; line-height:1.7; font-size:15px; }}
 h1 {{ font-size:28px; margin:0 0 4px; }}
 .lead {{ color:#555; margin:0 0 28px; }}
 h2 {{ page-break-after:avoid; font-size:20px; margin:36px 0 10px; padding-bottom:6px; border-bottom:2px solid #e5e5e5; }}
 h2 span {{ display:inline-block; background:#5b5bd6; color:#fff; border-radius:999px; width:28px; height:28px; line-height:28px; text-align:center; font-size:15px; margin-right:8px; }}
 img {{ page-break-inside:avoid; display:block; max-width:100%; height:auto; border:1px solid #ddd; border-radius:8px; margin:10px 0 6px; }}
 ol, .tip, .warn, table {{ page-break-inside:avoid; }}
 ol {{ padding-left:22px; margin:6px 0; }}
 li {{ margin:2px 0; }}
 .n {{ display:inline-block; background:#dc2626; color:#fff; border-radius:999px; width:20px; height:20px; line-height:20px; text-align:center; font-size:12px; font-weight:bold; margin-right:4px; }}
 .tip {{ background:#f5f4ff; border-left:4px solid #5b5bd6; padding:8px 12px; border-radius:6px; margin:10px 0; font-size:14px; }}
 .warn {{ background:#fff4e5; border-left:4px solid #e08a1e; padding:8px 12px; border-radius:6px; margin:10px 0; font-size:14px; }}
 kbd {{ font-family:-apple-system,sans-serif; border:1px solid #bbb; border-bottom-width:2px; border-radius:5px; padding:0 6px; background:#fafafa; font-size:13px; }}
 .menu {{ display:inline-block; background:#f2f2f2; border:1px solid #ccc; border-radius:8px; padding:6px 0; min-width:260px; font-size:14px; box-shadow:0 4px 12px rgba(0,0,0,.12); margin:8px 0; }}
 .menu div {{ padding:3px 16px; }} .menu .sep {{ border-top:1px solid #ccc; margin:4px 0; padding:0; }} .menu .dim {{ color:#888; }}
 .menu .k {{ float:right; color:#888; }}
 .row {{ display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }} .row > div {{ flex:1 1 300px; }}
 table {{ border-collapse:collapse; font-size:14px; }} td,th {{ border:1px solid #ddd; padding:4px 10px; text-align:left; }}
 .pb {{ page-break-before:always; }}
 footer {{ color:#888; font-size:12px; margin-top:40px; border-top:1px solid #e5e5e5; padding-top:8px; }}
</style></head><body>
<h1>Astra 操作ガイド</h1>
<p class="lead">会議を録って、要点をまとめて、頼みごとを片付ける Mac アプリです。</p>

<div class="tip"><b>はじめに、これだけ覚えてください</b><br>
① 画面右上のメニューバーにある <b>波形アイコン</b> が Astra の入口です<br>
② {shortcut("shortcut.recording.toggle", names=True)} を押すと、いつでも <b>{fact("settings.shortcutRow")}</b><br>
③ 何かをしてもらう前には、必ず <b>確認カード</b> が出ます。実行のボタン（例:「{fact("confirmation.confirm.example")}」）を押すまで外には出ません<br>
④ 困ったら {shortcut("shortcut.escape")}。聞いている途中も、確認カードも、結果の表示も、同じ鍵で取り消せます</div>

<h2><span>1</span>起動する・開く</h2>
<div class="row"><div>
<p>Astra は Dock（画面下のアイコン列）には出ません。<b>メニューバー右上の波形アイコン</b>をクリックするとメニューが開きます。</p>
{MENU}
</div><div>
<p><b>「{fact("menu.open")}」</b>で {fact("nav.home")} が出ます。左の一覧（{fact("nav.home")} / {fact("nav.tasks")} / {fact("nav.meetings")} / {fact("nav.library")} …）で画面を切り替えます。</p>
<p>許可は、その機能を<b>初めて使うとき</b>に、要るものだけ聞かれます——初めて会議を録るとき{fact("permission.microphone")}と（相手の声のために）{fact("permission.screenRecording")}、{shortcut("shortcut.recording.toggle")} を使えるようにするとき{fact("permission.inputMonitoring")}、というように。先にまとめて設定する必要はありません。<b>{fact("menu.settings")}</b> の「{fact("settings.permissionsSection")}」に 5 つ（{fact("permission.microphone")}・{fact("permission.screenRecording")}・{fact("permission.accessibility")}・{fact("permission.calendar")}・{fact("permission.inputMonitoring")}）の一覧があり、いま許可されているかの確認と、あとからの許可はそこでできます。{fact("permission.microphone")}を許可しないと録音は始まりません（→ 6）。{fact("permission.inputMonitoring")}が無いと {shortcut("shortcut.recording.toggle")} が効かず、黒いバーには「{fact("hud.clickHint")}」と出ます。</p>
</div></div>

<h2><span>2</span>会議を記録する</h2>
{img('home')}
<ol>
<li><span class="n">1</span><b>{fact("recording.start")}</b> を押す（または {shortcut("shortcut.recording.toggle")}、メニューの「{fact("recording.menu.start")}」）</li>
<li>録音中は画面上部に小さな黒いバーが出ます。ここで止めたり、メモを見たりします</li>
</ol>
{img('bar')}
<ol>
<li><span class="n">1</span>赤い ■ を押すと止まります（{shortcut("shortcut.recording.toggle")} でも、メニューの「{fact("recording.menu.stop")}」でも）</li>
<li><span class="n">2</span><b>{fact("meeting.notes")}</b> を押すと、話している間に{fact("notes.decisions")}・{fact("notes.concerns")}・{fact("notes.actions")}・{fact("notes.questions")}が自動で並びます。面の高さは中身の量で決まります</li>
</ol>
{img('notes', 620)}
<p>{fact("nav.home")} に戻ると「{fact("recording.hero.recording")}」のカードが出ています。ここの <b>{fact("recording.stop")}</b> でも止められ、<b>{fact("meeting.notes.open")}</b> で上のメモが開きます。</p>
{img('recnow')}

<h2 class="pb"><span>3</span>録音中に文字起こしを見る・質問する</h2>
<p>メモの右上 <b>{fact("meeting.detach")} ↗</b> を押すと、大きな作業画面が開きます。</p>
{img('ws')}
<ol>
<li><span class="n">1</span>右側に <b>いつ・誰が・何を</b> 言ったかが流れます（翻訳・字幕にも切替可）</li>
<li><span class="n">2</span>下の欄に「さっき決まった納期は？」のように書くと、この会議の内容から答えます</li>
<li><span class="n">3</span>入力欄の右の <b>{fact("notes.summary")} / {fact("notes.decisions")} / {fact("notes.actions")}</b> を押すと、書かなくてもその答えが出ます</li>
</ol>

<h2 class="pb"><span>4</span>終わった会議を見返す</h2>
<p>左の <b>{fact("nav.library")}</b> → 会議を選ぶと、{fact("notes.summary")}・{fact("notes.decisions")}・{fact("notes.actions")}が出ます。語は録音中のメモと同じです。</p>
{img('detail')}
<ol>
<li><span class="n">1</span>文末の <b>[1] [2]</b> を押すと…</li>
<li><span class="n">2</span>右側に <b>{fact("source.label")}</b>（その発言の時刻・話者・音声）が出ます。<b>AI の要約が正しいか、元の発言でその場で確かめられます</b></li>
<li><span class="n">3</span>左上の <b>‹</b> で一覧へ戻ります</li>
</ol>

<h2 class="pb"><span>5</span>頼みごとをする</h2>
{img('ask')}
<ol>
<li><span class="n">1</span>{fact("nav.home")} の「<b>{fact("home.intent.placeholder")}</b>」に、やってほしいことを書く（右端の{fact("permission.microphone")}で声でも可）</li>
</ol>
{img('listen', 600)}
<p>声で頼むときは「{fact("listening.placeholder")}」が出ている間に話します。取り消すなら右端の {shortcut("shortcut.escape")}。</p>
{img('agent', 620)}
<ol>
<li>進み具合が一覧で見えます。✓ が終わったもの、● がいま作業中のもの</li>
<li><span class="n">1</span>途中で止めたいときは <b>{fact("task.stop")}</b></li>
<li><span class="n">2</span>詳しく見たいときは <b>{fact("task.openWorkspace")}</b></li>
</ol>
<div class="warn"><b>外に出るものは必ず確認されます。</b> メッセージ送信・メール・予定の登録など、あなた以外に届くものは、内容を見せてから実行のボタンが押されるのを待ちます。ボタンの字は、押すと何が起こるかそのまま（例:「{fact("confirmation.confirm.example")}」）。</div>
{img('confirm', 560)}
<ol>
<li><span class="n">1</span>内容が良ければ実行のボタン（絵では <b>{fact("confirmation.confirm.example")}</b>）。「{fact("source.label")}」に、どの会議の発言から作ったかが書いてあります</li>
<li><span class="n">2</span>取り消すなら <b>{fact("confirmation.cancel")}</b>（{shortcut("shortcut.escape")}）、文面を変えるなら <b>{fact("confirmation.edit")}</b>。実行は {shortcut("shortcut.confirmation.proceed")} でもできます。<kbd>↩</kbd> だけでは実行しません（押し慣れた鍵で外に出ないように）</li>
</ol>
{img('result', 520)}
<p>終わると「N 件のソースから作成しました」と出ます。<b>{fact("result.open")}</b> で結果を見る、<b>{fact("result.copy")}</b> で貼り付け用に取り出せます。閉じるのは {shortcut("shortcut.escape")} か ×。</p>

<h2><span>6</span>困ったとき</h2>
<table>
<tr><th>こうなった</th><th>こうする</th></tr>
<tr><td>「{fact("recording.cannotStart")}」と出る</td><td>{fact("permission.microphone")}の許可がありません。<b>{fact("result.openSettings")}</b> → {fact("permission.microphone")}を「{fact("permission.request")}」。許可すると、そのまま録れます<br>{img('denied', 420)}</td></tr>
<tr><td>録音しているのに文字が出ない<br>「{fact("recording.hero.recording")}{fact("recording.hero.silentSuffix")}」と出る</td><td>録音の途中で{fact("permission.microphone")}が使えなくなっています。右上の <b>{fact("result.openSettings")}</b> → {fact("permission.microphone")}を「{fact("permission.request")}」<br>{img('nomic', 480)}</td></tr>
<tr><td>{shortcut("shortcut.recording.toggle")} を押しても何も起きない<br>黒いバーに「{fact("hud.clickHint")}」と出ている</td><td>Astra の <b>{fact("menu.settings")} → {fact("permission.inputMonitoring")}（{fact("shortcut.recording.toggle")}）</b> の「{fact("permission.request")}」を押す。Mac の設定が開いたら Astra をオンにし、Astra を一度終了してから、また開く</td></tr>
<tr><td>{fact("nav.home")} に「録りかけが N 件あります」と出る</td><td>前回、保存前に終わった録音です。<b>{fact("recovery.resume")}</b> で読み取り、いらなければ <b>{fact("recovery.discard")}</b></td></tr>
<tr><td>会議のカードに「{fact("session.interrupted")}」と出る</td><td>録音の途中で Astra が止まった会議です。カードを押すと開き、<b>確定した行までは</b>文字起こしが残っています</td></tr>
<tr><td>画面共有中に Astra を見せたくない</td><td>黒いバーの <b>👁 目のアイコン</b> を押すと、共有画面や録画に Astra が映らなくなります（もう一度押すと戻る）</td></tr>
<tr><td>Astra が見当たらない</td><td>メニューバー右上の波形アイコン → 「{fact("menu.open")}」</td></tr>
<tr><td>新しい版があるか知りたい</td><td>メニューバーの波形アイコン → 「{fact("menu.checkUpdates")}」。新しい版があれば知らせが出て、入れるかどうかはあなたが決めます。起動時にも一度だけ静かに確かめています</td></tr>
</table>

<footer>Astra 操作ガイド（0.1.1 / 2026-09-03）· 画面は開発版の撮影です。文字や配置は今後変わることがあります。<br>
録音した音声・文字起こし・鍵はこの Mac の中だけで扱われ、あなたが確認して実行したものだけが外に出ます。</footer>
</body></html>'''
os.makedirs(OUT, exist_ok=True)
open(OUT+'/Astra-操作ガイド.html','w').write(html)
print('written', len(html)//1024, 'KB', '/ facts used', len(USED_FACTS))

