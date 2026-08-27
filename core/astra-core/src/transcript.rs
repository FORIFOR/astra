//! 文字起こしのドメイン。窓のセグメント化・重なりの畳み込み・途中経過/確定の型。
//!
//! ここは音を録るエンジン（sherpa-onnx の C 束縛）を**持たない**。持つのは、
//! 窓をどう刻むか・重なりをどう畳むか・何を途中経過/確定として出すか、という
//! OS にも録音エンジンにも依存しない純ロジックだけ。エンジンは各アプリ側に残す
//! （手元で動く統合であって、共有ドメインではない）。
//!
//! もとは DeepNote 由来の実装を Astra の契約へ作り直したもの。TypeScript 側の
//! `TranscriptEvent` と表現を揃える（`{ type: "partial" | "final", ... }`）。

use serde::Serialize;

/// 手元認識の窓。窓の長さと、次の窓までずらす幅。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LiveWindow {
    pub window_ms: u32,
    /// 窓をずらす幅。窓より小さくして重なりを作る（境目の語を落とさないため）。
    pub hop_ms: u32,
}

impl Default for LiveWindow {
    fn default() -> Self {
        // 1.5 秒 / 1.2 秒。§23 には届かないが、6 秒よりは 4 倍速い。
        Self {
            window_ms: 1_500,
            hop_ms: 1_200,
        }
    }
}

impl LiveWindow {
    pub fn problems(&self) -> Vec<String> {
        let mut problems = Vec::new();
        if self.window_ms == 0 {
            problems.push("窓の長さが 0 です".to_string());
        }
        if self.hop_ms == 0 {
            problems.push("ずらす幅が 0 です".to_string());
        }
        if self.hop_ms > self.window_ms {
            // 重なりが無いと、境目の語が落ちる
            problems.push("ずらす幅が窓より長く、重なりがありません".to_string());
        }
        problems
    }

    pub fn window_samples(&self, sample_rate: u32) -> usize {
        (self.window_ms as usize * sample_rate as usize) / 1000
    }

    pub fn hop_samples(&self, sample_rate: u32) -> usize {
        (self.hop_ms as usize * sample_rate as usize) / 1000
    }
}

/// 途中経過と確定。TypeScript 側の `TranscriptEvent` と揃える。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum TranscriptEvent {
    Partial {
        text: String,
        /// 取り込み開始からの位置。
        started_at_ms: u64,
        emitted_at_ms: u64,
    },
    Final {
        text: String,
        started_at_ms: u64,
        ended_at_ms: u64,
    },
}

/// 窓の重なりを畳んで繋ぐ。`previous` の末尾と `next` の先頭が最大
/// `max_overlap_chars` 文字まで一致すれば、その分を落として繋ぐ。
pub fn merge_overlap(previous: &str, next: &str, max_overlap_chars: usize) -> String {
    if previous.is_empty() {
        return next.to_string();
    }
    if next.is_empty() {
        return previous.to_string();
    }

    let previous_chars: Vec<char> = previous.chars().collect();
    let next_chars: Vec<char> = next.chars().collect();
    let max = max_overlap_chars
        .min(previous_chars.len())
        .min(next_chars.len());

    for length in (1..=max).rev() {
        let suffix: String = previous_chars[previous_chars.len() - length..]
            .iter()
            .collect();
        let prefix: String = next_chars[..length].iter().collect();
        if suffix == prefix {
            let remainder: String = next_chars[length..].iter().collect();
            return format!("{previous}{remainder}");
        }
    }

    format!("{previous}{next}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_the_overlap_between_windows() {
        assert_eq!(
            merge_overlap("こんにちは", "にちは世界", 12),
            "こんにちは世界"
        );
        assert_eq!(merge_overlap("abc", "cde", 12), "abcde");
        // 重なりが無ければ、そのまま繋ぐ
        assert_eq!(merge_overlap("abc", "def", 12), "abcdef");
        assert_eq!(merge_overlap("", "hello", 12), "hello");
        assert_eq!(merge_overlap("hello", "", 12), "hello");
    }

    #[test]
    fn refuses_a_window_with_no_overlap() {
        let window = LiveWindow {
            window_ms: 1_000,
            hop_ms: 1_200,
        };
        // 重なりが無いと、境目の語が落ちる
        assert!(window
            .problems()
            .iter()
            .any(|p| p.contains("重なりがありません")));
    }

    #[test]
    fn refuses_a_zero_window() {
        let window = LiveWindow {
            window_ms: 0,
            hop_ms: 0,
        };
        assert_eq!(window.problems().len(), 2);
    }

    #[test]
    fn the_default_window_is_shorter_than_deepnote() {
        // DeepNote は 6000ms 固定。§23 の 350ms とは桁が 1 つ違う。
        let window = LiveWindow::default();
        assert!(window.window_ms < 6_000);
        assert!(window.problems().is_empty());
    }

    #[test]
    fn the_partial_event_serializes_with_a_camelcase_tag() {
        let event = TranscriptEvent::Partial {
            text: "hi".to_string(),
            started_at_ms: 0,
            emitted_at_ms: 120,
        };
        let json = serde_json::to_string(&event).expect("serialize");
        assert!(json.contains("\"type\":\"partial\""));
        assert!(json.contains("\"emitted_at_ms\":120"));
    }
}
