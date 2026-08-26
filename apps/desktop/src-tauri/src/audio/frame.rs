//! PCM フレーム。正本 §11・§12。
//!
//! **出所を落とさない。**
//!
//! DeepNote はマイクのコールバックの中でシステム音声を混ぜ、
//! 混ざった `Vec<f32>` だけを認識と録音へ渡していた。
//! あとから「この発言はどちらから来たか」を言えない。
//! Astra は会議の話者対応（§12）と、外へ出す判断（§22）で出所が要る。

use serde::{Deserialize, Serialize};

/// 手元で扱う標準の形。TypeScript 側（`@astra/audio`）と揃える。
pub const SAMPLE_RATE_HZ: u32 = 16_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioSourceKind {
    Microphone,
    System,
    Mixed,
}

impl AudioSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Microphone => "microphone",
            Self::System => "system",
            Self::Mixed => "mixed",
        }
    }
}

#[derive(Debug, Clone)]
pub struct PcmFrame {
    pub source: AudioSourceKind,
    /// -1.0〜1.0 の mono サンプル。
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    /// 取り込み開始からの位置。**壁時計ではない**（一時停止で飛ばない）。
    pub offset_ms: u64,
    /// 取り込み順。欠番が出たら落ちている。
    pub sequence: u64,
}

impl PcmFrame {
    pub fn duration_ms(&self) -> u64 {
        if self.sample_rate == 0 {
            return 0;
        }
        (self.samples.len() as u64 * 1000) / self.sample_rate as u64
    }
}

/// 多チャンネルを mono に落とす。
///
/// **平均する。**片チャンネルだけ採ると、片方にしか入っていない声が消える。
pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// 音の大きさ。0〜1。
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

/// 2 本を足してクランプする。
///
/// 長さが違うときは短い方を無音で埋める。**切り詰めない。**
/// 切ると、片方だけ入っていた声が消える。
pub fn mix(microphone: &[f32], system: &[f32]) -> Vec<f32> {
    let len = microphone.len().max(system.len());
    (0..len)
        .map(|i| {
            let m = microphone.get(i).copied().unwrap_or(0.0);
            let s = system.get(i).copied().unwrap_or(0.0);
            (m + s).clamp(-1.0, 1.0)
        })
        .collect()
}

/// 16bit little-endian へ。録音と転送はこの形。
///
/// 復号側と同じ 32768 で測る。**片方だけ 32767 にしない**（往復で誤差が積む）。
pub fn to_pcm16(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = ((clamped * 32_768.0).round() as i32).min(32_767) as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

pub fn from_pcm16(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32_768.0)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn averages_channels_instead_of_taking_one() {
        // 片チャンネルだけ採ると、片方にしか入っていない声が消える
        assert_eq!(to_mono(&[1.0, 0.0, 0.0, 1.0], 2), vec![0.5, 0.5]);
    }

    #[test]
    fn leaves_mono_alone() {
        assert_eq!(to_mono(&[0.5, 0.25], 1), vec![0.5, 0.25]);
    }

    #[test]
    fn pads_the_shorter_side_when_mixing() {
        let mixed = mix(&[0.5], &[0.5, 0.5]);
        assert_eq!(mixed.len(), 2);
        assert!((mixed[1] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn clamps_a_loud_mix() {
        assert_eq!(mix(&[0.8], &[0.8]), vec![1.0]);
    }

    #[test]
    fn round_trips_through_16_bit() {
        let original = [0.0f32, 0.5, -0.5, 0.999];
        let back = from_pcm16(&to_pcm16(&original));
        for (a, b) in original.iter().zip(back.iter()) {
            assert!((a - b).abs() < 1.0 / 32_768.0 + 1e-6, "{a} vs {b}");
        }
    }

    #[test]
    fn clamps_before_rounding_so_a_loud_sample_keeps_its_sign() {
        let back = from_pcm16(&to_pcm16(&[2.0, -2.0]));
        assert!(back[0] > 0.99);
        assert!(back[1] < -0.99);
    }

    #[test]
    fn reports_silence_as_zero() {
        assert_eq!(rms(&[0.0; 100]), 0.0);
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn measures_a_frame_from_its_samples() {
        let frame = PcmFrame {
            source: AudioSourceKind::Microphone,
            samples: vec![0.0; SAMPLE_RATE_HZ as usize],
            sample_rate: SAMPLE_RATE_HZ,
            offset_ms: 0,
            sequence: 1,
        };
        assert_eq!(frame.duration_ms(), 1000);
    }
}
