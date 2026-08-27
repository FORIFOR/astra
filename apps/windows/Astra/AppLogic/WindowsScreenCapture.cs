using System.Runtime.InteropServices;

namespace Astra;

/// 画面文脈の取り込み（Windows）。macOS の ScreenContextCapture（CGDisplayCreateImage）に対応。
/// GDI BitBlt でプライマリ画面を 1 枚取り、BGRA バイト列にして返す（Context Lens / RAG 用）。
/// アプリ本体は Windows.Graphics.Capture（WinRT, 現代的）を使ってもよいが、GDI はどのホストでも
/// **コンパイルできる**ので共通ロジックとして compile 検証できる（実取り込みは Windows）。
///
/// **注意**: 実行は Windows のみ（gdi32/user32）。P/Invoke 宣言は macOS/CI でコンパイル・型検査できる。
public static class WindowsScreenCapture
{
    private const int SM_CXSCREEN = 0, SM_CYSCREEN = 1;
    private const int SRCCOPY = 0x00CC0020;
    private const uint DIB_RGB_COLORS = 0;
    private const uint BI_RGB = 0;

    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int w, int h);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);
    [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr hDC, IntPtr hBitmap, uint start, uint lines, byte[] bits, ref BITMAPINFO info, uint usage);

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER { public uint biSize; public int biWidth; public int biHeight; public short biPlanes; public short biBitCount; public uint biCompression; public uint biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter; public uint biClrUsed; public uint biClrImportant; }
    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFO { public BITMAPINFOHEADER bmiHeader; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)] public uint[] bmiColors; }

    /// プライマリ画面のフレーム（BGRA, 上下反転なし）。取れなければ (0,0,null)。
    public static (int width, int height, byte[]? bgra) Capture()
    {
        int w = GetSystemMetrics(SM_CXSCREEN), h = GetSystemMetrics(SM_CYSCREEN);
        if (w <= 0 || h <= 0) return (0, 0, null);
        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr mem = CreateCompatibleDC(screen);
        IntPtr bmp = CreateCompatibleBitmap(screen, w, h);
        IntPtr old = SelectObject(mem, bmp);
        try
        {
            if (!BitBlt(mem, 0, 0, w, h, screen, 0, 0, SRCCOPY)) return (0, 0, null);
            var info = new BITMAPINFO { bmiColors = new uint[256] };
            info.bmiHeader.biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>();
            info.bmiHeader.biWidth = w;
            info.bmiHeader.biHeight = -h;                 // top-down
            info.bmiHeader.biPlanes = 1;
            info.bmiHeader.biBitCount = 32;               // BGRA
            info.bmiHeader.biCompression = BI_RGB;
            var bits = new byte[w * h * 4];
            if (GetDIBits(mem, bmp, 0, (uint)h, bits, ref info, DIB_RGB_COLORS) == 0) return (0, 0, null);
            return (w, h, bits);
        }
        finally { SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(IntPtr.Zero, screen); }
    }
}
