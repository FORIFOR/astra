import { describe, expect, it } from 'vitest';
import {
  googleScopesFor,
  permissionsFromGoogleScopes,
  withheldPermissions,
} from '../src/scopes.js';

describe('scope translation', () => {
  it('asks for one Google scope per Astra permission', () => {
    expect(googleScopesFor(['email.read', 'calendar.read'])).toEqual([
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ]);
  });

  it('does not ask for anything on behalf of a permission it cannot map', () => {
    expect(googleScopesFor(['microphone.capture'])).toEqual([]);
  });

  it('reads what was actually granted, not what was asked for', () => {
    const requested = ['email.read', 'email.draft', 'email.send'] as const;
    const granted = 'https://www.googleapis.com/auth/gmail.readonly';

    expect(permissionsFromGoogleScopes(granted)).toEqual(['email.read']);
    expect(withheldPermissions(requested, granted)).toEqual(['email.draft', 'email.send']);
  });

  it('does not read gmail.modify as permission to send', () => {
    const allowed = permissionsFromGoogleScopes('https://www.googleapis.com/auth/gmail.modify');
    expect(allowed).toContain('email.read');
    expect(allowed).toContain('email.draft');
    expect(allowed).not.toContain('email.send');
  });

  it('reads the full mail scope as everything', () => {
    expect(permissionsFromGoogleScopes('https://mail.google.com/')).toEqual([
      'email.draft',
      'email.modify',
      'email.read',
      'email.send',
    ]);
  });

  it('drops a scope that a broader one already covers', () => {
    // 同意画面に「メールを読む」が 2 度出ると、何を許すのか読めなくなる
    expect(googleScopesFor(['email.read', 'email.draft', 'email.modify', 'email.send'])).toEqual([
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.send',
    ]);
  });

  it('reads calendar.events as covering reading too', () => {
    expect(permissionsFromGoogleScopes('https://www.googleapis.com/auth/calendar.events')).toEqual([
      'calendar.read',
      'calendar.write',
    ]);
  });

  it('ignores unknown scopes rather than guessing at them', () => {
    expect(permissionsFromGoogleScopes('openid email profile https://unknown/x')).toEqual([]);
  });

  it('treats an empty grant as no permission at all', () => {
    expect(permissionsFromGoogleScopes('')).toEqual([]);
    expect(withheldPermissions(['email.read'], '')).toEqual(['email.read']);
  });
});
