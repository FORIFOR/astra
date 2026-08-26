//! 標本化周波数の変換。正本 §11。
//!
//! 装置の既定は 44.1k / 48k が多い。認識は 16k を前提にしている。
//! **端数を捨てない**のがここの仕事で、捨てると音が少しずつ短くなる。

use rubato::{FftFixedIn, Resampler as _};

/// 変換できない理由。**文字列で投げない。**
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResampleError {
    /// 0Hz や桁違いの値。装置から来た値をそのまま信じない。
    UnsupportedRate { input: u32, output: u32 },
    /// 変換器を作れなかった。
    Unavailable(String),
}

impl std::fmt::Display for ResampleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedRate { input, output } => {
                write!(f, "cannot resample {input}Hz to {output}Hz")
            }
            Self::Unavailable(reason) => write!(f, "resampler unavailable: {reason}"),
        }
    }
}

/// 100ms ずつ処理する。細かくすると変換の質が落ち、粗くすると遅れる。
const CHUNK_DIVISOR: usize = 10;

pub struct Resampler {
    inner: Option<FftFixedIn<f32>>,
    /// 端数。次の呼び出しへ持ち越す。**捨てない。**
    pending: Vec<f32>,
    chunk: usize,
    input_rate: u32,
    output_rate: u32,
}

impl Resampler {
    /// 同じ周波数なら変換器を作らない（素通し）。
    pub fn new(input_rate: u32, output_rate: u32) -> Result<Self, ResampleError> {
        if input_rate == 0 || output_rate == 0 || input_rate > 384_000 || output_rate > 384_000 {
            return Err(ResampleError::UnsupportedRate {
                input: input_rate,
                output: output_rate,
            });
        }
        if input_rate == output_rate {
            return Ok(Self {
                inner: None,
                pending: Vec::new(),
                chunk: 0,
                input_rate,
                output_rate,
            });
        }

        let chunk = (input_rate as usize) / CHUNK_DIVISOR;
        let inner = FftFixedIn::<f32>::new(input_rate as usize, output_rate as usize, chunk, 2, 1)
            .map_err(|e| ResampleError::Unavailable(e.to_string()))?;

        Ok(Self {
            inner: Some(inner),
            pending: Vec::new(),
            chunk,
            input_rate,
            output_rate,
        })
    }

    pub fn input_rate(&self) -> u32 {
        self.input_rate
    }

    pub fn output_rate(&self) -> u32 {
        self.output_rate
    }

    /// 端数が残っているか。診断とテスト用。
    pub fn pending_samples(&self) -> usize {
        self.pending.len()
    }

    /// 変換する。**足りない分は次回へ持ち越し**、無音で埋めない。
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let Some(resampler) = self.inner.as_mut() else {
            return input.to_vec();
        };

        self.pending.extend_from_slice(input);
        let mut output = Vec::new();

        while self.pending.len() >= self.chunk {
            let chunk: Vec<f32> = self.pending.drain(..self.chunk).collect();
            match resampler.process(&[chunk], None) {
                Ok(resampled) => {
                    if let Some(channel) = resampled.first() {
                        output.extend_from_slice(channel);
                    }
                }
                Err(error) => {
                    // 変換に失敗した塊は捨てるしかないが、黙って捨てない
                    log::warn!("resampler dropped a chunk: {error}");
                }
            }
        }

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_through_when_the_rate_already_matches() {
        let mut resampler = Resampler::new(16_000, 16_000).expect("same rate is fine");
        let input = vec![0.1, 0.2, 0.3];
        assert_eq!(resampler.process(&input), input);
        // 素通しなら端数は溜まらない
        assert_eq!(resampler.pending_samples(), 0);
    }

    #[test]
    fn refuses_a_rate_it_cannot_handle() {
        assert_eq!(
            Resampler::new(0, 16_000).err(),
            Some(ResampleError::UnsupportedRate {
                input: 0,
                output: 16_000
            })
        );
        assert!(Resampler::new(48_000, 0).is_err());
        assert!(Resampler::new(999_999, 16_000).is_err());
    }

    #[test]
    fn keeps_the_remainder_instead_of_padding_it() {
        let mut resampler = Resampler::new(48_000, 16_000).expect("48k to 16k");
        // 1 チャンクに足りない量。**無音で埋めずに持ち越す。**
        let short = vec![0.0f32; 100];
        assert!(resampler.process(&short).is_empty());
        assert_eq!(resampler.pending_samples(), 100);
    }

    #[test]
    fn produces_roughly_a_third_of_the_samples_from_48k() {
        let mut resampler = Resampler::new(48_000, 16_000).expect("48k to 16k");
        // 1 秒ぶん
        let out = resampler.process(&vec![0.0f32; 48_000]);
        let ratio = out.len() as f32 / 16_000.0;
        // 端数が残るので厳密には一致しない。桁が合っていることを見る。
        assert!(ratio > 0.8 && ratio <= 1.0, "got {} samples", out.len());
    }
}
