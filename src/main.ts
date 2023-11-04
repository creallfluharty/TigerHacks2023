function onMouseMove(e: MouseEvent) {
	if (e.button != 1) return;

	let position = [e.x, e.y];
	let delta = [e.movementX, e.movementY];
}

const canvas = document.querySelector("canvas")!;

if (!navigator.gpu) throw new Error("WebGPU not supported!");

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No GPU adapter found!");

const device = await adapter.requestDevice();

const context = canvas.getContext("webgpu")!;
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

context.configure({
  device: device,
  format: canvasFormat,
});

function drawFrame() {
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "clear",
			clearValue: [0, 0.5, 0.7, 1],
			storeOp: "store",
		}]
	});

	pass.end()

	device.queue.submit([encoder.finish()]);
}

drawFrame();

export {};
