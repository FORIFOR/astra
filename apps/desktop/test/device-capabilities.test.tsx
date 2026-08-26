/**
 * 端末でできること。正本 §25、UI/UX §22。
 *
 * **できないことを、黙って落とさない。**
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DeviceCapabilities } from '../src/settings/DeviceCapabilities.js';
import { capabilities } from '../src/host/tauri.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('what the device says it can do', () => {
  it('names what is available, and what it is using', async () => {
    vi.spyOn(capabilities, 'report').mockResolvedValue([
      {
        capability: 'audio.microphone',
        available: true,
        reason: null,
        implementation: 'MacBook Pro のマイク',
      },
    ]);
    render(<DeviceCapabilities />);
    expect(await screen.findByText('マイク')).toBeTruthy();
    expect(screen.getByText('使えます')).toBeTruthy();
    expect(screen.getByText('MacBook Pro のマイク')).toBeTruthy();
  });

  it('says what to do about something that is not available', async () => {
    vi.spyOn(capabilities, 'report').mockResolvedValue([
      {
        capability: 'stt.local.japanese',
        available: false,
        reason: 'model_not_installed',
        implementation: null,
      },
    ]);
    render(<DeviceCapabilities />);
    expect(await screen.findByText('日本語モデルが入っていません。')).toBeTruthy();
    expect(screen.getByText('使えません')).toBeTruthy();
  });

  it('warns that a meeting will miss the other side', async () => {
    vi.spyOn(capabilities, 'report').mockResolvedValue([
      {
        capability: 'audio.system',
        available: false,
        reason: 'not_implemented',
        implementation: null,
      },
    ]);
    render(<DeviceCapabilities />);
    // 録音が終わってから気付くのが、いちばん悪い
    expect(await screen.findByText(/自分の声だけが記録されます/)).toBeTruthy();
  });

  it('shows the raw reason rather than hiding an unknown one', async () => {
    vi.spyOn(capabilities, 'report').mockResolvedValue([
      { capability: 'stt.local', available: false, reason: 'something_new', implementation: null },
    ]);
    render(<DeviceCapabilities />);
    expect(await screen.findByText('something_new')).toBeTruthy();
  });

  it('does not call an unknown state "unavailable"', async () => {
    // ブラウザでは端末の状態を答えられない
    vi.spyOn(capabilities, 'report').mockResolvedValue(null);
    render(<DeviceCapabilities />);
    await waitFor(() =>
      expect(screen.getByText('この環境では端末の状態を確認できません。')).toBeTruthy(),
    );
    expect(screen.queryByText('使えません')).toBeNull();
  });
});
