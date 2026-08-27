//! RAG / context の OS 非依存モデル。候補集合を決定的にランク付けする（UI framework を知らない）。
//!
//! 実際の埋め込み検索や DB は各アプリ/サービス側。core は「語彙一致 + 新しさ + プロジェクト一致 +
//! 出典の重み」の合成という**順序付けの契約**だけを持つ。両 OS・Tauri が同じ順序を得るための単一実装。

/// 候補の出典。重み付けに使う。
#[derive(uniffi::Enum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextSource {
    Meeting,
    Library,
    Message,
    Web,
}

fn source_weight(s: ContextSource) -> f64 {
    match s {
        ContextSource::Meeting => 1.0,
        ContextSource::Library => 0.9,
        ContextSource::Message => 0.7,
        ContextSource::Web => 0.5,
    }
}

/// ランク対象の 1 件。
#[derive(uniffi::Record, Clone, Debug)]
pub struct ContextCandidate {
    pub id: String,
    pub text: String,
    pub source: ContextSource,
    /// 取得/作成からの経過秒。新しいほど強い。
    pub age_seconds: u64,
    /// いま見ているプロジェクトに属するか。
    pub project_match: bool,
}

/// 問い合わせ。
#[derive(uniffi::Record, Clone, Debug)]
pub struct ContextQuery {
    /// 小文字化済みの語（呼び出し側で分割）。空なら語彙一致は 0。
    pub terms: Vec<String>,
    /// 上位いくつ返すか（0 は全件）。
    pub limit: u32,
}

/// ランク結果。UI は score 順に見せる。
#[derive(uniffi::Record, Clone, Debug, PartialEq)]
pub struct ContextResult {
    pub id: String,
    pub score: f64,
    /// なぜ上位か（人が読める短い理由。§8 の「根拠を出す」）。
    pub reason: String,
}

/// 語彙一致（term がテキストに現れた割合）。素朴だが決定的。
fn lexical_overlap(terms: &[String], text_lower: &str) -> (f64, u32) {
    if terms.is_empty() {
        return (0.0, 0);
    }
    let mut hits = 0u32;
    for t in terms {
        if !t.is_empty() && text_lower.contains(t.as_str()) {
            hits += 1;
        }
    }
    (hits as f64 / terms.len() as f64, hits)
}

/// 新しさ（12 時間で半減する指数減衰）。
fn recency(age_seconds: u64) -> f64 {
    let half_life = 12.0 * 3600.0;
    0.5f64.powf(age_seconds as f64 / half_life)
}

/// 候補を決定的にランク付けする。両 OS・Tauri が同じ順序を得る単一実装。
#[uniffi::export]
pub fn rank_context(query: ContextQuery, candidates: Vec<ContextCandidate>) -> Vec<ContextResult> {
    let mut scored: Vec<ContextResult> = candidates
        .iter()
        .map(|c| {
            let text_lower = c.text.to_lowercase();
            let (lex, hits) = lexical_overlap(&query.terms, &text_lower);
            let rec = recency(c.age_seconds);
            let proj = if c.project_match { 1.0 } else { 0.0 };
            let w = source_weight(c.source);
            // 合成: 語彙が主、新しさとプロジェクトと出典で調整。重みは固定（決定的）。
            let score = (0.55 * lex + 0.25 * rec + 0.20 * proj) * w;
            let mut reasons = Vec::new();
            if hits > 0 {
                reasons.push(format!("語が {hits} 件一致"));
            }
            if rec > 0.6 {
                reasons.push("新しい".to_string());
            }
            if c.project_match {
                reasons.push("このプロジェクト".to_string());
            }
            ContextResult {
                id: c.id.clone(),
                score,
                reason: if reasons.is_empty() {
                    "関連は弱い".to_string()
                } else {
                    reasons.join(" · ")
                },
            }
        })
        .collect();
    // score 降順。同点は id で安定化（決定的）。
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    if query.limit > 0 && (query.limit as usize) < scored.len() {
        scored.truncate(query.limit as usize);
    }
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(id: &str, text: &str, source: ContextSource, age: u64, proj: bool) -> ContextCandidate {
        ContextCandidate { id: id.into(), text: text.into(), source, age_seconds: age, project_match: proj }
    }

    #[test]
    fn lexical_match_ranks_above_unrelated() {
        let q = ContextQuery { terms: vec!["oauth".into(), "審査".into()], limit: 0 };
        let out = rank_context(
            q,
            vec![
                cand("a", "天気の話", ContextSource::Web, 0, false),
                cand("b", "OAuth 審査がまだ終わっていない", ContextSource::Meeting, 0, true),
            ],
        );
        assert_eq!(out[0].id, "b");
        assert!(out[0].score > out[1].score);
        assert!(out[0].reason.contains("一致"));
    }

    #[test]
    fn recency_breaks_ties_between_equal_text() {
        let q = ContextQuery { terms: vec!["report".into()], limit: 0 };
        let out = rank_context(
            q,
            vec![
                cand("old", "quarterly report", ContextSource::Library, 48 * 3600, false),
                cand("new", "quarterly report", ContextSource::Library, 0, false),
            ],
        );
        assert_eq!(out[0].id, "new");
    }

    #[test]
    fn limit_truncates_and_order_is_deterministic() {
        let q = ContextQuery { terms: vec!["x".into()], limit: 1 };
        let out = rank_context(
            q,
            vec![
                cand("a", "x", ContextSource::Web, 0, false),
                cand("b", "x", ContextSource::Web, 0, false),
            ],
        );
        assert_eq!(out.len(), 1);
        // 同点は id 昇順で安定
        assert_eq!(out[0].id, "a");
    }
}
