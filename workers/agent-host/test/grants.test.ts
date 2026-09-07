/** 許可は cloud の接続記録から。宣言でも要求でもなく、実際に許された scope だけ。 */
import { describe, expect, it } from 'vitest';
import { grantsFromConnections, knownPluginIds, mergeGrants } from '../src/grants.js';

describe('grants from connection records', () => {
  it('maps live provider scopes to Astra permissions, per plugin, ignoring dead connections', () => {
    const grants = grantsFromConnections([
      {
        pluginId: 'com.astra.gmail',
        connectorId: 'gmail',
        provider: 'google',
        state: 'CONNECTED',
        grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      },
      {
        pluginId: 'com.astra.gmail',
        connectorId: 'gmail-actions',
        provider: 'google',
        state: 'REVOKED',
        grantedScopes: ['https://www.googleapis.com/auth/gmail.send'],
      },
      {
        pluginId: 'com.astra.outlook',
        connectorId: 'outlook',
        provider: 'microsoft',
        state: 'CONNECTED',
        grantedScopes: ['Mail.Read', 'Calendars.Read', 'offline_access'],
      },
    ]);
    expect(grants).toEqual({
      'com.astra.gmail': ['email.read'],
      'com.astra.outlook': ['calendar.read', 'email.read'],
    });
  });

  it('lets the environment add, never remove', () => {
    const merged = mergeGrants(
      { 'com.astra.gmail': ['email.read'] },
      { 'com.astra.gmail': ['email.draft'], 'com.astra.microsoft-todo': ['tasks.read'] },
    );
    expect(merged).toEqual({
      'com.astra.gmail': ['email.draft', 'email.read'],
      'com.astra.microsoft-todo': ['tasks.read'],
    });
  });

  it('asks the cloud about every plugin the device can run', () => {
    expect(knownPluginIds().sort()).toEqual([
      'com.astra.gmail',
      'com.astra.google-calendar',
      'com.astra.microsoft-todo',
      'com.astra.outlook',
    ]);
  });
});
