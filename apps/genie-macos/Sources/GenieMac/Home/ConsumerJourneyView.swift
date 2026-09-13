import AppKit
import SwiftUI

struct ConsumerJourneyView: View {
    @Environment(\.colorScheme) private var scheme
    @State var draft: ConsumerJourneyDraft
    var onClose: (ConsumerJourneyDraft) -> Void
    var onResearch: (String, ConsumerPlanningMode) -> Bool
    @State private var notice = ""
    private var dark: Bool { scheme == .dark }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.cardPadding) {
            HStack {
                Label(draft.kind.title + "の準備", systemImage: draft.kind.symbol)
                    .font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                Spacer()
                ProbeButton(id: "consumerClose", action: { onClose(draft) }) { Image(systemName: "xmark") }
                    .buttonStyle(.plain).accessibilityLabel("閉じる")
                    .accessibilityIdentifier("consumerClose")
                    .keyboardShortcut(.cancelAction)
            }
            Text("希望を整理して、公式サービスで予約・注文を確定します。")
                .font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
            if draft.kind == .travel {
                Text("旅程案はAI、最新情報はWeb検索を使います。結果はWorkに保存します。")
                    .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                    .fixedSize(horizontal: false, vertical: true)
                Text("入力した条件を送信します。接続先の料金が適用されます。")
                    .font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                    .fixedSize(horizontal: false, vertical: true)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Space.cardPadding) {
                    field(draft.subjectLabel, text: $draft.subject, id: "consumerSubject")
                    if draft.kind != .delivery {
                        field(draft.areaLabel, text: $draft.area, id: "consumerArea")
                    }
                    field(draft.datesLabel, text: $draft.dates, id: "consumerDates")
                    if draft.kind != .delivery {
                        Stepper("人数：\(draft.people)人", value: $draft.people, in: 1...20)
                            .accessibilityIdentifier("consumerPeople")
                    }
                    field("合計予算の上限（円・任意）", text: $draft.budget, id: "consumerBudget")
                    field(draft.kind == .delivery ? "カスタマイズの希望（任意）" : "希望・こだわり（任意）", text: $draft.preferences, id: "consumerPreferences")
                    if !draft.request.isEmpty {
                        field("依頼メモ", text: $draft.request, id: "consumerRequest")
                    }
                    if draft.kind == .delivery {
                        Text("住所・電話番号・支払い方法は公式サービスで入力します。")
                            .font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
                    }
                }.padding(.trailing, Space.compact)
            }
            Divider()
            VStack(alignment: .leading, spacing: Space.base) {
                if draft.kind == .travel {
                    HStack {
                        Button("旅程案を作る") { prepare(.itinerary) }
                            .buttonStyle(.borderedProminent)
                            .accessibilityIdentifier("consumerItinerary")
                        Button("最新情報を調べる") { prepare(.research) }
                            .accessibilityIdentifier("consumerResearch")
                    }
                    .disabled(draft.validationIssue != nil)
                }
                Text("予約・注文は未確定です")
                    .font(.system(size: TypeScale.secondarySize, weight: .medium))
                Text(draft.kind.finalChecks)
                    .font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
                    .fixedSize(horizontal: false, vertical: true)
                if let issue = draft.validationIssue {
                    Text(issue).font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                }
                if !notice.isEmpty {
                    Text(notice).font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
                        .accessibilityIdentifier("consumerNotice")
                }
                HStack {
                    Button("条件をコピー") {
                        NSPasteboard.general.clearContents()
                        let copied = NSPasteboard.general.setString(draft.memo, forType: .string)
                        notice = copied ? "希望条件をコピーしました。" : "コピーできませんでした。もう一度お試しください。"
                    }
                    .disabled(draft.validationIssue != nil)
                    .accessibilityIdentifier("consumerCopy")
                    Spacer()
                    if draft.kind == .travel { officialButton.buttonStyle(.bordered) }
                    else { officialButton.buttonStyle(.borderedProminent) }
                }
            }
        }
        .font(.system(size: TypeScale.bodySize))
        .foregroundStyle(Palette.text(dark))
        .padding(Space.largePadding)
        .frame(width: 620, height: 680)
        .background(Palette.canvas(dark))
        .onDisappear { ConsumerJourneyStore.shared.keep(draft) }
        .accessibilityIdentifier("consumerJourney")
    }

    private var officialButton: some View {
        ProbeButton(id: "consumerOfficialSite", action: {
            ConsumerJourneyStore.shared.keep(draft)
            notice = NSWorkspace.shared.open(draft.kind.officialURL)
                ? "公式サービスを開きました。条件は自動入力されません。"
                : "公式サービスを開けませんでした。ブラウザの設定を確認してください。"
        }) { Text(draft.kind.handoffLabel) }
    }

    private func prepare(_ mode: ConsumerPlanningMode) {
        guard let prompt = mode == .itinerary ? draft.travelItineraryRequest : draft.travelResearchRequest else { return }
        if onResearch(prompt, mode) { onClose(draft) }
        else { notice = "開始できませんでした。接続や実行中の仕事を確認してください。条件は残しています。" }
    }

    private func field(_ label: String, text: Binding<String>, id: String) -> some View {
        VStack(alignment: .leading, spacing: Space.compact) {
            Text(label).font(.system(size: TypeScale.secondarySize))
            TextField(label, text: text, axis: .vertical)
                .textFieldStyle(.roundedBorder).lineLimit(1...3)
                .accessibilityLabel(label).accessibilityIdentifier(id)
        }
    }
}
