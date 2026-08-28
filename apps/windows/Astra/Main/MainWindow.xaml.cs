using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Astra;

/// Windows の Main Window（NavigationView + Mica）。macOS の NavigationSplitView と同じ 4 セクション。
/// データ（Apps/Library）は共通の AstraSession（core→gateway）から取る。macOS の MainData と対。
public sealed partial class MainWindow : Window
{
    private readonly AstraSession _session =
        new(Environment.GetEnvironmentVariable("ASTRA_GATEWAY_URL") ?? "http://127.0.0.1:3000");
    public string[] Apps { get; private set; } = System.Array.Empty<string>();
    public string[] Library { get; private set; } = System.Array.Empty<string>();

    public MainWindow()
    {
        this.InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        // Mica は合成(DWM)対応環境でだけ適用する。未対応(古い Windows / 一部 VM/RDP / CI セッション)では
        // 付けると activation で落ちるため、IsSupported を見てから設定する（未対応なら単色背景で描く）。
        try
        {
            if (Microsoft.UI.Composition.SystemBackdrops.MicaController.IsSupported())
                this.SystemBackdrop = new Microsoft.UI.Xaml.Media.MicaBackdrop();
        }
        catch { /* backdrop は装飾。付けられなくても本体は描く */ }
        Nav.SelectionChanged += OnNavSelectionChanged;
        _ = LoadAsync();
    }

    /// サインインして Apps/Library を取り、録音側にも同じセッションを渡す（macOS の MainData.load 相当）。
    private async Task LoadAsync()
    {
        await Task.Run(() =>
        {
            if (!_session.Reachable()) return;
            _session.SignIn($"win-{Environment.ProcessId}@astra.local", "Astra");
            Apps = _session.Apps();
            Library = _session.Library();
        });
        // ここでフレームの各ページに Apps/Library を渡して描画する（Home/Agents/Library/Apps）。
        NavigateTo("home");
    }

    private void OnNavSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem item && item.Tag is string tag) NavigateTo(tag);
    }

    /// タグに応じて中身を切り替える（Page クラスは UI 実装で追加）。
    private void NavigateTo(string tag)
    {
        // Frame へ Page を出す実装は WinUI 側（Windows 実機/CI）。ここではデータの受け渡し点を固定する。
        _ = tag;
    }

    public string AccessToken => _session.AccessToken;
}
