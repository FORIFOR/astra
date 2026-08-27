/**
 * 部品の見本帳。**開発ビルドだけ**（`#/gallery?only=work` など）。
 *
 * 仕様（UI/UX Appendix A）の部品を、状態ごとに作り物のデータで描く。
 * 実機やサーバ無しに screenshot で仕様と突き合わせるためにある。本番には入らない。
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { ThemeProvider } from '../state/ThemeProvider.js';
import { ShellProvider } from '../state/ShellProvider.js';
import { WorkCard } from '../work/WorkCard.js';
import { WorkDetail } from '../work/WorkDetail.js';
import { ReceiptList } from '../work/Receipts.js';
import { EvidenceLedgerView } from '../work/EvidenceLedger.js';
import { ContextLens } from '../dock/ContextLens.js';
import { PermissionAsk } from '../dock/PermissionAsk.js';
import { ResultPreview } from '../dock/ResultPreview.js';
import { RecordingIndicator } from '../meeting/RecordingIndicator.js';
import { MeetingSurface } from '../meeting/MeetingSurface.js';
import { TranscriptPanel } from '../meeting/TranscriptPanel.js';
import { Finalizing } from '../meeting/Finalizing.js';
import { MeetingArtifact } from '../meeting/MeetingArtifact.js';
import { StartConfirmation } from '../meeting/StartConfirmation.js';
import { InstallConsent } from '../apps/InstallConsent.js';
import { AppDetail } from '../apps/AppDetail.js';
import { HomePage } from '../pages/Home.js';
import { LibraryPage } from '../pages/Library.js';
import * as fx from './fixtures.js';
import '../shell/shell.css';
import '../work/work.css';
import '../dock/dock.css';
import '../meeting/meeting.css';
import '../apps/apps.css';
import '../home/home.css';
import './gallery.css';

const SECTIONS = [
  'work',
  'context',
  'approval',
  'evidence',
  'meeting',
  'artifact',
  'apps',
  'home',
  'library',
] as const;
type Section = (typeof SECTIONS)[number];

export function gallerySection(hash: string): Section | null {
  const query = hash.split('?')[1];
  const only = query ? new URLSearchParams(query).get('only') : null;
  return (SECTIONS as readonly string[]).includes(only ?? '') ? (only as Section) : null;
}

function Block({
  title,
  children,
  width,
}: {
  title: string;
  children: ReactNode;
  width?: number;
}): ReactElement {
  return (
    <section className="astra-gallery__block" style={width ? { width } : undefined}>
      <h3 className="astra-gallery__title">{title}</h3>
      {children}
    </section>
  );
}

function ContextDemo(): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [sources, setSources] = useState(fx.contextSources);
  return (
    <>
      <Block title="ContextLens — compact（chips 3 + “+N”）" width={640}>
        <div className="astra-dock astra-gallery__dock">
          <ContextLens
            sources={sources}
            expanded={false}
            onToggle={() => setExpanded(true)}
            onRemove={(id) => setSources((s) => s.filter((x) => x.id !== id))}
            onWhy={(id) => setWhy(sources.find((s) => s.id === id)?.reason ?? null)}
            explanation={why}
          />
        </div>
      </Block>
      <Block title="ContextLens — full（Why this? / remove / sensitivity）" width={640}>
        <div className="astra-dock astra-gallery__dock">
          <ContextLens
            sources={sources}
            expanded={true}
            onToggle={() => setExpanded(!expanded)}
            onRemove={(id) => setSources((s) => s.filter((x) => x.id !== id))}
            onWhy={(id) => setWhy(sources.find((s) => s.id === id)?.reason ?? null)}
            explanation={why}
          />
        </div>
      </Block>
      <Block title="PermissionSheet — purpose-first" width={560}>
        <div className="astra-dock astra-gallery__dock">
          <PermissionAsk missing={['calendar', 'screen_recording']} />
        </div>
      </Block>
      <Block title="Dock result — 短い答え" width={560}>
        <div className="astra-dock astra-gallery__dock">
          <ResultPreview
            text={'明日 10:00 の A社 商談は会議室 B です。\n参加: 田中様、伊藤様、山田。'}
          />
        </div>
      </Block>
    </>
  );
}

function MeetingDemo(): ReactElement {
  const [notes, setNotes] = useState('価格条件について\n・導入時期は10月\n・先方は初期費用を懸念');
  const view = { lines: fx.transcript, ended: false, finalizeTaskId: null };
  const noop = (): void => undefined;
  return (
    <>
      <Block title="StartConfirmation（§12.1）" width={480}>
        <StartConfirmation onCancel={noop} onStart={noop} />
      </Block>
      <Block title="RecordingIndicator — recording / paused / degraded（§12.2）" width={480}>
        <div className="astra-gallery__stack">
          <RecordingIndicator
            state="recording"
            title="A社 新規提案"
            elapsedMs={18 * 60_000 + 42_000}
            speakers={3}
            onPause={noop}
            onStop={noop}
          />
          <RecordingIndicator
            state="paused"
            title="A社 新規提案"
            elapsedMs={18 * 60_000 + 42_000}
            speakers={3}
            onPause={noop}
            onStop={noop}
          />
          <RecordingIndicator
            state="degraded"
            title="A社 新規提案"
            elapsedMs={18 * 60_000 + 42_000}
            speakers={3}
            onPause={noop}
            onStop={noop}
          />
        </div>
      </Block>
      <Block title="MeetingSurface — live, notes first（§12.3）" width={880}>
        <MeetingSurface
          title="A社 新規提案"
          view={view}
          elapsedMs={18 * 60_000 + 42_000}
          state="recording"
          notes={notes}
          speakerNames={fx.speakerNames}
          onNotesChange={setNotes}
          onMark={noop}
          onNameSpeaker={noop}
          onPause={noop}
          onStop={noop}
        />
      </Block>
      <Block title="TranscriptPanel — partial / final / translated（§12.4）" width={360}>
        <TranscriptPanel lines={fx.transcript} names={fx.speakerNames} />
      </Block>
      <Block title="Finalizing（§12.5）" width={480}>
        <Finalizing title="A社 新規提案" completedSteps={2} onOpenWork={noop} />
      </Block>
    </>
  );
}

export function GalleryApp(): ReactElement {
  const section = gallerySection(globalThis.location?.hash ?? '');
  const noop = (): void => undefined;
  return (
    <ThemeProvider>
      <ShellProvider>
        <main className="astra-gallery" data-section={section ?? 'all'}>
          {(section === null || section === 'work') && (
            <>
              <Block title="WorkCard — active（§6 semantic progress）" width={620}>
                <WorkCard view={fx.workActive} onOpen={noop} onStop={noop} />
              </Block>
              <Block title="WorkCard — waiting approval（§6.2 attention state）" width={620}>
                <WorkCard view={fx.workWaiting} onApprove={noop} onReject={noop} />
              </Block>
              <Block title="WorkCard — retrying step" width={620}>
                <WorkCard view={fx.workRetrying} />
              </Block>
              <Block title="WorkCard — done" width={620}>
                <WorkCard view={fx.workDone} onOpen={noop} />
              </Block>
              <Block title="WorkCard — failed（§21 影響と次の選択肢）" width={620}>
                <WorkCard view={fx.workFailed} />
              </Block>
              <Block
                title="WorkDetail — Overview / Progress / Outputs / Evidence / Activity（§9.2）"
                width={880}
              >
                <WorkDetail view={fx.workActive} taskId="t1" sources={fx.contextSources} />
              </Block>
            </>
          )}
          {(section === null || section === 'context') && <ContextDemo />}
          {(section === null || section === 'approval') && (
            <Block title="ActionReceipt — success / reversible / read（§14.1・§22）" width={640}>
              <ReceiptList receipts={fx.receipts} />
            </Block>
          )}
          {(section === null || section === 'evidence') && (
            <>
              <Block title="EvidenceSummary — L0（§15 / §13.2）" width={640}>
                <EvidenceLedgerView ledger={fx.ledger} />
              </Block>
              <Block title="EvidenceInspector — L1 / L2 / L3 opened" width={640}>
                <EvidenceLedgerView ledger={fx.ledger} initialLevel="L3" />
              </Block>
            </>
          )}
          {(section === null || section === 'meeting') && <MeetingDemo />}
          {(section === null || section === 'artifact') && (
            <Block title="Meeting Artifact — citation jump（§12.6 / AC-09）" width={880}>
              <MeetingArtifact
                bundle={fx.meetingBundle}
                segments={fx.meetingSegments}
                names={fx.speakerNames}
              />
            </Block>
          )}
          {(section === null || section === 'apps') && (
            <>
              <Block title="AppDetail（§11.1）" width={420}>
                <AppDetail plugin={fx.pack} onInstall={noop} onUninstall={noop} />
              </Block>
              <Block title="PermissionSheet — install consent（§22）" width={480}>
                <InstallConsent plugin={fx.pack} onCancel={noop} onInstall={noop} />
              </Block>
            </>
          )}
          {(section === null || section === 'library') && (
            <Block title="Library — filters / card metadata / lineage（§10）" width={1200}>
              <LibraryPage artifacts={fx.artifacts} tasks={fx.tasks} selectedId="art-v5" />
            </Block>
          )}
          {(section === null || section === 'home') && (
            <Block title="Home — Attention 3 / Active / Recent（§8）" width={880}>
              <HomePage brief={fx.brief} displayName="山田" onDismiss={noop} onAsk={noop} />
            </Block>
          )}
        </main>
      </ShellProvider>
    </ThemeProvider>
  );
}
