using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace Astra;

/// 1 枚の Recording Workspace（macOS NSPanel + Custom Shape と同じ寸法・同じ凹み Bezier）。
public sealed partial class RecordingWorkspaceWindow : Window
{
    private RecordingSession? _session;
    private WasapiCapture? _mic;

    public RecordingWorkspaceWindow()
    {
        this.InitializeComponent();
        if (AppWindow.Presenter is OverlappedPresenter p)
        {
            p.IsAlwaysOnTop = true;
            p.IsResizable = false;
            p.SetBorderAndTitleBar(false, false);
        }
        AppWindow.Resize(new SizeInt32((int)Metrics.WorkspaceWidth, (int)Metrics.WorkspaceHeight));
        var area = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary).WorkArea;
        AppWindow.Move(new PointInt32(
            area.X + (area.Width - (int)Metrics.WorkspaceWidth) / 2,
            area.Y + (area.Height - (int)Metrics.WorkspaceHeight) / 2));
        // 凹みの外枠は共通ジオメトリ（macOS と同じ制御点）
        ShapePath.Data = RecordingWorkspaceGeometry.Build(Metrics.WorkspaceWidth, Metrics.WorkspaceHeight);
        TaskDock.Width = Metrics.DockWidth;
        TaskDock.Height = Metrics.DockHeight;
    }

    /// 録音開始: core の session を作り、WASAPI マイクから 16kHz へ落として Push する。
    /// （実取り込みは Windows のみ。macOS の RecordingRuntime.begin と同じ流れ。）
    public void Begin(string root, string meetingId)
    {
        _session = RecordingSession.Start(root, meetingId);
        try
        {
            _mic = new WasapiCapture(loopback: false);
            _mic.Start(frame =>
            {
                // WASAPI の mix format(通常 44.1/48kHz float) をそのまま core に渡し、core 側で 16kHz にリサンプルする。
                _session?.Push(frame, 48000);
                DispatchQueue(() => Elapsed.Text = AstraCore.FormatElapsed(_session?.RecordedMs ?? 0));
            });
        }
        catch { /* マイクが開けなくても session は成り立つ（外から Push も可） */ }
    }

    // UI スレッドへ戻す（DispatcherQueue の薄いラッパ）。
    private void DispatchQueue(Action a) => DispatcherQueue.TryEnqueue(() => a());

    public void PushSamples(float[] samples, uint rate)
    {
        var closed = _session?.Push(samples, rate) ?? 0;
        _ = closed;
        Elapsed.Text = AstraCore.FormatElapsed(_session?.RecordedMs ?? 0);
    }

    public void End()
    {
        _mic?.Stop(); _mic?.Dispose(); _mic = null;
        _session?.Finish(); _session?.Dispose(); _session = null;
    }
}
