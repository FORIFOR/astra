using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace Astra;

/// 上部中央・borderless・always-on-top の Voice HUD（macOS NSPanel 相当）。
public sealed partial class VoiceHudWindow : Window
{
    public VoiceHudWindow()
    {
        this.InitializeComponent();
        if (AppWindow.Presenter is OverlappedPresenter p)
        {
            p.IsAlwaysOnTop = true;
            p.IsResizable = false;
            p.IsMaximizable = false;
            p.IsMinimizable = false;
            p.SetBorderAndTitleBar(false, false);
        }
        AppWindow.Resize(new SizeInt32((int)Metrics.HudWidth, (int)Metrics.HudHeight));
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        AppWindow.Move(new PointInt32(area.X + (area.Width - (int)Metrics.HudWidth) / 2, area.Y));
    }
}
