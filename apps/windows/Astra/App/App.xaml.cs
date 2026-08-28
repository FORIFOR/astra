using System;
using Microsoft.UI.Xaml;

namespace Astra;

public partial class App : Application
{
    public App() => this.InitializeComponent();

    private Window? _root;
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // CI の実行時スモーク用: --smoke-workspace で録音画面を、--smoke-main で Main を直接出す。
        // 通常時は上部 Voice HUD（録音開始で Recording Workspace へ切り替える。macOS と同じ遷移）。
        var argv = Environment.GetCommandLineArgs();
        if (Array.IndexOf(argv, "--smoke-workspace") >= 0)
        {
            _root = new RecordingWorkspaceWindow();
        }
        else if (Array.IndexOf(argv, "--smoke-main") >= 0)
        {
            _root = new MainWindow();
        }
        else
        {
            _root = new VoiceHudWindow();
        }
        _root.Activate();
    }
}
