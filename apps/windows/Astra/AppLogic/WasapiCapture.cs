using System.Runtime.InteropServices;

namespace Astra;

/// WASAPI のマイク取り込み（Windows）。macOS の MicCapture（AVAudioEngine）に対応。
/// 既定の録音デバイスを共有モードで開き、フレームを float[] にして callback へ渡す。
/// `loopback: true` にすると既定の再生デバイスの loopback（システム音声）を拾う（§4 System Audio）。
///
/// **注意**: 実行は Windows のみ（mmdevapi/ole32 の COM）。COM インターフェース宣言はどのホストでも
/// コンパイルできるので **macOS/CI で型検査**（実取り込みは Windows 実機/CI で検証）。canonical な
/// WASAPI capture の手順に従う（GetDefaultAudioEndpoint → Activate(IAudioClient) → Initialize →
/// GetService(IAudioCaptureClient) → GetBuffer ループ）。
public sealed class WasapiCapture : IDisposable
{
    private const int AUDCLNT_SHAREMODE_SHARED = 0;
    private const uint AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
    private static readonly Guid IID_IAudioClient = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    private static readonly Guid IID_IAudioCaptureClient = new("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

    private IMMDevice? _device;
    private IAudioClient? _client;
    private IAudioCaptureClient? _capture;
    private Thread? _thread;
    private volatile bool _running;
    private readonly bool _loopback;
    private Action<float[]>? _onFrame;

    public WasapiCapture(bool loopback = false) => _loopback = loopback;

    /// 取り込みを始める。フレーム（float mono/interleaved は WAVEFORMAT 依存）を callback へ渡す。
    public void Start(Action<float[]> onFrame)
    {
        _onFrame = onFrame;
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        // loopback はレンダラ(eRender=0)、通常はキャプチャ(eCapture=1)。role=eConsole(0)。
        enumerator.GetDefaultAudioEndpoint(_loopback ? 0 : 1, 0, out _device);
        var iid = IID_IAudioClient;
        _device!.Activate(ref iid, 1 /*CLSCTX_ALL*/, IntPtr.Zero, out object clientObj);
        _client = (IAudioClient)clientObj;
        _client.GetMixFormat(out IntPtr pFormat);
        uint flags = _loopback ? AUDCLNT_STREAMFLAGS_LOOPBACK : 0;
        _client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 10_000_000, 0, pFormat, Guid.Empty);
        var capIid = IID_IAudioCaptureClient;
        _client.GetService(ref capIid, out object capObj);
        _capture = (IAudioCaptureClient)capObj;
        _client.Start();
        _running = true;
        _thread = new Thread(CaptureLoop) { IsBackground = true };
        _thread.Start();
    }

    private void CaptureLoop()
    {
        while (_running)
        {
            _capture!.GetNextPacketSize(out uint packetFrames);
            while (packetFrames > 0 && _running)
            {
                _capture.GetBuffer(out IntPtr pData, out uint frames, out uint bufFlags, out _, out _);
                if (frames > 0 && pData != IntPtr.Zero)
                {
                    var samples = new float[frames];               // mix format は float。1ch 相当を取り出す
                    Marshal.Copy(pData, samples, 0, (int)frames);
                    _onFrame?.Invoke(samples);
                }
                _capture.ReleaseBuffer(frames);
                _capture.GetNextPacketSize(out packetFrames);
            }
            Thread.Sleep(5);
        }
    }

    public void Stop()
    {
        _running = false;
        _thread?.Join(500);
        _client?.Stop();
    }

    public void Dispose()
    {
        Stop();
        if (_capture != null) Marshal.ReleaseComObject(_capture);
        if (_client != null) Marshal.ReleaseComObject(_client);
        if (_device != null) Marshal.ReleaseComObject(_device);
    }
}

// ---- 最小限の WASAPI COM 宣言（canonical GUID / vtable 順）。実装は OS 提供。 ----

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    int NotImpl1();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
        [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioClient
{
    int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, Guid audioSessionGuid);
    int GetBufferSize(out uint bufferFrames);
    int GetStreamLatency(out long latency);
    int GetCurrentPadding(out uint padding);
    int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
    int GetMixFormat(out IntPtr format);
    int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    int Start();
    int Stop();
    int Reset();
    int SetEventHandle(IntPtr eventHandle);
    int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioCaptureClient
{
    int GetBuffer(out IntPtr data, out uint numFramesToRead, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    int ReleaseBuffer(uint numFramesRead);
    int GetNextPacketSize(out uint numFramesInNextPacket);
}
