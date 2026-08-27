/**
 * 承認の返事が通らなかったときの言葉。UI/UX §21「Approval stale」。
 *
 * 「エラーが発生しました」では、何が起きて次に何をすればいいか分からない。
 * 期限切れ・内容の変更は「もう一度確認してください」、決定済みは「もう決まっています」。
 */
import { AstraError } from '@astra/contracts';

export function approvalFailureMessage(error: unknown): string {
  const code = error instanceof AstraError ? error.code : null;
  switch (code) {
    case 'approval.expired':
      return '内容が変更されたため、もう一度確認してください。';
    case 'approval.already_decided':
      return 'この確認は、すでに決まっています。';
    case 'approval.not_found':
      return 'この確認は見つかりませんでした。仕事を開き直してください。';
    default:
      return '確認を送れませんでした。接続を確かめて、もう一度お試しください。';
  }
}
