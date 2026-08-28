using System;
using System.Threading;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;

namespace Astra;

/// 明示的なエントリポイント（unpackaged WinUI 3 の Microsoft 推奨パターン）。
/// XAML 生成の Main は環境により出ないことがあるため、DISABLE_XAML_GENERATED_MAIN と対で
/// 自前の STAThread Main を持ち、起動を決定的にする。App.OnLaunched が Voice HUD を出す。
public static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        global::WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start((p) =>
        {
            var context = new DispatcherQueueSynchronizationContext(
                DispatcherQueue.GetForCurrentThread());
            SynchronizationContext.SetSynchronizationContext(context);
            _ = new App();
        });
    }
}
