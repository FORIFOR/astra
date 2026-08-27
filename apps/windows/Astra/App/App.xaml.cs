using Microsoft.UI.Xaml;

namespace Astra;

public partial class App : Application
{
    public App() => this.InitializeComponent();

    private Window? _hud;
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        // 通常時は上部 Voice HUD。録音時に Recording Workspace へ切り替える（macOS と同じ遷移）。
        _hud = new VoiceHudWindow();
        _hud.Activate();
    }
}
