// geometry
let vertices = new Float32Array(1000);
let indices = new Uint32Array(1000);

vertices.set([
	-.8, -.8,
	.8, -.8,
	-.8, .8,
	.8, .8,
]);

indices.set([
	0, 1, 2,
	1, 2, 3,
]);

let vertexOffset = 8;
let indexOffset = 6;

// webgpu setup
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

// webgpu object setup
// - buffers
const vertexBuffer = device.createBuffer({
	label: "Program vertices",
	size: vertices.byteLength,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(vertexBuffer, 0, vertices);

const indexBuffer = device.createBuffer({
	label: "Program indices",
	size: indices.byteLength,
	usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(indexBuffer, 0, indices);

// - layouts
const vertexBufferLayout: GPUVertexBufferLayout = {
	arrayStride: 8,
	attributes: [{
		format: "float32x2",
		offset: 0,
		shaderLocation: 0, // pos
	}],
};

// - shaders
const cellShaderModule = device.createShaderModule({
	label: "Program shader",
	code: `
		@vertex
		fn vertexMain(@location(0) pos: vec2f) -> @builtin(position) vec4f {
			return vec4f(pos, 0, 1);
		}

		@fragment
		fn fragmentMain() -> @location(0) vec4f {
			return vec4f(1, 0, 0, 1); // (Red, Green, Blue, Alpha)
		}
	`
});

// - pipeline
const cellPipeline = device.createRenderPipeline({
  label: "Cell pipeline",
  layout: "auto",
  vertex: {
    module: cellShaderModule,
    entryPoint: "vertexMain",
    buffers: [vertexBufferLayout]
  },
  fragment: {
    module: cellShaderModule,
    entryPoint: "fragmentMain",
    targets: [{
      format: canvasFormat
    }]
  }
});

// events
// - event state
let leftMouseDown = false;

// - event handlers
function setLeftMouse(e: MouseEvent) {
	const flags = e.buttons !== undefined ? e.buttons : e.which;
	leftMouseDown = (flags & 1) === 1;
}

function onMouseMove(e: MouseEvent) {
	if (!leftMouseDown) return;

	const canvasRect = canvas.getBoundingClientRect();
	const [canvasX, canvasY] = [canvasRect.left, canvasRect.top];

	let position = [e.x - canvasX, e.y - canvasY];
	let delta = [e.movementX, e.movementY];

	console.log(`position: ${position}\ndelta: ${delta}`);
}

const events = {
	"mouseup":   setLeftMouse,
	"mousedown": setLeftMouse,
	"mousemove": onMouseMove,
};

for (let name in events) {
    if (events.hasOwnProperty(name)) {
		// @ts-ignore
		canvas.addEventListener(name, events[name]);
    }
}

// draw code
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

	pass.setPipeline(cellPipeline);
	pass.setVertexBuffer(0, vertexBuffer);
	pass.setIndexBuffer(indexBuffer, "uint32");
	pass.drawIndexed(6);

	pass.end()

	device.queue.submit([encoder.finish()]);
}

drawFrame();

export {};
