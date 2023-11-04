interface RendererOptions {
	context: GPUCanvasContext;
	device: GPUDevice;
	canvasFormat: GPUTextureFormat;
	
	source: string;
	uniformBuffer: GPUBuffer;
	layout: GPUVertexBufferLayout;

	clearColor: [number, number, number, number] | null;
}

const BUFFER_SIZE = 250_000;

class Batch {
	// batch data
	vertices: number[] = [];
	indices: number[] = [];

	// vertex and index memory start position
	vstart = 0;
	istart = 0;

	// vertex and index count
	vcount = 0;
	icount = 0;

	// objects
	device: GPUDevice

	vertexBuffer: GPUBuffer;
	indexBuffer: GPUBuffer;

	constructor(device: GPUDevice) {
		this.device = device

		this.vertexBuffer = this.device.createBuffer({
			label: "Program vertices",
			size: 4 * BUFFER_SIZE,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		});

		this.device.queue.writeBuffer(this.vertexBuffer, 0, new Float32Array(BUFFER_SIZE));

		this.indexBuffer = this.device.createBuffer({
			label: "Program indices",
			size: 4 * BUFFER_SIZE,
			usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
		});

		this.device.queue.writeBuffer(this.indexBuffer, 0, new Uint32Array(BUFFER_SIZE));
	}

	send() {
		this.device.queue.writeBuffer(this.vertexBuffer, this.vstart, new Float32Array(this.vertices));
		this.device.queue.writeBuffer(this.indexBuffer, this.istart, new Uint32Array(this.indices));

		this.vstart += this.vertices.length * 4;
		this.istart += this.indices.length * 4;

		this.vertices = [];
		this.indices = [];
	}
}

class Renderer {
	// batches
	clearColor: [number, number, number, number] | null;

	// objects
	context: GPUCanvasContext;
	device: GPUDevice;

	pipeline: GPURenderPipeline;

	bindGroups: GPUBindGroup[] = [];
	batches: Batch[] = [];

	constructor(options: RendererOptions) {
		this.context = options.context;
		this.device = options.device;
		this.clearColor = options.clearColor;

		const shaderModule = this.device.createShaderModule({
			label: "Program shader",
			code: options.source,
		});

		this.pipeline = this.device.createRenderPipeline({
			label: "Program pipeline",
			layout: "auto",
			vertex: {
				module: shaderModule,
				entryPoint: "vertexMain",
				buffers: [options.layout],
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fragmentMain",
				targets: [{
					format: options.canvasFormat,
				}]
			}
		});
	}

	addGroup(group: GPUBindGroup) {
		this.bindGroups.push(group);
		this.batches.push(new Batch(this.device));
	}

	render() {
		for (let i = 0; i < this.batches.length; i++) {
			let group = this.bindGroups[i];
			let batch = this.batches[i];

			batch.send();

			let colorAttachment: GPURenderPassColorAttachment = {
				view: this.context.getCurrentTexture().createView(),
				loadOp: this.clearColor ? "clear" : "load",
				storeOp: "store",
			}

			if (this.clearColor) colorAttachment.clearValue = this.clearColor;

			const encoder = this.device.createCommandEncoder();
			const pass = encoder.beginRenderPass({
				colorAttachments: [colorAttachment]
			});

			pass.setPipeline(this.pipeline);

			pass.setVertexBuffer(0, batch.vertexBuffer);
			pass.setIndexBuffer(batch.indexBuffer, "uint32");

			pass.setBindGroup(0, group);

			if (batch.icount) pass.drawIndexed(batch.icount);

			pass.end()

			this.device.queue.submit([encoder.finish()]);
		}
	}
}

export { Renderer };
