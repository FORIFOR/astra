import AppKit
let a=CommandLine.arguments, portrait=a[1]=="social", i=Int(a[2])!, path=a[3]
let w:CGFloat=portrait ? 1080:1920,h:CGFloat=portrait ? 1920:1080
let im=NSImage(size:NSSize(width:w,height:h));im.lockFocus()
NSColor.clear.setFill();NSRect(x:0,y:0,width:w,height:h).fill()
func text(_ s:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ color:NSColor = .white,_ weight:NSFont.Weight = .semibold){(s as NSString).draw(at:NSPoint(x:x,y:h-y-size*1.25),withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:weight),.foregroundColor:color])}
func box(_ x:CGFloat,_ y:CGFloat,_ width:CGFloat,_ height:CGFloat,_ color:NSColor,_ radius:CGFloat=0){color.setFill();NSBezierPath(roundedRect:NSRect(x:x,y:h-y-height,width:width,height:height),xRadius:radius,yRadius:radius).fill()}
let gradient=NSGradient(starting:NSColor.black.withAlphaComponent(0.64),ending:.clear)!
gradient.draw(in:NSRect(x:0,y:h-260,width:w,height:260),angle:270)
NSGradient(starting:.clear,ending:NSColor.black.withAlphaComponent(0.8))!.draw(in:NSRect(x:0,y:0,width:w,height:portrait ? 410:225),angle:270)
let violet=NSColor(srgbRed:0.75,green:0.69,blue:1,alpha:1)
text("astra",portrait ? 65:80,portrait ? 78:43,portrait ? 42:30,.white,.bold)
text("MAC → IDEA → PLAY",portrait ? 620:1540,portrait ? 91:49,portrait ? 22:20,NSColor.white.withAlphaComponent(0.68),.medium)
let caps=["この落書き、動きます。","始まりは、このメモ。","「小さな宇宙にして」","調整も、Astraに。","生成コードを取り出して、","動きを、触って確かめる。","アイデアを、動くものに。","次は、あなたのアイデアで。"]
if !portrait && [1,2,3].contains(i) { box(0,860,w,220,NSColor.black.withAlphaComponent(0.88)) }
let size:CGFloat=portrait ? 60:52
let cap=caps[i], font=NSFont.systemFont(ofSize:size,weight:.semibold)
let cw=(cap as NSString).size(withAttributes:[.font:font]).width
text(cap,(w-cw)/2,portrait ? 1440:896,size)
if i==7 {
 let title="Astra for Mac",font=NSFont.systemFont(ofSize:portrait ? 86:80,weight:.bold)
 let tw=(title as NSString).size(withAttributes:[.font:font]).width
 text(title,(w-tw)/2,portrait ? 660:360,portrait ? 86:80,.white,.bold)
 let link="github.com/FORIFOR/astra"
 let ls:CGFloat=portrait ? 38:35
 let lw=(link as NSString).size(withAttributes:[.font:NSFont.systemFont(ofSize:ls,weight:.semibold)]).width
 text(link,(w-lw)/2,portrait ? 795:477,ls,violet)
 text("DEVELOPER PREVIEW",portrait ? 311:764,portrait ? 890:555,portrait ? 28:25,NSColor.white.withAlphaComponent(0.65),.medium)
}
let notes=["Astraが生成したHTML / 操作できる作品","自作のスケッチを撮影","実機操作 / 完成版はCodexを使用","生成待ち・修正工程を短縮","保存文書からHTML部分を抽出して表示","実際の出力をブラウザーで操作","完成した作品も、公開します。","利用にはバックエンド・モデル設定が必要です"]
let ns:CGFloat=portrait ? 27:24
let nw=(notes[i] as NSString).size(withAttributes:[.font:NSFont.systemFont(ofSize:ns,weight:.medium)]).width
text(notes[i],(w-nw)/2,portrait ? 1550:989,ns,NSColor.white.withAlphaComponent(0.7),.medium)
im.unlockFocus();let rep=NSBitmapImageRep(data:im.tiffRepresentation!)!;try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:path))
