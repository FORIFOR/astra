// §9 Native Messaging で、この Mac の Astra へ渡す。
//
// 送るのは content script が絞った結果だけ。ページ全文はここにも来ない。
// 送信は「Astra が聞いてきたとき」と「ユーザーがタブを切り替えたとき」に限る。

const HOST = 'com.astra.desktop.context';

let port = null;

function connect() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST);
    port.onDisconnect.addListener(() => {
      port = null;
    });
  } catch (_) {
    port = null;
  }
  return port;
}

async function collectFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'astra.collect' });
  } catch (_) {
    return null;
  }
}

async function push() {
  const payload = await collectFromActiveTab();
  if (!payload) return;
  const p = connect();
  if (!p) return;
  p.postMessage({ type: 'context', payload });
}

chrome.tabs.onActivated.addListener(push);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete') push();
});
