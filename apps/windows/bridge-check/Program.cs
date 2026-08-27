// Windows の C# CoreBridge（apps/windows/Astra/CoreBridge/AstraCore.cs と同一）を P/Invoke で
// 実 libastra_core に繋ぎ、正しい結果が返ることを検証する。**どのホストでも dotnet + core の
// 共有ライブラリがあれば走る**ので、Windows 実機が無くても C# ブリッジの動作を担保できる。
using Astra;

string version = AstraCore.Version;
if (string.IsNullOrEmpty(version)) { Console.WriteLine("CS_FAIL version empty"); Environment.Exit(2); }

// RFC 7636 PKCE テストベクタ（core と一致するはず）。
string chal = AstraCore.PkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
if (chal != "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM") { Console.WriteLine($"CS_FAIL pkce={chal}"); Environment.Exit(3); }

string url = AstraCore.AuthorizeUrl("google", "cid-1", "http://127.0.0.1:8123/cb",
    new[] { "openid", "email" }, "st-1", chal);
if (!url.Contains("code_challenge_method=S256") || !url.Contains("state=st-1")) { Console.WriteLine($"CS_FAIL url={url}"); Environment.Exit(4); }

string cb = AstraCore.ParseCallback("/callback?code=abc&state=xyz");
if (!cb.Contains("\"code\":\"abc\"") || !cb.Contains("\"state\":\"xyz\"")) { Console.WriteLine($"CS_FAIL callback={cb}"); Environment.Exit(5); }

string elapsed = AstraCore.FormatElapsed(65000);
if (elapsed != "01:05") { Console.WriteLine($"CS_FAIL elapsed={elapsed}"); Environment.Exit(6); }

// Recording Workspace の形（凹み Bezier）が共有 golden fixture（tokens 由来）と一致するか。
// WinUI の RecordingWorkspaceGeometry と同じ制御点（固定オフセット 14/15 + Metrics）で d を組む。
// これで macOS(Swift Shape) と Windows(C#) が同じ形を描くことを、Windows 実機なしで担保する。
string N(double v) { double r = Math.Round(v); return Math.Abs(v - r) < 0.005 ? ((long)r).ToString() : v.ToString("0.00"); }
double W = Metrics.WorkspaceWidth, H = Metrics.WorkspaceHeight, rad = Metrics.WorkspaceRadius;
double nW = Metrics.NotchWidth, dep = Metrics.NotchDepth, sh = Metrics.NotchShoulder;
double cx = W / 2, nL = cx - nW / 2, nR = cx + nW / 2;
string d = string.Join(" ", new[] {
    $"M {N(rad)},0",
    $"L {N(nL - sh)},0",
    $"C {N(nL - 14)},0 {N(nL - 15)},{N(dep)} {N(nL)},{N(dep)}",
    $"L {N(nR)},{N(dep)}",
    $"C {N(nR + 15)},{N(dep)} {N(nR + 14)},0 {N(nR + sh)},0",
    $"L {N(W - rad)},0",
    $"Q {N(W)},0 {N(W)},{N(rad)}",
    $"L {N(W)},{N(H - rad)}",
    $"Q {N(W)},{N(H)} {N(W - rad)},{N(H)}",
    $"L {N(rad)},{N(H)}",
    $"Q 0,{N(H)} 0,{N(H - rad)}",
    $"L 0,{N(rad)}",
    $"Q 0,0 {N(rad)},0",
    "Z",
});
// 実 gateway に届くなら、Windows の session/data ロジック(AstraSession)を C# から往復検証する。
string apiBase = Environment.GetEnvironmentVariable("ASTRA_GATEWAY_URL") ?? "http://127.0.0.1:3000";
var session = new AstraSession(apiBase);
if (session.Reachable()) {
    if (!session.SignIn($"cswin-{Environment.ProcessId}@astra.local", "CSWin")) { Console.WriteLine("CS_FAIL session sign-in"); Environment.Exit(10); }
    if (session.RefreshToken.Length == 0) { Console.WriteLine("CS_FAIL no refresh token"); Environment.Exit(11); }
    var apps = session.Apps();
    var lib = session.Library();
    string echo = session.RunEchoTask("cswin");
    if (apps.Length == 0 || echo.Length == 0) { Console.WriteLine($"CS_FAIL gateway apps={apps.Length} echo={echo.Length}"); Environment.Exit(12); }
    Console.WriteLine($"CS_OK gateway(AstraSession): signedIn apps={apps.Length} library={lib.Length} echoArtifact={echo.Length}bytes");
} else {
    Console.WriteLine("CS_SKIP gateway: not reachable");
}

string goldenPath = Path.Combine(AppContext.BaseDirectory, "recording-workspace.path");
if (!File.Exists(goldenPath)) {
    // ソースツリーからも探す（CI/ローカル両対応）。
    string alt = Path.Combine(Directory.GetCurrentDirectory(), "../../../../../../shared/design/fixtures/recording-workspace.path");
    if (File.Exists(alt)) goldenPath = alt;
}
if (File.Exists(goldenPath)) {
    string golden = File.ReadAllText(goldenPath).Trim();
    if (d != golden) { Console.WriteLine($"CS_FAIL geometry mismatch\n got={d}\n want={golden}"); Environment.Exit(7); }
    Console.WriteLine($"CS_OK bridge->core: version={version} pkce=S256 authorizeUrl parseCallback elapsed={elapsed}; geometry matches shared fixture");
} else {
    Console.WriteLine($"CS_OK bridge->core: version={version} pkce=S256 authorizeUrl parseCallback elapsed={elapsed}; geometry fixture not found (skipped)");
}
