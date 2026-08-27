using Microsoft.UI.Xaml;

namespace Astra;

/// Windows の Main Window（NavigationView + Mica）。macOS の NavigationSplitView と同じ 4 セクション。
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        this.InitializeComponent();
        ExtendsContentIntoTitleBar = true;
    }
}
