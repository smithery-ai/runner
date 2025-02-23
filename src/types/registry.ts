import { z } from "zod"

// Server Resolution (GET)
// Registry GET response
export interface RegistryServer {
	qualifiedName: string
	displayName: string
	connections: Array<ConnectionDetails>
}

// Server Configuration Schema
export const JSONSchemaSchema: z.ZodType = z.lazy(() =>
	z.object({
		type: z.string().optional(),
		properties: z.record(JSONSchemaSchema).optional(),
		items: JSONSchemaSchema.optional(),
		required: z.array(z.string()).optional(),
		description: z.string().optional(),
		default: z.unknown().optional(),
	}),
)

export type JSONSchema = z.infer<typeof JSONSchemaSchema>

// Connection Details 
export const ConnectionDetailsSchema = z.union([
	z.object({
		type: z.literal("stdio"),
		configSchema: JSONSchemaSchema.optional(),
		exampleConfig: z.record(z.any()).optional(),
		published: z.boolean().optional(),
		stdioFunction: z.string().optional(),
	}),
	z.object({
		type: z.literal("ws"),
		deploymentUrl: z.string().url(),
		configSchema: JSONSchemaSchema.optional(),
		exampleConfig: z.record(z.any()).optional(),
	}),
])

export type ConnectionDetails = z.infer<typeof ConnectionDetailsSchema>

// Server Configuration (POST)
// Server Configuration key value pairs
export interface ServerConfig {
	[key: string]: unknown;
  } 

// STDIO server connection
export const StdioConnectionSchema = z.object({
	command: z.string().describe("The executable to run to start the server."),
	args: z
		.array(z.string())
		.optional()
		.describe("Command line arguments to pass to the executable."),
	env: z
		.record(z.string(), z.string())
		.optional()
		.describe("The environment to use when spawning the process."),
})

export type StdioConnection = z.infer<typeof StdioConnectionSchema>

// WS server connection
export const WSConnectionSchema = z.object({
	type: z.literal("ws"),
	url: z.string().url(),
	config: z.record(z.any()).optional(),
})

export type WSConnection = z.infer<typeof WSConnectionSchema>

// Configured server
export type ConfiguredServer = StdioConnection | WSConnection

