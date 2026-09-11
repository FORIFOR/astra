import AppKit
import AVFoundation
import CoreImage
import ImageIO

let root=URL(fileURLWithPath:CommandLine.arguments[1]); let portrait=CommandLine.arguments.count>2 && CommandLine.arguments[2]=="social"
let W=portrait ? 1080:1920,H=portrait ? 1920:1080,fps:Int32=60; let duration=42.0
let ink=NSColor(srgbRed:0.095,green:0.105,blue:0.15,alpha:1), muted=NSColor(srgbRed:0.46,green:0.48,blue:0.54,alpha:1), accent=NSColor(srgbRed:0.40,green:0.31,blue:0.96,alpha:1)
func clamp(_ x:Double)->Double{max(0,min(1,x))};func ease(_ x:Double)->Double{let x=clamp(x);return x*x*x*(x*(x*6-15)+10)}
func mix(_ a:Double,_ b:Double,_ t:Double)->Double{a+(b-a)*t}
func R(_ x:Double,_ y:Double,_ w:Double,_ h:Double)->CGRect{CGRect(x:x,y:y,width:w,height:h)}
func lerp(_ a:CGRect,_ b:CGRect,_ t:Double)->CGRect{R(mix(a.minX,b.minX,t),mix(a.minY,b.minY,t),mix(a.width,b.width,t),mix(a.height,b.height,t))}
func load(_ name:String)->CGImage{let image=NSImage(contentsOf:root.appendingPathComponent(name))!;return image.cgImage(forProposedRect:nil,context:nil,hints:nil)!}
let home=load("home.png"), source=load("launch-overview.png"), offer=load("offer.png"), icon=load("astra-icon.png"), saveDialog=load("save-dialog.png"), saved=load("saved-native.png")
class Frames {
 let reader:AVAssetReader; let output:AVAssetReaderTrackOutput;let ci=CIContext(options:[.cacheIntermediates:false]);var last:CMSampleBuffer?;var lastTime = -1.0;var image:CGImage?
 init(_ url:URL){let asset=AVURLAsset(url:url);let track=asset.tracks(withMediaType:.video)[0];reader=try! AVAssetReader(asset:asset);output=AVAssetReaderTrackOutput(track:track,outputSettings:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA]);output.alwaysCopiesSampleData=false;reader.add(output);reader.startReading()}
 func frame(_ sec:Double)->CGImage?{var changed=false;while lastTime<sec {guard let b=output.copyNextSampleBuffer() else{break};last=b;lastTime=CMSampleBufferGetPresentationTimeStamp(b).seconds;changed=true};if changed,let b=last,let p=CMSampleBufferGetImageBuffer(b){let c=CIImage(cvPixelBuffer:p);image=ci.createCGImage(c,from:c.extent)};return image}
}
let frames=Frames(root.appendingPathComponent("workflow-cfr.mp4"))
let out=root.appendingPathComponent(portrait ? "film-social-silent.mp4":"film-web-silent.mp4");try? FileManager.default.removeItem(at:out)
let writer=try AVAssetWriter(outputURL:out,fileType:.mp4)
let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:W,AVVideoHeightKey:H,AVVideoCompressionPropertiesKey:[AVVideoAverageBitRateKey:18_000_000,AVVideoExpectedSourceFrameRateKey:60,AVVideoMaxKeyFrameIntervalKey:120,AVVideoProfileLevelKey:AVVideoProfileLevelH264HighAutoLevel],AVVideoColorPropertiesKey:[AVVideoColorPrimariesKey:AVVideoColorPrimaries_ITU_R_709_2,AVVideoTransferFunctionKey:AVVideoTransferFunction_ITU_R_709_2,AVVideoYCbCrMatrixKey:AVVideoYCbCrMatrix_ITU_R_709_2]])
let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:W,kCVPixelBufferHeightKey as String:H,kCVPixelBufferCGImageCompatibilityKey as String:true,kCVPixelBufferCGBitmapContextCompatibilityKey as String:true]);writer.add(input);writer.startWriting();writer.startSession(atSourceTime:.zero)
let colorSpace=CGColorSpace(name:CGColorSpace.sRGB)!
var cg:CGContext!
func box(_ rect:CGRect,_ color:NSColor,_ radius:Double=0){color.setFill();NSBezierPath(roundedRect:R(rect.minX,Double(H)-rect.maxY,rect.width,rect.height),xRadius:radius,yRadius:radius).fill()}
func text(_ s:String,_ x:Double,_ y:Double,_ size:Double,_ color:NSColor=ink,_ weight:NSFont.Weight = .semibold,_ alpha:Double=1){let font=NSFont.systemFont(ofSize:size,weight:weight);(s as NSString).draw(at:NSPoint(x:x,y:Double(H)-y-size*1.20),withAttributes:[.font:font,.foregroundColor:color.withAlphaComponent(alpha)])}
func centred(_ s:String,_ y:Double,_ size:Double,_ color:NSColor=ink,_ alpha:Double=1){let width=(s as NSString).size(withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:.semibold)]).width;text(s,(Double(W)-width)/2,y,size,color,.semibold,alpha)}
func card(_ image:CGImage,_ crop:CGRect?=nil,_ dest:CGRect,_ radius:Double=24,_ angle:Double=0,_ alpha:Double=1){let src=crop.flatMap{image.cropping(to:$0)} ?? image;cg.saveGState();cg.setAlpha(alpha);cg.translateBy(x:dest.midX,y:Double(H)-dest.midY);cg.rotate(by:angle*Double.pi/180);let rr=R(-dest.width/2,-dest.height/2,dest.width,dest.height);let path=CGPath(roundedRect:rr,cornerWidth:radius,cornerHeight:radius,transform:nil);cg.setShadow(offset:CGSize(width:0,height:-20),blur:60,color:NSColor(srgbRed:0.18,green:0.17,blue:0.31,alpha:0.18).cgColor);cg.addPath(path);cg.setFillColor(NSColor.white.cgColor);cg.fillPath();cg.setShadow(offset:.zero,blur:0,color:nil);cg.addPath(path);cg.clip();cg.interpolationQuality = .high;cg.draw(src,in:rr);cg.restoreGState()}
func label(_ s:String,_ t:Double,_ start:Double){let a=ease((t-start)/0.6);text(s,portrait ? 76:100,portrait ? 205:87+22*(1-a),portrait ? 53:44,ink,.semibold,a)}
let sampleFrames:Set<Int>=[120,330,465,720,1020,1230,1440,1740,1900,2100,2340]
let samples=CommandLine.arguments.contains("--samples")
for f in 0..<Int(duration*Double(fps)) {
 if samples && !sampleFrames.contains(f){continue}
 autoreleasepool{
  while !input.isReadyForMoreMediaData{Thread.sleep(forTimeInterval:0.002)}
  var pb:CVPixelBuffer?;CVPixelBufferPoolCreatePixelBuffer(nil,adaptor.pixelBufferPool!,&pb);let pixel=pb!;CVPixelBufferLockBaseAddress(pixel,[])
  cg=CGContext(data:CVPixelBufferGetBaseAddress(pixel),width:W,height:H,bitsPerComponent:8,bytesPerRow:CVPixelBufferGetBytesPerRow(pixel),space:colorSpace,bitmapInfo:CGImageAlphaInfo.noneSkipFirst.rawValue)!
  NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(cgContext:cg,flipped:false)
  let t=Double(f)/Double(fps),ww=Double(W),hh=Double(H)
  box(R(0,0,ww,hh),NSColor(srgbRed:0.955,green:0.961,blue:0.982,alpha:1))
  let gradient=NSGradient(colors:[NSColor(srgbRed:0.86,green:0.86,blue:0.99,alpha:1),NSColor(srgbRed:0.97,green:0.979,blue:0.992,alpha:1),NSColor.white])!
  gradient.draw(in:R(0,0,ww,hh),angle:32+sin(t/8)*8)
  // Small persistent signature. Editorial captions never cover the native UI.
  if t>=4 && t<37{text("ASTRA / FOR MAC",portrait ? 76:100,portrait ? 113:45,portrait ? 24:18,muted,.medium)}
  if t<4 {
    let e=ease(t/1.3)
    if portrait {
      card(home,R(550,140,1170,660),R(76,650+90*(1-e),928,523),28,-2+2*e,e)
      centred("Astra",270,115,ink,e);centred("Macから、次の一手へ。",427,51,ink,e)
    }else{
      card(home,R(350,70,1440,870),R(710,175+90*(1-e),1320,798),26,-3+3*e,e)
      text("Astra",100,289,120,ink,.semibold,e);text("Macから、",104,457,58,ink,.medium,e);text("次の一手へ。",104,532,58,ink,.medium,e)
    }
  } else if t<9 {
    let p=ease((t-4)/0.8),q=ease((t-6.25)/1.4)
    label("気になった瞬間に。",t,4)
    if portrait {
      let a=R(80,478+70*(1-p),920,575),b=R(142,460,796,498)
      card(source,nil,lerp(a,b,q),23,0,1)
      let a2=ease((t-6.5)/0.6);card(offer,nil,R(177,1130+70*(1-a2),726,190),24,0,a2)
      text("スクショを撮ると、質問の入口に。",76,1480,35,muted,.regular,p)
    } else {
      card(source,nil,lerp(R(140,224+60*(1-p),1640,1025),R(255,204,1410,881),q),24,0,1)
      let a2=ease((t-6.5)/0.6);card(offer,nil,R(640,803+60*(1-a2),640,168),20,0,a2)
    }
    if t>6.35 && t<6.49{box(R(0,0,ww,hh),NSColor.white.withAlphaComponent((1-abs(t-6.42)/0.07)*0.6))}
  } else if t<18 {
    let raw:Double=t<15 ? (t-9)*1.33 : 9+(t-15)*5
    let ui=frames.frame(raw)!
    label("そのまま、聞く。",t,9)
    if portrait {
      let crop=lerp(R(550,140,1200,650),R(585,245,1110,440),ease((t-10)/2.2));card(ui,crop,R(65,520,950,950*crop.height/crop.width),24)
      if t<15{text("改善の優先順位を、",76,1250,55,ink,.medium);text("3つ教えて。",76,1330,55,ink,.medium)}
    } else {
      let crop=lerp(R(345,50,1470,850),R(555,132,1170,620),ease((t-10)/2.3));card(ui,crop,R(160,204,1600,1600*crop.height/crop.width),26)
    }
    if t>=15{text("生成待ちを短縮",portrait ? 76:100,portrait ? 1590:996,portrait ? 27:21,muted,.medium)}
  } else if t<28 {
    let ui=frames.frame(25+(t-18)*2.4)!
    label("数字が、次の一手に。",t,18)
    if portrait {
      let p=ease((t-20)/1.5)
      card(ui,R(480,282,1310,478),lerp(R(64,550,952,347),R(100,435,880,321),p),23)
      if t>20 {
        text("実際の回答より",76,835,26,muted,.medium,p)
        text("初回行動への誘導",76,890,53,ink,.semibold,p)
        text("登録1,872人のうち、初回行動は374人。",76,978,33,muted,.regular,p)
        text("到達率20.0%。",76,1050,77,accent,.semibold,p)
        text("登録後のどの操作で離脱するか調べ、",76,1235,35,ink,.regular,p)
        text("案内を改善する。",76,1295,35,ink,.regular,p)
      }
    } else {
      let p=ease((t-20)/2)
      let crop=lerp(R(280,70,1515,900),R(480,282,1310,478),p);card(ui,crop,R(150,208,1620,1620*crop.height/crop.width),25)
      if t>22{text("理由と、次に試すことまで。",150,899,35,muted,.regular,ease((t-22)/0.6))}
    }
  } else if t<33 {
    label("仕事として、持ち帰る。",t,28)
    if t<30.2 {
      card(saveDialog,nil,portrait ? R(105,640,870,513):R(494,276,932,549),25,0,1)
    }else{
      let crop=R(665,1010,1140,110)
      card(saved,crop,portrait ? R(70,790,940,91):R(200,436,1520,147),20)
      if portrait {text("ファイルに保存して、",76,1170,49,ink,.medium);text("次の仕事へ。",76,1240,49,ink,.medium)}
    }
  } else if t<37 {
    let ui=frames.frame(90+t-33)!
    label("続きは、いつでも。",t,33)
    let crop=portrait ? R(430,110,880,670):R(20,20,1820,920)
    card(ui,crop,portrait ? R(65,550,950,723):R(180,220,1560,788),24)
  } else {
    let e=ease((t-37)/0.9),ui=frames.frame(94)!
    if portrait {
      card(ui,R(430,110,880,670),R(120,1140+30*e,840,639),24,0,1-e*0.65)
      card(icon,nil,R(426,249+30*(1-e),228,228),45,0,e)
      centred("Astra",540,100,ink,e);centred("見る。聞く。進める。",702,55,ink,e)
      centred("github.com/FORIFOR/astra",885,37,accent,e)
      centred("DEVELOPER PREVIEW",1540,27,muted,e)
      centred("バックエンド・モデル設定が必要です",1600,27,muted,e)
    }else{
      card(ui,R(280,70,1515,900),R(1050+90*e,270,1080,642),24,-3*e,1-e*0.62)
      card(icon,nil,R(105,228+30*(1-e),140,140),30,0,e)
      text("Astra",280,227,109,ink,.semibold,e);text("見る。聞く。進める。",108,441,64,ink,.medium,e)
      text("github.com/FORIFOR/astra",111,578,37,accent,.medium,e)
      text("DEVELOPER PREVIEW",110,846,22,muted,.medium,e)
      text("バックエンド・モデル設定が必要です",110,901,25,muted,.regular,e)
    }
  }
  if t>=4 && t<37{text("実機収録 · デモデータ",portrait ? 76:100,portrait ? 1714:1030,portrait ? 25:18,muted,.regular)}
  if sampleFrames.contains(f),let image=cg.makeImage(){let file=root.appendingPathComponent("review-\(portrait ? "social":"web")-\(f).png");let dest=CGImageDestinationCreateWithURL(file as CFURL,"public.png" as CFString,1,nil)!;CGImageDestinationAddImage(dest,image,nil);CGImageDestinationFinalize(dest)}
  NSGraphicsContext.restoreGraphicsState();CVPixelBufferUnlockBaseAddress(pixel,[])
  guard adaptor.append(pixel,withPresentationTime:CMTime(value:Int64(f),timescale:fps)) else{fatalError("append failed \(String(describing:writer.error))")}
 }
 if f%600==0{print("\(portrait ? "social":"web") \(f)/2520");fflush(stdout)}
}
input.markAsFinished();let sem=DispatchSemaphore(value:0);writer.finishWriting{sem.signal()};sem.wait();guard writer.status == .completed else{fatalError("write failed \(String(describing:writer.error))")};print(out.path)
