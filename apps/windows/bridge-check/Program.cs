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

Console.WriteLine($"CS_OK bridge->core: version={version} pkce=S256 authorizeUrl parseCallback elapsed={elapsed}");
