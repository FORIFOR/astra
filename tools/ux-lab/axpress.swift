import AppKit
import ApplicationServices

// 座標で指した場所を **意味として押す**。物理クリックが届かない環境でも、
// 「押す」という遷移だけは試せる。
//
// **重要**: 見つけた要素の役割・説明・識別子は決して出力しない。
// 発見は絵でやる約束なので、ここが label を漏らすと発見性の検査が壊れる
// （AXLabel が読めるなら、画面で気付けないボタンも見つかってしまう）。
//
//   axpress <x> <y>        指した場所を押す
//   axpress probe <x> <y>  押さずに、押せるかどうかだけ返す
let a = CommandLine.arguments
let probe = a.count > 1 && a[1] == "probe"
let base = probe ? 2 : 1
guard a.count > base + 1,
      let x = Double(a[base]), let y = Double(a[base + 1]) else {
    print("usage: axpress [probe] <x> <y>"); exit(2)
}

guard AXIsProcessTrusted() else { print("AX_NOT_TRUSTED"); exit(3) }

let sys = AXUIElementCreateSystemWide()
var el: AXUIElement?
let err = AXUIElementCopyElementAtPosition(sys, Float(x), Float(y), &el)
guard err == .success, var e = el else { print("NO_ELEMENT(\(err.rawValue))"); exit(4) }

func actions(_ el: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(el, &names) == .success,
          let list = names as? [String] else { return [] }
    return list
}

// 指した点が label や背景に当たることは普通にある。押せる親まで数階層だけ遡る。
// **遡った先が何かは出さない。** 出せば発見の答えを渡すことになる。
var hops = 0
while !actions(e).contains(kAXPressAction as String), hops < 5 {
    var parent: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, kAXParentAttribute as CFString, &parent) == .success,
          let p = parent, CFGetTypeID(p) == AXUIElementGetTypeID() else { break }
    e = (p as! AXUIElement)
    hops += 1
}

let acts = actions(e)
guard acts.contains(kAXPressAction as String) else {
    print("NO_PRESS_ACTION(hops=\(hops))"); exit(5)
}
if probe { print("PRESSABLE(hops=\(hops))"); exit(0) }

let r = AXUIElementPerformAction(e, kAXPressAction as CFString)
print(r == .success ? "PRESSED(hops=\(hops))" : "PRESS_FAILED(\(r.rawValue))")
exit(r == .success ? 0 : 6)
