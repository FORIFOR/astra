import SwiftUI

/// Connection → measured progress → five reviewed groups. The Home window is reused.
struct InitialProfileView: View {
    @ObservedObject private var store = InitialProfileStore.shared
    @Environment(\.colorScheme) private var scheme
    @State private var editing = false
    @State private var draft: InitialProfileSections?
    private var dark: Bool { scheme == .dark }
    private var ready: Bool { store.result?.status == "ready" }
    private var failed: Bool { store.result?.status == "failed" || (store.result == nil && store.failure != nil) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.largePadding) {
                Text(ready ? "Your Astra Profile is ready" : (failed ? "Profileの作成を再開できます" : "Building your Astra Profile"))
                    .font(.system(size: S.type(TypeScale.pageTitleSize), weight: .semibold))
                    .accessibilityAddTraits(.isHeader)
                Text(ready ? "最近の記録から整理した初期プロファイルです。推定を含むため、内容を確認してください。" : (failed ? "接続を確認して再試行できます。初期Profileはあとから作成することもできます。" : "許可されたメールやカレンダーから、仕事、よく関わる人、優先事項、予定の傾向を整理しています。回答や提案をあなた向けにするために使います。"))
                    .font(.system(size: S.type(TypeScale.bodySize)))
                    .fixedSize(horizontal: false, vertical: true)
                if let failure = store.failure {
                    Text(failure).foregroundStyle(Palette.danger(dark)).accessibilityIdentifier("initialProfileFailure")
                }
                if ready, let sections = store.result?.sections {
                    if editing, draft != nil { editFields }
                    else {
                        group("CURRENT FOCUS", sections.focus)
                        group("IMPORTANT PEOPLE", sections.people)
                        group("UPCOMING PRIORITIES", sections.priorities)
                        group("WORK PATTERN", sections.workPattern)
                        group("OPEN ITEMS", ["\(sections.openItems)件"])
                    }
                    HStack {
                        ProbeButton(id: "initialProfileConfirm", action: { store.confirm(draft ?? sections) }) { Text(editing ? "保存してHomeへ" : "Looks right") }
                            .buttonStyle(.borderedProminent).disabled(store.saving)
                            .accessibilityIdentifier("initialProfileConfirm")
                        ProbeButton(id: "initialProfileEdit", action: {
                            if editing { draft = nil; editing = false } else { draft = sections; editing = true }
                        }) { Text(editing ? "編集をやめる" : "Review & edit") }.buttonStyle(.borderless).disabled(store.saving)
                            .accessibilityIdentifier("initialProfileEdit")
                    }
                } else {
                    progress("Calendar", sources: ["google_calendar", "outlook_calendar"], unit: "件の予定を確認")
                    progress("Mail", sources: ["gmail", "outlook_mail"], unit: "件のメールを確認")
                    progress("People", sources: [], unit: "")
                    progress("Projects", sources: [], unit: "")
                    progress("Priorities", sources: [], unit: "")
                    if let found = store.result?.sections {
                        Divider()
                        Text("ここまでに整理できたこと").accessibilityAddTraits(.isHeader)
                        Text("仕事 \(found.focus.count)件 · よく関わる人 \(found.people.count)人 · 未完了 \(found.openItems)件")
                    }
                    Text("初回のみ · 予定は過去90日〜今後45日、メールは直近45日の最大100件。連絡先はやり取りの頻度から整理します。全文は取得しません。")
                        .font(.system(size: S.type(TypeScale.microSize))).foregroundStyle(Palette.muted(dark))
                    if failed {
                        Text("データを取得できませんでした。macOSのキーチェーン確認が表示された場合は許可し、接続と読み取り権限を確認してから再試行してください。")
                        Button("再試行") { store.retry() }.buttonStyle(.bordered)
                    } else {
                        Text("件数や通信状況によって時間がかかる場合があります。この画面を離れても続きから確認できます。")
                            .font(.system(size: S.type(TypeScale.microSize))).foregroundStyle(Palette.muted(dark))
                    }
                }
                if !ready {
                    ProbeButton(id: "initialProfileLater", action: { store.deferUntilRequested() }) { Text("あとでHomeへ") }
                        .buttonStyle(.borderless).accessibilityIdentifier("initialProfileLater")
                    Text("Apps → Connectionsの「Profileを確認」から戻れます。")
                        .font(.system(size: S.type(TypeScale.microSize))).foregroundStyle(Palette.muted(dark))
                }
                if ready, store.result?.outcomes.contains(where: { $0.status != "synced" }) == true {
                    Text("未接続・未許可・取得に失敗したデータは含まれていません。取得できた範囲だけで整理しています。")
                        .font(.system(size: S.type(TypeScale.microSize))).foregroundStyle(Palette.muted(dark))
                }
            }
            .font(.system(size: S.type(TypeScale.secondarySize)))
            .foregroundStyle(Palette.text(dark))
            .padding(Space.largePadding)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Palette.canvas(dark))
        .accessibilityIdentifier("initialProfile")
    }

    private func group(_ title: String, _ values: [String]) -> some View {
        VStack(alignment: .leading, spacing: Space.compact) {
            Text(title).font(.system(size: S.type(TypeScale.microSize), weight: .semibold)).foregroundStyle(Palette.muted(dark))
            Text(values.isEmpty ? "まだ判断できる情報がありません" : values.joined(separator: "、"))
                .font(.system(size: S.type(TypeScale.bodySize))).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func progress(_ label: String, sources: [String], unit: String) -> some View {
        let outcome = store.result?.outcomes.first { sources.contains($0.source) }
        return HStack {
            Image(systemName: outcome?.status == "synced" ? "checkmark.circle" : "circle")
                .accessibilityHidden(true)
            Text(label).frame(maxWidth: .infinity, alignment: .leading)
            Text(outcome.map { value in
                switch value.status {
                case "reading": return "確認しています…"
                case "synced": return "\(value.artifacts)\(unit)"
                case "not_connected": return "未接続"
                case "not_granted": return "読む許可がありません"
                default: return "取得できませんでした"
                }
            } ?? (sources.isEmpty ? "データを確認後に整理" : "取得を待っています"))
                .foregroundStyle(Palette.muted(dark))
        }.accessibilityElement(children: .combine)
    }

    private func listBinding(_ key: WritableKeyPath<InitialProfileSections, [String]>) -> Binding<String> {
        Binding(get: { draft?[keyPath: key].joined(separator: "\n") ?? "" }, set: { text in
            draft?[keyPath: key] = text.split(separator: "\n").map(String.init)
        })
    }
    private var editFields: some View {
        VStack(alignment: .leading, spacing: Space.cardPadding) {
            edit("現在の仕事（5件まで）", \.focus)
            edit("よく関わる人（12人まで）", \.people)
            edit("直近の優先事項（5件まで）", \.priorities)
            edit("仕事の傾向（3件まで）", \.workPattern)
            Stepper("未完了の項目: \(draft?.openItems ?? 0)件", value: Binding(get: { draft?.openItems ?? 0 }, set: { draft?.openItems = $0 }), in: 0...5000)
        }
    }
    private func edit(_ label: String, _ key: WritableKeyPath<InitialProfileSections, [String]>) -> some View {
        VStack(alignment: .leading) {
            Text(label)
            TextField("1行に1項目", text: listBinding(key), axis: .vertical)
                .textFieldStyle(.roundedBorder).accessibilityLabel(label)
        }
    }
}
