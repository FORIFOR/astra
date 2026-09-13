/// <reference types="@webgpu/types" />
import { orbShader } from './generated.js';
import { OrbMotion, shouldAnimateOrb } from './motion.js';
import type { VoiceMode } from '../voiceRuntime.js';

export interface OrbSource {
  mode: VoiceMode;
  getInputVolume?: (() => number) | undefined;
  getOutputVolume?: (() => number) | undefined;
}
/** One bounded pass, no network, no microphone access; meters belong to the existing voice runtime. */
export async function createOrbRenderer(
  canvas: HTMLCanvasElement,
  source: () => OrbSource,
  fail: () => void,
  signal: AbortSignal,
): Promise<() => void> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'low-power' });
  if (!adapter || signal.aborted) throw new Error('Orb GPU unavailable');
  const device = await adapter.requestDevice();
  if (signal.aborted) {
    device.destroy();
    throw new Error('Orb detached');
  }
  let uniform: GPUBuffer | undefined;
  let context: GPUCanvasContext | null = null;
  try {
    context = canvas.getContext('webgpu');
    if (!context) throw new Error('Orb canvas unavailable');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });
    const shader = device.createShaderModule({ code: orbShader });
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
    if (signal.aborted) throw new Error('Orb detached');
    uniform = device.createBuffer({
      size: 136 * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    });
    const motion = new OrbMotion();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    let frame = 0;
    let lastDraw = -Infinity;
    let disposed = false;
    const isVisible = (): boolean => visible && !document.hidden;
    function draw(now: number): void {
      if (!context || !uniform || disposed || !isVisible()) return;
      const state = source();
      motion.setMode(state.mode, now);
      const value =
        state.mode === 'speaking'
          ? (state.getOutputVolume?.() ?? 0)
          : (state.getInputVolume?.() ?? 0);
      const values = motion.sample(
        now,
        value,
        reduced.matches || !shouldAnimateOrb(state.mode, true, false),
      );
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(
        1,
        Math.min(512, Math.round(rect.width * Math.min(devicePixelRatio || 1, 2))),
      );
      const h = Math.max(
        1,
        Math.min(512, Math.round(rect.height * Math.min(devicePixelRatio || 1, 2))),
      );
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      values[0] = w;
      values[1] = h;
      device.queue.writeBuffer(uniform, 0, values);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
    function tick(now: number): void {
      frame = 0;
      if (disposed) return;
      try {
        if (now - lastDraw >= 1000 / 30) {
          draw(now);
          lastDraw = now;
        }
        if (shouldAnimateOrb(source().mode, isVisible(), reduced.matches))
          frame = requestAnimationFrame(tick);
      } catch {
        cleanup();
        fail();
      }
    }
    function refresh(): void {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = 0;
      lastDraw = -Infinity;
      // A static state draws once; idle/hidden/reduced-motion has no ongoing animation loop.
      if (isVisible()) frame = requestAnimationFrame(tick);
    }
    const resize = new ResizeObserver(refresh);
    resize.observe(canvas);
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      refresh();
    });
    intersection.observe(canvas);
    document.addEventListener('visibilitychange', refresh);
    reduced.addEventListener('change', refresh);
    canvas.addEventListener('genie-orb-state', refresh);
    function cleanup(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      reduced.removeEventListener('change', refresh);
      canvas.removeEventListener('genie-orb-state', refresh);
      signal.removeEventListener('abort', cleanup);
      uniform?.destroy();
      context?.unconfigure();
      device.destroy();
    }
    signal.addEventListener('abort', cleanup, { once: true });
    void device.lost.then(() => {
      if (!disposed) {
        cleanup();
        fail();
      }
    });
    refresh();
    return cleanup;
  } catch (error) {
    uniform?.destroy();
    context?.unconfigure();
    device.destroy();
    throw error;
  }
}
