import { vec2, mat3 } from "gl-matrix";
import { Renderer } from "./renderer.ts";

// constants
const LINE_WIDTH = 5;

const MIN_ZOOM = Math.pow(10, -5);
const MAX_ZOOM = Math.pow(10, 5);

const LINE_SHADER_SOURCE = `
@group(0) @binding(0) var<uniform> camera: mat3x3f;

struct VertexOutput {
	@builtin(position) pos: vec4f,
}

@vertex
fn vertexMain(@location(0) pos: vec2f) -> VertexOutput {
	let world = (camera * vec3f(pos, 1)).xy;

	var output: VertexOutput;
	output.pos = vec4f(world, 0, 1);
	return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
	return vec4f(1, 0, 0, 1);
}
`

const TEXTURE_SHADER_SOURCE = `
@group(0) @binding(0) var<uniform> camera: mat3x3f;
@group(0) @binding(1) var active_sampler: sampler;
@group(0) @binding(2) var texture: texture_2d<f32>;

struct VertexIn {
	@location(0) pos: vec2f,
	@location(1) tex_coords: vec2f,
}

struct VertexOut {
	@builtin(position) pos: vec4f,
	@location(0) tex_coords: vec2f,
}

@vertex
fn vertexMain(in: VertexIn) -> VertexOut {
	let world = (camera * vec3f(in.pos, 1)).xy;

	var output: VertexOut;
	output.pos = vec4f(world, 0, 1);
	output.tex_coords = in.tex_coords;
	return output;
}

@fragment
fn fragmentMain(in: VertexOut) -> @location(0) vec4f {
	return textureSample(texture, active_sampler, in.tex_coords);
}
`

// pseudo-constants
let CANVAS_WIDTH = 0;
let CANVAS_HEIGHT = 0;

// state
// - uniforms
let camera = mat3.create();
let inverseCamera = mat3.create();

