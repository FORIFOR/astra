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
        try
        {
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
        catch (Exception ex)
        {
            // スモーク診断: 生成/activation で落ちた実例外をファイルへ残す（CI が読む）。
            try
            {
                System.IO.File.WriteAllText(
                    System.IO.Path.Combine(System.IO.Path.GetTempPath(), "astra-crash.log"),
                    ex.ToString()
                );
            }
            catch { }
            throw;
        }
    }
}
