import type { ConnectionDetails } from "../types/registry"
import type { ServerConfig } from "../types/registry"

export async function FormatConfigValues(
  connection: ConnectionDetails, /* Server config details */
  configValues?: ServerConfig
): Promise<ServerConfig> {
  const formattedValues: ServerConfig = {}
  
  if (!connection.configSchema?.properties) {
    return configValues || {}
  }

  const required = new Set(connection.configSchema.required || [])
  
  for (const [key, prop] of Object.entries(connection.configSchema.properties)) {
    const schemaProp = prop as { type?: string; default?: unknown }
    const value = configValues?.[key]
    
    if (value !== undefined || schemaProp.default !== undefined) {
        formattedValues[key] = convertValueToType(
        value ?? schemaProp.default,
        schemaProp.type
      )
    } else if (required.has(key)) {
      throw new Error(`Missing required config value: ${key}`)
    }
  }

  return formattedValues
}

function convertValueToType(value: unknown, type: string | undefined): unknown {
  if (!type || !value) return value
  
  switch (type) {
    case "boolean":
      return String(value).toLowerCase() === "true"
    case "number":
      return Number(value)
    case "integer":
      return Number.parseInt(String(value), 10)
    case "array":
      return Array.isArray(value) ? value :
        String(value).split(",").map(item => item.trim()).filter(Boolean)
    default:
      return value
  }
}