// - mouse
let mouseFlags = 0;
let lastMouse = vec2.fromValues(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

let leftPreviousPos: vec2 | null = null;

let previousL1: vec2 | null = null;
let previousL2: vec2 | null = null;

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

// renderer setup
const uniformBuffer = device.createBuffer({
  label: "Program uniforms",
  size: 16 * 4,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

let lineRenderer = new Renderer({
	context,
	device,
	canvasFormat,
	source: LINE_SHADER_SOURCE,
	uniformBuffer,
	layout: {
		arrayStride: 8,
		attributes: [{
			format: "float32x2",
			offset: 0,
			shaderLocation: 0, // pos
		}],
	},
	clearColor: [0, 0.5, 0.7, 1]
});

lineRenderer.addGroup(device.createBindGroup({
	layout: lineRenderer.pipeline.getBindGroupLayout(0),
	entries: [{
		binding: 0,
		resource: { buffer: uniformBuffer }
	}],
}));

let textureRenderer = new Renderer({
	context,
	device,
	canvasFormat,
	source: TEXTURE_SHADER_SOURCE,
	uniformBuffer,
	layout: {
		arrayStride: 16,
		attributes: [
			{
				format: "float32x2",
				offset: 0,
				shaderLocation: 0,
			},
			{
				format: "float32x2",
				offset: 8,
				shaderLocation: 1,
			}
		]
	},
	clearColor: null,
});

// utility functions
function setCamera() {
	const uniformArray = new Float32Array([
		camera[0], camera[1], camera[2], 0,
		camera[3], camera[4], camera[5], 0,
		camera[6], camera[7], camera[8], 0,
		0,         0,         0,         1,
	]);

	device.queue.writeBuffer(uniformBuffer, 0, uniformArray);
}

function toWorld(pos: vec2): vec2 {
	return vec2.fromValues(pos[0] / CANVAS_WIDTH * 2 - 1, pos[1] / CANVAS_HEIGHT * 2 - 1);
}

function toView(pos: vec2): vec2 {
	let newPos = vec2.clone(pos);
	vec2.transformMat3(newPos, newPos, inverseCamera);

	return newPos;
}

// events
// - sub event handlers
function drawMouse(currentPos: vec2) {
	if (!leftPreviousPos) {
		leftPreviousPos = currentPos;
		return;
	}

	// calculate line variables
	let direction = vec2.create();
	direction = vec2.sub(direction, currentPos, leftPreviousPos);

	let orthoDirection = vec2.fromValues(-direction[1], direction[0]);
	orthoDirection = vec2.normalize(orthoDirection, orthoDirection);

	let l1 = vec2.create();
	let l2 = vec2.create();

	if (previousL1 && previousL2) {
		l1 = previousL1;
		l2 = previousL2;
	} else {
		vec2.scale(l1, orthoDirection, -LINE_WIDTH);
		vec2.add(l1, leftPreviousPos, l1);

		vec2.scale(l2, orthoDirection, LINE_WIDTH);
		vec2.add(l2, leftPreviousPos, l2);
	}

	let l3 = vec2.create();
	let l4 = vec2.create();

	vec2.scale(l3, orthoDirection, -LINE_WIDTH);
	vec2.add(l3, currentPos, l3);

	vec2.scale(l4, orthoDirection, LINE_WIDTH);
	vec2.add(l4, currentPos, l4);

	for (let vertex of [l1, l2, l3, l4]) {
		let point = toWorld(vec2.fromValues(vertex[0], CANVAS_HEIGHT - vertex[1]))
		point = toView(point);

		lineRenderer.batches[0].vertices.push(point[0]);
		lineRenderer.batches[0].vertices.push(point[1]);
	}

	previousL1 = l3;
	previousL2 = l4;

	for (let rawIndex of [0, 1, 2, 1, 2, 3]) {
		lineRenderer.batches[0].indices.push(rawIndex + lineRenderer.batches[0].vcount);
	}

	lineRenderer.batches[0].vcount += 4;
	lineRenderer.batches[0].icount += 6;
	leftPreviousPos = currentPos;
}

function panMouse(e: MouseEvent) {
	let delta = vec2.fromValues(e.movementX, -e.movementY);

	let normalized = toWorld(delta);
	vec2.add(normalized, normalized, vec2.fromValues(1, 1));
	vec2.scale(normalized, normalized, 1 / camera[0]);

	mat3.translate(camera, camera, normalized);

	inverseCamera = mat3.create();
	mat3.invert(inverseCamera, camera);
}

// - event handlers
function onMouseDown(e: MouseEvent) {
	mouseFlags = e.buttons;
}

function onMouseUp(e: MouseEvent) {
	mouseFlags = e.buttons;

	leftPreviousPos = null;
	previousL1 = null;
	previousL2 = null;
}

function onMouseMove(e: MouseEvent) {
	// get constant variables
	const canvasRect = canvas.getBoundingClientRect();
	const canvasPos = vec2.fromValues(canvasRect.left, canvasRect.top);

	// calculate current mouse state
	let currentPos = vec2.create();
	currentPos = vec2.sub(currentPos, vec2.fromValues(e.x, e.y), canvasPos);

	if ((mouseFlags & 1) === 1) {
		if (e.ctrlKey || ((mouseFlags & 4) === 4)) {
			panMouse(e);
		} else {
			drawMouse(currentPos);
		}
	}

	lastMouse = currentPos;
}

function onWheel(e: WheelEvent) {
	if (!e.deltaY || !lastMouse) return;

	let mouseView = vec2.fromValues(lastMouse[0], CANVAS_HEIGHT - lastMouse[1]);
	mouseView = toView(toWorld(mouseView));

	let cameraPos = vec2.fromValues(camera[2], camera[3 + 2]);

	let mouseOffset = mouseView;
	vec2.sub(mouseOffset, mouseView, cameraPos);

	mat3.translate(camera, camera, mouseOffset);

	const scale = Math.pow(1.01, Math.sign(e.deltaY) * Math.log(Math.abs(e.deltaY)));
	mat3.scale(camera, camera, vec2.fromValues(scale, scale));

	vec2.scale(mouseOffset, mouseOffset, -1);
	mat3.translate(camera, camera, mouseOffset);
	
	let factor = 1;

	if (camera[0] < MIN_ZOOM) {
		factor = MIN_ZOOM / camera[0];
	} else if (camera[0] > MAX_ZOOM) {
		factor = MAX_ZOOM / camera[0];
	}

	if (factor != 1) {
		vec2.scale(mouseOffset, mouseOffset, -1);
		mat3.translate(camera, camera, mouseOffset);

		mat3.scale(camera, camera, vec2.fromValues(factor, factor));

		vec2.scale(mouseOffset, mouseOffset, -1);
		mat3.translate(camera, camera, mouseOffset);
	}

	inverseCamera = mat3.create();
	mat3.invert(inverseCamera, camera);
}

const events = {
	"mouseup":   onMouseUp,
	"mousedown": onMouseDown,
	"mousemove": onMouseMove,
	"wheel":     onWheel,
};

for (let name in events) {
    if (events.hasOwnProperty(name)) {
		// @ts-ignore
		canvas.addEventListener(name, events[name]);
    }
}

// non-canvas events
function onKey(e: KeyboardEvent) {
	if (e.key == "o") {
		// trigger input tag to get image
		let input = document.getElementById("fakeinput")!;
		input.dispatchEvent(new PointerEvent("click"));
	}
}

async function onInputChange() {
	let input = (document.getElementById("fakeinput") as HTMLInputElement)!;
	let file = input.files?.item(0);

	if (!file) throw new Error("Image input cancelled!");

	let image = await createImageBitmap(file);

	const textureDescriptor: GPUTextureDescriptor = {
		size: {
			width: image.width,
			height: image.height,
		},
		format: "rgba8unorm",
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
	};

	// texture resources
	const sampler = device.createSampler();

	const texture = device.createTexture(textureDescriptor);
	device.queue.copyExternalImageToTexture({ source: image }, { texture }, textureDescriptor.size);

	// bind group
	const bindGroup = device.createBindGroup({
		layout: textureRenderer.pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: sampler },
			{ binding: 2, resource: texture.createView() },
		]
	});

	textureRenderer.addGroup(bindGroup);
	let batchIndex = textureRenderer.batches.length - 1;

	// geometry
	let vertices = [
		lastMouse[0],               lastMouse[1],                0, 0,
		lastMouse[0] + image.width, lastMouse[1],                1, 0,
		lastMouse[0],               lastMouse[1] + image.height, 0, 1,
		lastMouse[0] + image.width, lastMouse[1] + image.height, 1, 1,
	]

	for (let i = 0; i < vertices.length; i += 2) {
		let point = vec2.fromValues(vertices[i], vertices[i + 1]);

		// not a texture coordinate
		if ((i - 2) % 4) {
			point = toWorld(vec2.fromValues(point[0], CANVAS_HEIGHT - point[1]))
			point = toView(point);
		}

		textureRenderer.batches[batchIndex].vertices.push(point[0]);
		textureRenderer.batches[batchIndex].vertices.push(point[1]);
	}

	for (let index of [0, 1, 2, 1, 2, 3]) {
		textureRenderer.batches[batchIndex].indices.push(textureRenderer.batches[batchIndex].vcount + index);
	}

	textureRenderer.batches[batchIndex].vcount += 4;
	textureRenderer.batches[batchIndex].icount += 6;
}

document.addEventListener("keydown", onKey);
document.getElementById("fakeinput")!.addEventListener("change", onInputChange);

function frame() {
	setCamera();

	lineRenderer.render();
	textureRenderer.render();
}

setInterval(frame, 100);

export {};
