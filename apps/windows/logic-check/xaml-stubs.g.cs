// XAML→C# codegen(XamlCompiler.exe)が本来生成する部分メンバーの手書きスタブ。
// Window の code-behind を macOS/CI で型検査するためだけのもの（実体は Windows のビルドが生成する）。
// x:Name 要素は apps/windows/Astra/*.xaml と一致させること。
using Microsoft.UI.Xaml.Controls;

namespace Astra
{
    public partial class MainWindow { private void InitializeComponent() { }
        internal NavigationView Nav = null!; internal Frame ContentFrame = null!; }
    public partial class RecordingWorkspaceWindow { private void InitializeComponent() { }
        internal Microsoft.UI.Xaml.Shapes.Path ShapePath = null!; internal Border TaskDock = null!;
        internal TextBlock Elapsed = null!; internal TextBlock Hero = null!; }
    public partial class VoiceHudWindow { private void InitializeComponent() { } }
    public partial class App { private void InitializeComponent() { } }
}
