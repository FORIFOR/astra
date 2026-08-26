-- 会議。正本 §11・§12・§13、Phase 3 実装仕様 §2。
-- migrate:up

CREATE TABLE meetings (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  title                 text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status                text NOT NULL CHECK (status IN ('RECORDING','PAUSED','FINALIZING','COMPLETE','FAILED')),
  language              text NOT NULL,
  -- null なら翻訳しない
  target_language       text,
  -- マイク / システム音声。個別に状態表示する（UI/UX §12.1）
  audio_sources         text[] NOT NULL CHECK (array_length(audio_sources, 1) >= 1),
  -- 参加者への同意確認。**空では始めさせない**ので NOT NULL
  consent_at            timestamptz NOT NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  -- STT が落ちた時刻。録音は続く（AC3-11）
  degraded_at           timestamptz,
  recording_artifact_id uuid REFERENCES artifacts(id),
  bundle_artifact_id    uuid REFERENCES artifacts(id),
  finalize_task_id      uuid REFERENCES tasks(id),
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- 終わっていない会議に終了時刻は無い
  CONSTRAINT meetings_ended_when_done CHECK (status <> 'COMPLETE' OR ended_at IS NOT NULL)
);
CREATE INDEX meetings_recent ON meetings (tenant_id, started_at DESC);
CREATE INDEX meetings_live ON meetings (tenant_id) WHERE status IN ('RECORDING','PAUSED');

-- 確定した transcript。**interim は入らない**（D-24）。
-- final パスは live 行を書き換えず別 pass として積む（D-25）。
CREATE TABLE meeting_segments (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  meeting_id   uuid NOT NULL REFERENCES meetings(id),
  pass         text NOT NULL CHECK (pass IN ('live','final')),
  -- provider が付けた話者番号。名前は meeting_speakers 側
  speaker_tag  int CHECK (speaker_tag > 0),
  text         text NOT NULL,
  start_ms     int NOT NULL CHECK (start_ms >= 0),
  end_ms       int NOT NULL CHECK (end_ms >= start_ms),
  language     text,
  confidence   numeric(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  -- final が置き換えた live segment。live 側は触らない
  supersedes   uuid[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- live segment は誰も置き換えない
  CONSTRAINT meeting_segments_only_final_supersedes
    CHECK (pass = 'final' OR cardinality(supersedes) = 0)
);
CREATE INDEX meeting_segments_ordered ON meeting_segments (meeting_id, pass, start_ms);
-- 同じ時刻の同じ pass を二重に積まない（activity は何度でも再実行され得る）
CREATE UNIQUE INDEX meeting_segments_dedupe ON meeting_segments (meeting_id, pass, start_ms, coalesce(speaker_tag, 0));

-- transcript は記録なので後から書き換えない
CREATE TRIGGER meeting_segments_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON meeting_segments
  FOR EACH STATEMENT EXECUTE FUNCTION astra_deny_mutation();

-- speaker_tag → 表示名。**この会議の中だけ**の対応（正本 §11.3、D-27）。
CREATE TABLE meeting_speakers (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  meeting_id   uuid NOT NULL REFERENCES meetings(id),
  speaker_tag  int NOT NULL CHECK (speaker_tag > 0),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  named_by     uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, speaker_tag)
);

CREATE TABLE translations (
  segment_id      uuid NOT NULL REFERENCES meeting_segments(id),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  meeting_id      uuid NOT NULL REFERENCES meetings(id),
  target_language text NOT NULL,
  text            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 訳し直しても増えない
  PRIMARY KEY (segment_id, target_language)
);
CREATE INDEX translations_by_meeting ON translations (meeting_id, target_language);

-- library の migration が「Phase 3 で付与」と残しておいた FK。ここで閉じる。
ALTER TABLE artifacts
  ADD CONSTRAINT artifacts_source_meeting_fk
  FOREIGN KEY (source_meeting_id) REFERENCES meetings(id);
CREATE INDEX artifacts_by_meeting ON artifacts (tenant_id, source_meeting_id)
  WHERE source_meeting_id IS NOT NULL;

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY meetings_tenant_isolation ON meetings
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE meeting_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_segments FORCE ROW LEVEL SECURITY;
CREATE POLICY meeting_segments_tenant_isolation ON meeting_segments
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE meeting_speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_speakers FORCE ROW LEVEL SECURITY;
CREATE POLICY meeting_speakers_tenant_isolation ON meeting_speakers
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

ALTER TABLE translations ENABLE ROW LEVEL SECURITY;
ALTER TABLE translations FORCE ROW LEVEL SECURITY;
CREATE POLICY translations_tenant_isolation ON translations
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP INDEX IF EXISTS artifacts_by_meeting;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_source_meeting_fk;
DROP TABLE IF EXISTS translations;
DROP TABLE IF EXISTS meeting_speakers;
DROP TABLE IF EXISTS meeting_segments;
DROP TABLE IF EXISTS meetings;
