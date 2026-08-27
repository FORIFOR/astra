using System.Runtime.InteropServices;
using System.Text;

namespace Astra;

/// 資格情報の保管（Windows Credential Manager）。macOS の KeychainStore に対応。正本 §21。
/// **refresh token / device token はここだけに置く**（Cloud/DB へ出さない）。access token は置かない。
///
/// **注意**: 実行は Windows のみ（advapi32）。P/Invoke 宣言はどのホストでもコンパイルできるので
/// **macOS/CI で型検査**（実保存/読取は Windows 実機/CI）。target 名は他アプリと混ざらないよう接頭辞を付ける。
public static class WindowsCredentialStore
{
    private const string Prefix = "Astra:"; // ターゲット名の名前空間
    private const uint CRED_TYPE_GENERIC = 1;
    private const uint CRED_PERSIST_LOCAL_MACHINE = 2;

    [StructLayout(LayoutKind.Sequential)]
    private struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDeleteW(string target, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    /// 保存する（upsert）。value は UTF-8 の blob。
    public static bool Set(string key, string value)
    {
        byte[] blob = Encoding.UTF8.GetBytes(value);
        IntPtr blobPtr = Marshal.AllocHGlobal(blob.Length);
        IntPtr targetPtr = Marshal.StringToHGlobalUni(Prefix + key);
        try
        {
            Marshal.Copy(blob, 0, blobPtr, blob.Length);
            var cred = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = targetPtr,
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = blobPtr,
                Persist = CRED_PERSIST_LOCAL_MACHINE,
            };
            return CredWriteW(ref cred, 0);
        }
        finally { Marshal.FreeHGlobal(blobPtr); Marshal.FreeHGlobal(targetPtr); }
    }

    /// 読み出す。無ければ null（**未登録はエラーではない**）。
    public static string? Get(string key)
    {
        if (!CredReadW(Prefix + key, CRED_TYPE_GENERIC, 0, out IntPtr credPtr)) return null;
        try
        {
            var cred = Marshal.PtrToStructure<CREDENTIAL>(credPtr);
            if (cred.CredentialBlobSize == 0 || cred.CredentialBlob == IntPtr.Zero) return null;
            var blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, (int)cred.CredentialBlobSize);
            return Encoding.UTF8.GetString(blob);
        }
        finally { CredFree(credPtr); }
    }

    /// 消す。無くても成功扱い（サインアウトを冪等に）。
    public static bool Delete(string key) => CredDeleteW(Prefix + key, CRED_TYPE_GENERIC, 0) || true;
}

/// サインインの資格情報の置き場（Windows）。macOS の SessionStore に対応。
/// **refresh/device token は Credential Manager のみ**。access token はメモリ。
public static class WindowsSessionStore
{
    private const string RefreshKey = "refresh_token";
    private const string DeviceKey = "device_token";

    public static bool Persist(string refreshToken, string deviceToken)
        => WindowsCredentialStore.Set(RefreshKey, refreshToken) & WindowsCredentialStore.Set(DeviceKey, deviceToken);

    public static string? RefreshToken() => WindowsCredentialStore.Get(RefreshKey);
    public static void Clear() { WindowsCredentialStore.Delete(RefreshKey); WindowsCredentialStore.Delete(DeviceKey); }
}
