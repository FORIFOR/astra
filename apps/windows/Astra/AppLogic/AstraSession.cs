using System.Text.Json;

namespace Astra;

/// Windows アプリの session/data ロジック（WinUI 非依存の純 C#）。macOS の MainData 相当。
/// core の C# ブリッジ（P/Invoke）経由で実 gateway に繋ぐ。UI(Window/XAML)からはこれを使う。
public sealed class AstraSession
{
    public string AccessToken { get; private set; } = "";
    public string RefreshToken { get; private set; } = "";
    public bool SignedIn => AccessToken.Length > 0;

    private readonly string _base;
    public AstraSession(string baseUrl) => _base = baseUrl;

    public bool Reachable() => AstraCore.ApiReachable(_base);

    /// 開発サインイン。tokens(JSON)から access/refresh を取り出す。**access はメモリ、refresh は Keychain 相当へ。**
    public bool SignIn(string email, string displayName)
    {
        string json = AstraCore.ApiDevSignIn(_base, email, displayName);
        if (string.IsNullOrEmpty(json)) return false;
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        AccessToken = root.TryGetProperty("access_token", out var at) ? at.GetString() ?? "" : "";
        RefreshToken = root.TryGetProperty("refresh_token", out var rt) ? rt.GetString() ?? "" : "";
        string deviceToken = root.TryGetProperty("device_token", out var dt) ? dt.GetString() ?? "" : "";
        // refresh/device token は Credential Manager のみ（Windows）。access token はメモリ。§21。
        if (OperatingSystem.IsWindows() && RefreshToken.Length > 0)
            WindowsSessionStore.Persist(RefreshToken, deviceToken);
        return AccessToken.Length > 0;
    }

    /// Apps カタログ（JSON 配列 → string[]）。
    public string[] Apps()
    {
        string json = AstraCore.ApiPluginCatalog(_base, AccessToken);
        return ParseStringArray(json);
    }

    /// Library 一覧（JSON 配列 → string[]）。
    public string[] Library()
    {
        string json = AstraCore.ApiLibrary(_base, AccessToken);
        return ParseStringArray(json);
    }

    /// Agent タスクを作って完了を待ち、成果物の本文を返す。
    public string RunEchoTask(string message)
    {
        string taskId = AstraCore.ApiCreateTask(_base, AccessToken, "echo", $"{{\"message\":\"{message}\",\"steps\":1}}");
        if (string.IsNullOrEmpty(taskId)) return "";
        string statusJson = AstraCore.ApiWaitTask(_base, AccessToken, taskId, 15000);
        if (string.IsNullOrEmpty(statusJson)) return "";
        using var doc = JsonDocument.Parse(statusJson);
        var root = doc.RootElement;
        string status = root.TryGetProperty("status", out var st) ? st.GetString() ?? "" : "";
        string artifactId = root.TryGetProperty("result_artifact_id", out var aid) ? aid.GetString() ?? "" : "";
        if (status != "COMPLETED" || artifactId.Length == 0) return "";
        return AstraCore.ApiArtifactContent(_base, AccessToken, artifactId);
    }

    private static string[] ParseStringArray(string json)
    {
        if (string.IsNullOrEmpty(json)) return System.Array.Empty<string>();
        try {
            using var doc = JsonDocument.Parse(json);
            var list = new System.Collections.Generic.List<string>();
            foreach (var e in doc.RootElement.EnumerateArray()) list.Add(e.GetString() ?? "");
            return list.ToArray();
        } catch { return System.Array.Empty<string>(); }
    }
}
