# Real screenshot question demonstration

A synthetic English error screen is opened in macOS Preview and captured with the macOS window-capture tool. Astra's actual screenshot detector offers a question entry, the user question is entered through the native interface, and the local model responds. The answer identifies VX-Q7M2, translates Connection interrupted, suggests retrying, and does not claim to know the underlying cause. The native Save action writes the Markdown linked here as DEMO-ANSWER.md.

The 30-second video is an edited montage of real captures. Waiting is trimmed, the tiny recorded Dock offer is held for readability, and the final result is reopened after saving. This is not a real-time latency claim. Request-to-completion in this run was approximately 32 seconds. Titles are editorial overlays; no app text or model answer was substituted.

The first image attempt failed because the isolated demo app and dedicated host pointed at different temporary image handover directories. Configuring the host to the same temporary VisualContext directory resolved it. No production user's data or app draft was changed. Two text-generation demonstrations were rejected for weak output; they are not used as promotional proof. Raw and published file hashes are recorded in video-provenance.json.
