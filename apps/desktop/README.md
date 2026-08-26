# @astra/desktop

Tauri v2 + React desktop client. Owns the Local Control Plane
(product spec §16.1) and the 4-tab shell (§2).

## 状態

UI-0（4 タブ shell）と UI-1（Task Dock + Context Lens）まで実装済み。

| window | 役割                                                      |
| ------ | --------------------------------------------------------- |
| `main` | Workspace shell。Home / Work / Library / Apps             |
| `dock` | Task Dock。装飾なし・透過・常に最前面。`index.html#/dock` |

Bundle identifier: `com.astra.desktop`。

```sh
pnpm dev                      # web だけを Vite で
pnpm tauri dev                # Tauri で両方の window を起動
pnpm test                     # Dock と shell の UI テスト
cd src-tauri && cargo test    # 配置計算と位置記憶
```

Dock の geometry は `packages/ui-kit/src/tokens/dock.ts` が正で、
Rust の定数は `pnpm gen:dock-geometry` が生成する。手で両方を書き換えない。

移植候補は `../../../deepnote-desktop/src-tauri/src/` —
`docs/spec/phase-0-implementation-spec.md` §12 を参照。
