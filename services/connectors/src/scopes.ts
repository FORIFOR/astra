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

// ------------------------------------------------------------ Microsoft

/**
 * Astra の許可 1 つに要る Microsoft Graph scope。**読むものだけ。**
 *
 * Work Context は読むだけで成り立つ。送る・書くは別の許可で、
 * 別の同意画面を通す（正本 §21、Work Context 仕様「read-only scopes first」）。
 */
const MICROSOFT_GRANTS: Readonly<Partial<Record<PermissionScope, string>>> = {
  'email.read': 'Mail.Read',
  'email.send': 'Mail.Send',
  'email.modify': 'Mail.ReadWrite',
  'calendar.read': 'Calendars.Read',
  'calendar.write': 'Calendars.ReadWrite',
  'contacts.read': 'Contacts.Read',
  'tasks.read': 'Tasks.Read',
  'drive.read': 'Files.Read',
  'drive.write': 'Files.ReadWrite',
};

const MICROSOFT_IMPLIED: Readonly<Record<string, readonly PermissionScope[]>> = {
  'Mail.ReadWrite': ['email.read', 'email.modify'],
  'Calendars.ReadWrite': ['calendar.read', 'calendar.write'],
  'Files.ReadWrite': ['drive.read', 'drive.write'],
  'Tasks.ReadWrite': ['tasks.read'],
};

/**
 * refresh token を貰うために要る。Google の `access_type=offline` にあたる。
 * 無いと 1 時間で黙って切れ、Work Context の同期が止まる。
 */
export const MICROSOFT_OFFLINE_SCOPE = 'offline_access';

/** 要求する Microsoft Graph scope。対応の無い許可は要求しない。 */
export function microsoftScopesFor(permissions: readonly PermissionScope[]): string[] {
  const wanted = new Set<string>();
  for (const permission of permissions) {
    const scope = MICROSOFT_GRANTS[permission];
    if (scope) wanted.add(scope);
  }
  const covered = new Set<PermissionScope>();
  for (const scope of wanted) {
    for (const implied of MICROSOFT_IMPLIED[scope] ?? []) {
      if (MICROSOFT_GRANTS[implied] !== scope) covered.add(implied);
    }
  }
  const redundant = new Set(
    [...covered].map((p) => MICROSOFT_GRANTS[p]).filter((s): s is string => Boolean(s)),
  );
  const out = [...wanted].filter((scope) => !redundant.has(scope));
  return out.length === 0 ? [] : [...out, MICROSOFT_OFFLINE_SCOPE].sort();
}

/** 同意画面の結果（空白区切り）から、実際に許された Astra の許可を出す。 */
export function permissionsFromMicrosoftScopes(granted: string): PermissionScope[] {
  const scopes = new Set(granted.split(/\s+/).filter((s) => s.length > 0));
  const out = new Set<PermissionScope>();
  for (const [permission, scope] of Object.entries(MICROSOFT_GRANTS) as [
    PermissionScope,
    string,
  ][]) {
    if (scopes.has(scope)) out.add(permission);
  }
  for (const scope of scopes) {
    for (const implied of MICROSOFT_IMPLIED[scope] ?? []) out.add(implied);
  }
  return [...out].sort();
}
