"""Build the current Genie quick guide from native UI facts and fresh captures."""
import html
from pathlib import Path
import subprocess

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output/pdf/Genie-guide-ja.pdf'
SHOTS = ROOT / 'docs/golden-screenshots/genie-rename'
BIN = ROOT / 'apps/genie-macos/.build/debug/GenieMac'
raw = subprocess.check_output([str(BIN), '--selftest', 'facts'], text=True)
assert 'SELFTEST_OK facts' in raw
facts = {parts[1]: parts[2] for line in raw.splitlines()
         if len(parts := line.split('\t')) >= 3 and parts[0] == 'FACT'}

def fact(key):
    return html.escape(facts[key])

pdfmetrics.registerFont(TTFont('GuideSans', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
INK = colors.HexColor('#202332')
MUTED = colors.HexColor('#647087')
PURPLE = colors.HexColor('#6555D9')
styles = {
    'title': ParagraphStyle('title', fontName='GuideSans', fontSize=26, leading=36, textColor=INK, spaceAfter=14),
    'heading': ParagraphStyle('heading', fontName='GuideSans', fontSize=15, leading=22, textColor=INK, spaceBefore=15, spaceAfter=7),
    'body': ParagraphStyle('body', fontName='GuideSans', fontSize=10, leading=17, textColor=INK, spaceAfter=9, wordWrap='CJK', alignment=TA_LEFT),
    'small': ParagraphStyle('small', fontName='GuideSans', fontSize=8, leading=13, textColor=MUTED, spaceAfter=8, wordWrap='CJK'),
}
story = []
def p(text, kind='body'):
    story.append(Paragraph(text, styles[kind]))

def shot(name, max_height=265):
    image = Image(str(SHOTS / name))
    factor = min(475 / image.imageWidth, max_height / image.imageHeight)
    image.drawWidth = image.imageWidth * factor
    image.drawHeight = image.imageHeight * factor
    image.hAlign = 'LEFT'
    story.extend([image, Spacer(1, 12)])

p('Genie 操作ガイド', 'title')
p('Mac developer preview 0.1.3 · 2026-09-13', 'small')
p('目的を伝えて、AIと仕事を進める。', 'heading')
p('メモを実行計画に、Webの言葉を改善案に。Genieは、依頼と成果物を残して仕事を進めるMacアプリです。')
shot('06-main-home.png')
p('まず、ひとつの仕事を依頼する', 'heading')
p('1. Homeの入力欄に、作りたいもの・相手・条件を書きます。<br/>例：この会議メモから、担当者と期限のあるチェックリストを作って。')
p('2. ' + fact('home.intent.submitHint') + '。接続したAIで処理します。<br/>3. Workから結果を開き、内容を確認してコピーやMarkdownとして保存します。')
p('この版は開発者向けプレビューです。アプリ単体では動作せず、ローカルのバックエンドとAIモデルのセットアップが必要です。', 'small')

story.append(PageBreak())
p('サービスとモデルをつなぐ', 'title')
shot('07-apps.png', 235)
p('いつものサービスを、Appsから', 'heading')
p('Google WorkspaceやMicrosoft 365など、使いたいサービスの接続を選び、提供元の画面でアカウントと権限を確認します。利用できる接続は設定状況によって変わります。')
p('メールや予定へのアクセスと、送信などの操作はそれぞれ確認します。接続後も、依頼の内容や送信先を確認してから実行してください。')
p('使うAIを選ぶ', 'heading')
p('Ollamaのローカルモデル、対応API、Codex、Claude Codeを利用できます。処理速度・品質・利用料金は接続したモデルで変わります。画像について質問する場合は画像対応モデルが必要です。')
p('写真やスクリーンショットを添える', 'heading')
p('スクリーンショットの検知後に質問する操作を選び、聞きたいことを入力します。撮影しただけでは質問を送信しません。送信前に添付画像と送信先の表示を確認できます。')
p('設定手順：<link href="https://github.com/FORIFOR/genie/blob/v0.1.3/docs/LOCAL_PREVIEW.md" color="#6555D9">github.com/FORIFOR/genie · LOCAL_PREVIEW</link>', 'small')

story.append(PageBreak())
p('会議を録音する', 'title')
shot('04-recording-transcript.png', 245)
p('開始と停止', 'heading')
p('上部の「' + fact('dock.record') + '」、Homeの録音ボタン、またはメニューバーの会議録音を使います。参加者へ録音することを伝えてから開始してください。')
p('会議バーの「' + fact('recording.pause') + '」で一時停止、「' + fact('recording.resume') + '」で再開できます。終了後はLibraryから会議を開き直せます。')
p('文字起こし・翻訳', 'heading')
p('ライブ字幕には音声入力と認識サービスの設定が必要です。クラウドのライブ文字起こしを許可した場合は、録音中の音声をGoogleへ送信します。通信状態によって字幕が遅れる場合があります。')
p('翻訳では「' + fact('translation.target') + '」を選びます。「' + fact('translation.auto') + '」を有効にすると新しい確定行を翻訳します。翻訳元と翻訳先を確認してください。')
p('会議の要約や質問への回答には、接続済みのAIとバックエンドが必要です。実サービスの利用条件と料金は各提供元の設定に従います。', 'small')

story.append(PageBreak())
p('困ったときの入口', 'title')
p('権限の設定', 'heading')
p('メニューバーのGenieアイコン →「' + fact('menu.guidedSetup') + '」を選ぶと、必要な設定を案内します。機能ごとに、用途を確認して許可できます。')
p('既に許可した設定を改名のために削除する必要はありません。macOSの設定に旧名のAstraが残っている場合も、既存の許可を引き継ぐための表示です。')
p('上部のバーが邪魔なとき', 'heading')
p('Escでバーを小さくできます。常駐パネルが邪魔なときは、メニューバーのGenieアイコンから「' + fact('menu.hideControls') + '」を選ぶと画面だけ隠れます。もう一度表示するには、同じ場所から「' + fact('menu.showControls') + '」を選びます。' + fact('dock.record') + '中や実行中の仕事は続きます。')
p('回答が返ってこない', 'heading')
p('ローカルのgateway・task worker・agent host・AIモデルが起動しているか確認してください。クラウドの利用上限に達している場合は、接続先モデルの設定を確認します。')
p('保存した仕事が見つからない', 'heading')
p('Workで依頼、Libraryで会議を開きます。改名前から使っている設定・アカウント・保存データの識別子を維持しています。データフォルダを消さずに不具合を報告してください。')
p('サポートとフィードバック', 'heading')
p('<link href="https://github.com/FORIFOR/genie/issues" color="#6555D9">github.com/FORIFOR/genie/issues</link><br/>再現手順とアプリのバージョンを添えてください。パスワード・APIキー・認証トークン・個人情報は公開Issueに貼らないでください。')
p('画面はGenieの開発版から、架空データを用いて撮影しています。機能や配置は今後変更される場合があります。', 'small')

def footer(canvas, doc):
    canvas.setStrokeColor(colors.HexColor('#E5E7ED'))
    canvas.line(48, 44, A4[0] - 48, 44)
    canvas.setFont('GuideSans', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(48, 29, 'GENIE  /  MAC PREVIEW 0.1.3')
    canvas.drawRightString(A4[0] - 48, 29, str(doc.page))

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
SimpleDocTemplate(str(OUTPUT), pagesize=A4, leftMargin=48, rightMargin=48,
                  topMargin=45, bottomMargin=60, title='Genie 操作ガイド', author='Genie').build(
    story, onFirstPage=footer, onLaterPages=footer)
print(OUTPUT)
