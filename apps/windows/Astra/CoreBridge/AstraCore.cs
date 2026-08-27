// astra-core の安定 C ABI を P/Invoke で呼ぶ。macOS の UniFFI と同じ core を Windows から使う。
// astra_core.dll は CI で cargo build 後に配置する。
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Astra;

internal static class AstraCoreNative
{
    private const string Dll = "astra_core";

    [DllImport(Dll)] internal static extern IntPtr astra_core_version();
    [DllImport(Dll)] internal static extern IntPtr astra_core_format_elapsed(ulong ms);
    [DllImport(Dll)] internal static extern void astra_core_string_free(IntPtr p);

    [DllImport(Dll, CharSet = CharSet.Ansi)]
    internal static extern IntPtr astra_core_pkce_challenge(string verifier);
    [DllImport(Dll, CharSet = CharSet.Ansi)]
    internal static extern IntPtr astra_core_authorize_url(string provider, string clientId,
        string redirectUri, string scopesSpaceJoined, string state, string codeChallenge);
    [DllImport(Dll, CharSet = CharSet.Ansi)]
    internal static extern IntPtr astra_core_parse_callback(string target);

    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern int astra_core_api_reachable(string baseUrl);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_dev_sign_in(string baseUrl, string email, string displayName);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_me(string baseUrl, string accessToken);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_create_meeting(string baseUrl, string accessToken, string title, string language);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_create_task(string baseUrl, string accessToken, string kind, string inputJson);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_wait_task(string baseUrl, string accessToken, string taskId, ulong timeoutMs);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_artifact_content(string baseUrl, string accessToken, string artifactId);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_plugin_catalog(string baseUrl, string accessToken);
    [DllImport(Dll, CharSet = CharSet.Ansi)] internal static extern IntPtr astra_core_api_library(string baseUrl, string accessToken);

    [DllImport(Dll, CharSet = CharSet.Ansi)]
    internal static extern IntPtr astra_core_session_start(string root, string meetingId);
    [DllImport(Dll)] internal static extern uint astra_core_session_push(IntPtr s, float[] samples, nuint len, uint sampleRate);
    [DllImport(Dll)] internal static extern ulong astra_core_session_recorded_ms(IntPtr s);
    [DllImport(Dll)] internal static extern int astra_core_session_finish(IntPtr s);
    [DllImport(Dll)] internal static extern void astra_core_session_free(IntPtr s);
}

/// <summary>Swiftの AstraCoreBridge と対になる薄い層。UI から直接 P/Invoke しない。</summary>
public static class AstraCore
{
    private static string Consume(IntPtr p)
    {
        if (p == IntPtr.Zero) return string.Empty;
        var s = Marshal.PtrToStringAnsi(p) ?? string.Empty;
        AstraCoreNative.astra_core_string_free(p);
        return s;
    }

    public static string Version => Consume(AstraCoreNative.astra_core_version());
    public static string FormatElapsed(ulong ms) => Consume(AstraCoreNative.astra_core_format_elapsed(ms));

    // connector 契約層（RFC 6749/7636）。live なトークン交換はここには無い（提供者ごとの外部処理）。
    public static string PkceChallenge(string verifier) =>
        Consume(AstraCoreNative.astra_core_pkce_challenge(verifier));

    /// <summary>authorize URL を組む。非 loopback / 空 client_id / 未知 provider は空文字。</summary>
    public static string AuthorizeUrl(string provider, string clientId, string redirectUri,
        string[] scopes, string state, string codeChallenge) =>
        Consume(AstraCoreNative.astra_core_authorize_url(provider, clientId, redirectUri,
            string.Join(" ", scopes), state, codeChallenge));

    /// <summary>折り返し URL を解析して JSON（code/state/error…）を返す。</summary>
    public static string ParseCallback(string target) =>
        Consume(AstraCoreNative.astra_core_parse_callback(target));

    // gateway API（実バックエンド）。macOS(Swift/UniFFI) と同じ core を Windows から。JSON か生値、失敗は空文字。
    public static bool ApiReachable(string baseUrl) => AstraCoreNative.astra_core_api_reachable(baseUrl) == 1;
    public static string ApiDevSignIn(string baseUrl, string email, string displayName) =>
        Consume(AstraCoreNative.astra_core_api_dev_sign_in(baseUrl, email, displayName));
    public static string ApiMe(string baseUrl, string accessToken) =>
        Consume(AstraCoreNative.astra_core_api_me(baseUrl, accessToken));
    public static string ApiCreateMeeting(string baseUrl, string accessToken, string title, string language) =>
        Consume(AstraCoreNative.astra_core_api_create_meeting(baseUrl, accessToken, title, language));
    public static string ApiCreateTask(string baseUrl, string accessToken, string kind, string inputJson) =>
        Consume(AstraCoreNative.astra_core_api_create_task(baseUrl, accessToken, kind, inputJson));
    public static string ApiWaitTask(string baseUrl, string accessToken, string taskId, ulong timeoutMs) =>
        Consume(AstraCoreNative.astra_core_api_wait_task(baseUrl, accessToken, taskId, timeoutMs));
    public static string ApiArtifactContent(string baseUrl, string accessToken, string artifactId) =>
        Consume(AstraCoreNative.astra_core_api_artifact_content(baseUrl, accessToken, artifactId));
    public static string ApiPluginCatalog(string baseUrl, string accessToken) =>
        Consume(AstraCoreNative.astra_core_api_plugin_catalog(baseUrl, accessToken));
    public static string ApiLibrary(string baseUrl, string accessToken) =>
        Consume(AstraCoreNative.astra_core_api_library(baseUrl, accessToken));
}

/// <summary>録音セッション（WASAPI から push）。macOS RecordingRuntime と同じ core を叩く。</summary>
public sealed class RecordingSession : IDisposable
{
    private IntPtr _handle;
    private RecordingSession(IntPtr handle) => _handle = handle;

    public static RecordingSession? Start(string root, string meetingId)
    {
        var h = AstraCoreNative.astra_core_session_start(root, meetingId);
        return h == IntPtr.Zero ? null : new RecordingSession(h);
    }

    public uint Push(float[] samples, uint sampleRate) =>
        _handle == IntPtr.Zero ? 0 : AstraCoreNative.astra_core_session_push(_handle, samples, (nuint)samples.Length, sampleRate);

    public ulong RecordedMs => _handle == IntPtr.Zero ? 0 : AstraCoreNative.astra_core_session_recorded_ms(_handle);

    public int Finish() => _handle == IntPtr.Zero ? -1 : AstraCoreNative.astra_core_session_finish(_handle);

    public void Dispose()
    {
        if (_handle != IntPtr.Zero) { AstraCoreNative.astra_core_session_free(_handle); _handle = IntPtr.Zero; }
    }
}
