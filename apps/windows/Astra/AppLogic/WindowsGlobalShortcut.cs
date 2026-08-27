using System.Runtime.InteropServices;

namespace Astra;

/// グローバル音声ショートカット（Windows）。macOS の GlobalShortcut（Carbon RegisterEventHotKey）に対応。
/// user32 の `RegisterHotKey` でシステム全体に登録し、WM_HOTKEY を受け取る。既定は Alt+Space。
///
/// **注意**: 実行は Windows のみ（user32.dll）。DllImport 宣言はどのホストでもコンパイルできるので、
/// コード自体は macOS/CI で型検査される（実際の登録・受信は Windows 実機/CI で）。
public sealed class WindowsGlobalShortcut
{
    // 修飾キー（RegisterHotKey の fsModifiers）。
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_CONTROL = 0x0002;
    private const uint MOD_SHIFT = 0x0004;
    private const uint MOD_WIN = 0x0008;
    private const uint MOD_NOREPEAT = 0x4000;
    // VK_SPACE。
    private const uint VK_SPACE = 0x20;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    /// WM_HOTKEY（0x0312）。ウィンドウの WndProc でこのメッセージを拾って handler を呼ぶ。
    public const int WM_HOTKEY = 0x0312;

    private readonly int _id;
    private IntPtr _hwnd;
    public WindowsGlobalShortcut(int id = 1) => _id = id;

    /// Alt+Space を登録する。成功で true。押下は WndProc(WM_HOTKEY, wParam==id) で受ける。
    public bool Register(IntPtr hwnd, uint modifiers = MOD_ALT | MOD_NOREPEAT, uint vk = VK_SPACE)
    {
        _hwnd = hwnd;
        return RegisterHotKey(hwnd, _id, modifiers, vk);
    }

    /// このメッセージが自分のホットキー押下か。
    public bool IsHotKeyMessage(int msg, IntPtr wParam) => msg == WM_HOTKEY && wParam.ToInt32() == _id;

    public void Unregister()
    {
        if (_hwnd != IntPtr.Zero) { UnregisterHotKey(_hwnd, _id); _hwnd = IntPtr.Zero; }
    }

    /// 人が読めるラベル（Settings 表示用）。macOS の GlobalShortcut.label と対。
    public static string Label(uint modifiers = MOD_ALT, uint vk = VK_SPACE)
    {
        string s = "";
        if ((modifiers & MOD_WIN) != 0) s += "Win+";
        if ((modifiers & MOD_CONTROL) != 0) s += "Ctrl+";
        if ((modifiers & MOD_ALT) != 0) s += "Alt+";
        if ((modifiers & MOD_SHIFT) != 0) s += "Shift+";
        return s + (vk == VK_SPACE ? "Space" : $"vk{vk}");
    }
}
