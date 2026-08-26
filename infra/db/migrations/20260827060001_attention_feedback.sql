-- 「これは出さないで」を覚える。UI/UX §16。
--
-- §16: 「dismiss feedback を ranker 改善に使うが、
--        ユーザーの明示拒否を長期尊重する」
--
-- **覚えない dismiss は、拒否ではなく無視。**
-- 押した直後に消えても、次の brief でまた出てくるなら、
-- 利用者から見れば拒否は届いていない。
-- migrate:up

CREATE TABLE attention_feedback (
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  -- brief の item id（`commitment:<uuid>` / `task:<uuid>` / `meeting:<uuid>`）。
  -- 表を跨ぐので参照制約は張らない。**消えた対象の記録も残す**
  -- （消えたことを理由に拒否を忘れない）。
  item_id    text NOT NULL CHECK (item_id <> ''),
  -- later: しばらく出さない（ranker の材料にもする）
  -- never: 二度と出さない（明示拒否。長期尊重する）
  verdict    text NOT NULL CHECK (verdict IN ('later','never')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 同じ相手への最後の意思表示を 1 行で持つ。later のあと never も言える。
  PRIMARY KEY (tenant_id, user_id, item_id)
);

-- brief を組むたびに「この人がいま断っているもの」を引く
CREATE INDEX attention_feedback_lookup
  ON attention_feedback (tenant_id, user_id, created_at DESC);

ALTER TABLE attention_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE attention_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY attention_feedback_tenant_isolation ON attention_feedback
  USING (tenant_id = astra_current_tenant())
  WITH CHECK (tenant_id = astra_current_tenant());

-- migrate:down
DROP TABLE attention_feedback;
