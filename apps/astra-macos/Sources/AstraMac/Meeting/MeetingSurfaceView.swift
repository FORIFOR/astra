import SwiftUI

/// §12.3 Meeting Surface: **Notes first**。Notes を default main canvas にし、Transcript は
/// default closed（開くと右 panel 320–360px）。Markers（重要/決定/ToDo）は 1 click で timestamp mark。
/// Ask Astra は会議を邪魔しない短い panel。AI は Notes を自動で上書きしない。
struct MeetingNote: Identifiable { let id = UUID(); let text: String }
struct MeetingLine: Identifiable {
    let id = UUID(); let time: String; let speaker: String; let text: String
    var translated: String = ""   // §12.3 翻訳は transcript 行の下に secondary line
    var interim: Bool = false     // §12.4 interim は muted 表示
}

struct MeetingSurfaceView: View {
    @Environment(\.colorScheme) private var scheme
    var title: String
    var elapsed: String
    var languages: String              // "JP→EN"
    var notes: [MeetingNote]
    var transcript: [MeetingLine]
    var transcriptOpen: Bool = false   // default closed（on demand で展開）
    private var dark: Bool { scheme == .dark }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Palette.border(dark))
            HStack(spacing: 0) {
                notesPane                                  // main canvas
                if transcriptOpen {
                    Divider().overlay(Palette.border(dark))
                    transcriptPane.frame(width: 340)       // §12.3 右 panel 320–360px
                }
            }
        }
        .background(Palette.canvas(dark))
        .accessibilityIdentifier("meetingSurface")
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text(title).font(.system(size: TypeScale.sectionTitleSize, weight: TypeScale.sectionTitleWeight))
                .foregroundStyle(Palette.text(dark))
            Spacer()
            Circle().fill(Palette.danger(dark)).frame(width: 7, height: 7)
            Text("REC \(elapsed)").font(.system(size: TypeScale.microSize, weight: .semibold)).foregroundStyle(Palette.danger(dark))
            Text(languages).font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
            if !transcriptOpen {
                Text("Transcript >")   // on demand で開く
                    .font(.system(size: TypeScale.microSize, weight: .medium)).foregroundStyle(Palette.accent(dark))
            }
        }
        .padding(.horizontal, Space.cardPadding).padding(.vertical, 10)
    }

    private var notesPane: some View {
        VStack(alignment: .leading, spacing: Space.base) {
            Text("Notes").font(.system(size: TypeScale.microSize, weight: .semibold)).foregroundStyle(Palette.muted(dark))
            ForEach(notes) { n in
                Text(n.text).font(.system(size: TypeScale.bodySize)).foregroundStyle(Palette.text(dark))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("+ メモ").font(.system(size: TypeScale.secondarySize)).foregroundStyle(Palette.muted(dark))
            Spacer()
            HStack(spacing: 8) {   // §12.3 Markers: 1 click で timestamp mark
                ForEach(["重要", "決定", "ToDo"], id: \.self) { m in
                    Text(m).font(.system(size: TypeScale.microSize, weight: .medium))
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(Capsule().fill(Palette.muted(dark).opacity(0.14)))
                        .foregroundStyle(Palette.text(dark))
                }
                Spacer()
                Text("Ask Astra").font(.system(size: TypeScale.microSize, weight: .semibold))
                    .foregroundStyle(Palette.accent(dark))
            }
        }
        .padding(Space.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var transcriptPane: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Transcript").font(.system(size: TypeScale.microSize, weight: .semibold)).foregroundStyle(Palette.muted(dark))
            ForEach(transcript) { l in
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(l.time).font(.system(size: TypeScale.microSize).monospaced()).foregroundStyle(Palette.muted(dark))
                        Text(l.speaker).font(.system(size: TypeScale.microSize, weight: .semibold)).foregroundStyle(Palette.accent(dark))
                    }
                    Text(l.text).font(.system(size: TypeScale.secondarySize))
                        .foregroundStyle(l.interim ? Palette.muted(dark) : Palette.text(dark))  // interim は muted
                    if !l.translated.isEmpty {
                        Text(l.translated).font(.system(size: TypeScale.microSize)).foregroundStyle(Palette.muted(dark))
                    }
                }
            }
            Spacer()
        }
        .padding(Space.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.surface(dark))
    }
}
