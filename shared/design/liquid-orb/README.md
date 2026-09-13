# Genie liquid orb

Renderer from [LerSent001/orb](https://github.com/LerSent001/orb), commit `047c58cc93587c21dac12183fc0fb1e4101c8e1a` (MIT, Copyright 2026 LerSent001). LICENSE is distributed with the source. Toolcraft editor UI is not included.

The two shader files are unmodified upstream exports. `preset.json` preserves the user's Siri Wave URL values. `scripts/gen-liquid-orb.mjs` generates the native inline Metal source and the uniform seeds used by both clients; no editor page, remote code, telemetry, or network request is loaded at runtime.

Genie adds input/output meter modulation, activation/settling transitions, bounded 30fps rendering, hidden/idle/reduced-motion suspension, and graceful static fallback. Only the Siri pipeline is constructed, not the unused particle pipelines. Numeric offsets follow upstream src/orb-uniforms.ts. Transparent canvas surrounds the orb.

The native adapter adds `using metal::discard_fragment` before compiling: the upstream ribbon entry omits this namespace and otherwise fails compilation on the shipping Mac. Shader math is unchanged.

The static fallback is a real frame rendered by the same Metal shader, embedded in both clients. Native windows pause when hidden, minimized or detached (not on strict occlusion, which is unreliable in window-capture sessions). Web rendering also pauses when its document or orb element is offscreen.
