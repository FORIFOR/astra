/**
 * Astra の許可と、Google の scope URL の対応。正本 §21。
 *
 * **翻訳を 1 箇所に置く。**散らばると、要求した scope と記録した許可が
 * ずれても誰も気づかない。「送信を許した覚えはないのに送れる」はこの隙間から生まれる。
 *
 * 対応は片方向ではない。
 *   Astra → Google  … 何を要求するか
 *   Google → Astra  … 実際に何が許されたか（**同意画面で外された分を落とす**）
 */
import type { PermissionScope } from '@astra/contracts';

/** Astra の許可 1 つに要る Google scope。 */
const GRANTS: Readonly<Partial<Record<PermissionScope, string>>> = {
  'email.read': 'https://www.googleapis.com/auth/gmail.readonly',
  // 下書きは compose。send を含まない — これが分割の要。
  'email.draft': 'https://www.googleapis.com/auth/gmail.compose',
  'email.modify': 'https://www.googleapis.com/auth/gmail.modify',
  'email.send': 'https://www.googleapis.com/auth/gmail.send',
  'calendar.read': 'https://www.googleapis.com/auth/calendar.readonly',
  'calendar.write': 'https://www.googleapis.com/auth/calendar.events',
  'contacts.read': 'https://www.googleapis.com/auth/contacts.readonly',
  'drive.read': 'https://www.googleapis.com/auth/drive.readonly',
  'drive.write': 'https://www.googleapis.com/auth/drive.file',
};

/**
 * 広い scope が、狭い許可を含む場合。
 *
 * `gmail.modify` を持っていれば読めるし下書きも作れる。ただし
 * **`gmail.send` は含めない** — modify では送れないので、
 * 含めると「送れるつもり」で送信して失敗する。
 */
const IMPLIED: Readonly<Record<string, readonly PermissionScope[]>> = {
  'https://mail.google.com/': ['email.read', 'email.draft', 'email.modify', 'email.send'],
  'https://www.googleapis.com/auth/gmail.modify': ['email.read', 'email.draft', 'email.modify'],
  'https://www.googleapis.com/auth/gmail.compose': ['email.draft'],
  'https://www.googleapis.com/auth/calendar': ['calendar.read', 'calendar.write'],
  'https://www.googleapis.com/auth/calendar.events': ['calendar.read', 'calendar.write'],
  'https://www.googleapis.com/auth/drive': ['drive.read', 'drive.write'],
};

/**
 * 要求する Google scope。**対応の無い許可は要求しない。**
 *
 * 広い scope が要るときは、それに含まれる狭い scope を落とす。
 * `gmail.modify` と `gmail.readonly` を並べて要求すると、
 * 同意画面に同じ内容が 2 度出て、**利用者が何を許すのか読めなくなる**。
 */
export function googleScopesFor(permissions: readonly PermissionScope[]): string[] {
  const wanted = new Set<string>();
  for (const permission of permissions) {
    const scope = GRANTS[permission];
    if (scope) wanted.add(scope);
  }

  const covered = new Set<PermissionScope>();
  for (const scope of wanted) {
    for (const implied of IMPLIED[scope] ?? []) {
      // 自分自身が代表する許可では消さない
      if (GRANTS[implied] !== scope) covered.add(implied);
    }
  }
  const redundant = new Set(
    [...covered].map((permission) => GRANTS[permission]).filter((s): s is string => Boolean(s)),
  );
  return [...wanted].filter((scope) => !redundant.has(scope)).sort();
}

/**
 * 同意画面の結果から、実際に許された Astra の許可を出す。
 *
 * Google は許された scope を空白区切りで返す。**要求した一覧ではなく、これを使う。**
 * 利用者は同意画面で一部だけ外せる。要求を根拠にすると、
 * 外された権限を持っているつもりで動く。
 */
export function permissionsFromGoogleScopes(granted: string): PermissionScope[] {
  const scopes = new Set(granted.split(/\s+/).filter((s) => s.length > 0));
  const out = new Set<PermissionScope>();

  for (const [permission, scope] of Object.entries(GRANTS) as [PermissionScope, string][]) {
    if (scopes.has(scope)) out.add(permission);
  }
  for (const scope of scopes) {
    for (const implied of IMPLIED[scope] ?? []) out.add(implied);
  }
  return [...out].sort();
}

/** 要求したのに許されなかった分。画面に「何ができないか」を出すために要る。 */
export function withheldPermissions(
  requested: readonly PermissionScope[],
  granted: string,
): PermissionScope[] {
  const allowed = new Set(permissionsFromGoogleScopes(granted));
  return requested.filter((p) => !allowed.has(p));
}
