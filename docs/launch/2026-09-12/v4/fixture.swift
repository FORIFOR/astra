import AppKit
let w:CGFloat=1440,h:CGFloat=900
let im=NSImage(size:.init(width:w,height:h)); im.lockFocus()
let ink=NSColor(srgbRed:0.12,green:0.13,blue:0.18,alpha:1),muted=NSColor(srgbRed:0.48,green:0.50,blue:0.56,alpha:1),purple=NSColor(srgbRed:0.40,green:0.32,blue:0.90,alpha:1)
func rect(_ x:CGFloat,_ y:CGFloat,_ ww:CGFloat,_ hh:CGFloat,_ c:NSColor,_ r:CGFloat=0){c.setFill();NSBezierPath(roundedRect:.init(x:x,y:h-y-hh,width:ww,height:hh),xRadius:r,yRadius:r).fill()}
func text(_ s:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ c:NSColor?=nil,_ wt:NSFont.Weight = .regular){(s as NSString).draw(at:.init(x:x,y:h-y-size*1.22),withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:wt),.foregroundColor:c ?? ink])}
rect(0,0,w,h,NSColor(srgbRed:0.97,green:0.973,blue:0.983,alpha:1))
rect(0,0,220,h,.white);rect(219,0,1,h,NSColor(white:0.9,alpha:1))
text("◒  PULSE",32,30,25,ink,.bold)
rect(20,106,180,44,NSColor(srgbRed:0.94,green:0.93,blue:1,alpha:1),10)
text("Overview",40,116,18,purple,.semibold);text("Acquisition",40,175,18,muted);text("Activation",40,230,18,muted);text("Reports",40,285,18,muted)
text("SAMPLE WORKSPACE",30,813,11,muted,.medium)
text("Launch overview",272,49,39,ink,.semibold);text("Demo data · Sep 1–7, 2026",273,107,18,muted)
let xs:[CGFloat]=[272,632,992]
for (j,x) in xs.enumerated(){rect(x,173,326,165,.white,16);text(["Visitors","Sign-ups","Activated users"][j],x+26,198,18,muted);text(["12,480","1,872","374"][j],x+26,232,48,ink,.semibold);text(["+24% this week","15.0% of visitors","20.0% of sign-ups"][j],x+26,302,16,j==2 ? purple:muted,.medium)}
rect(272,376,1046,328,.white,16);text("From visit to first value",301,401,24,ink,.semibold)
let labs=["Visit","Sign up","First action"],vals=["12,480","1,872","374"],widths:[CGFloat]=[688,340,150]
for j in 0..<3 {let y:CGFloat=462+CGFloat(j)*69;text(labs[j],302,y+10,18);rect(463,y,widths[j],39,j==2 ? purple : NSColor(srgbRed:0.82-Double(j)*0.13,green:0.80-Double(j)*0.13,blue:0.98,alpha:1),7);text(vals[j],1173,y+9,20,ink,.medium)}
rect(272,736,1046,83,NSColor(srgbRed:0.92,green:0.90,blue:0.985,alpha:1),13);text("Activation is the next question.",301,756,23,purple,.semibold);text("Which step should we improve first?",301,788,16,muted)
im.unlockFocus();let rep=NSBitmapImageRep(data:im.tiffRepresentation!)!;try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"/tmp/astra-launch-v4/launch-overview.png"))
