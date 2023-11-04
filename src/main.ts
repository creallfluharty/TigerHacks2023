import { vec2 } from "gl-matrix";

// constants
const LINE_WIDTH = 5;

// pseudo-constants
let CANVAS_WIDTH = 0;
let CANVAS_HEIGHT = 0;

// geometry
let vertexCount = 0;

let vertexBatch: number[] = [];
let indexBatch: number[] = [];

let vertexStart = 0;
let indexStart = 0;

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

// pseudo-constant setup
CANVAS_WIDTH = window.innerWidth - 20;
CANVAS_HEIGHT = window.innerHeight - 20;

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

// webgpu object setup
// - buffers
const vertexBuffer = device.createBuffer({
	label: "Program vertices",
	size: 1_000_000,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(vertexBuffer, 0, new Float32Array(1_000_000 / 4));

const indexBuffer = device.createBuffer({
	label: "Program indices",
	size: 1_000_000,
	usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(indexBuffer, 0, new Uint32Array(1_000_000 / 4));

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
let previousPos: vec2 | null = null;

let previousL1: vec2 | null = null;
let previousL2: vec2 | null = null;

// - event handlers
function onMouseDown(e: MouseEvent) {
	leftMouseDown = (e.buttons & 1) === 1;
}

function onMouseUp(e: MouseEvent) {
	leftMouseDown = (e.buttons & 1) === 1;

	previousPos = null;
	previousL1 = null;
	previousL2 = null;
}

function onMouseMove(e: MouseEvent) {
	if (!leftMouseDown) return;

	// get constant variables
	const canvasRect = canvas.getBoundingClientRect();
	const canvasPos = vec2.fromValues(canvasRect.left, canvasRect.top);

	// calculate current mouse state
	let currentPos = vec2.create();
	currentPos = vec2.sub(currentPos, vec2.fromValues(e.x, e.y), canvasPos);

	if (!previousPos) {
		previousPos = currentPos;
		return;
	}

	// calculate line variables
	let direction = vec2.create();
	direction = vec2.sub(direction, currentPos, previousPos);

	let orthoDirection = vec2.fromValues(-direction[1], direction[0]);
	orthoDirection = vec2.normalize(orthoDirection, orthoDirection);

	let l1 = vec2.create();
	let l2 = vec2.create();

	if (previousL1 && previousL2) {
		l1 = previousL1;
		l2 = previousL2;
	} else {
		l1 = vec2.mul(l1, orthoDirection, vec2.fromValues(-LINE_WIDTH, -LINE_WIDTH));
		l1 = vec2.add(l1, previousPos, l1);

		l2 = vec2.mul(l2, orthoDirection, vec2.fromValues(LINE_WIDTH, LINE_WIDTH));
		l2 = vec2.add(l2, previousPos, l2);
	}

	let l3 = vec2.create();
	let l4 = vec2.create();

	l3 = vec2.mul(l3, orthoDirection, vec2.fromValues(-LINE_WIDTH, -LINE_WIDTH));
	l3 = vec2.add(l3, currentPos, l3);

	l4 = vec2.mul(l4, orthoDirection, vec2.fromValues(LINE_WIDTH, LINE_WIDTH));
	l4 = vec2.add(l4, currentPos, l4);

	for (let vertex of [l1, l2, l3, l4]) {
		vertexBatch.push(vertex[0] / CANVAS_WIDTH * 2 - 1);
		vertexBatch.push((CANVAS_HEIGHT - vertex[1]) / CANVAS_HEIGHT * 2 - 1);
	}

	previousL1 = l3;
	previousL2 = l4;

	for (let rawIndex of [0, 1, 2, 1, 2, 3]) {
		indexBatch.push(rawIndex + vertexCount);
	}

	vertexCount += 4;
	previousPos = currentPos;
}

const events = {
	"mouseup":   onMouseUp,
	"mousedown": onMouseDown,
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
	device.queue.writeBuffer(vertexBuffer, vertexStart, new Float32Array(vertexBatch));
	device.queue.writeBuffer(indexBuffer, indexStart, new Uint32Array(indexBatch));

	vertexStart += vertexBatch.length * 4;
	indexStart += indexBatch.length * 4;

	vertexBatch = [];
	indexBatch = [];

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
	pass.drawIndexed(vertexCount / 4 * 6);

	pass.end()

	device.queue.submit([encoder.finish()]);
}

setInterval(drawFrame, 100);

export {};
