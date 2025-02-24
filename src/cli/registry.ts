import fetch from 'node-fetch';
import { config as dotenvConfig } from 'dotenv';
import { StdioConnection, StdioConnectionSchema, ServerConfig, RegistryServer } from './types/registry';

// Load environment variables from .env file
dotenvConfig();

export class RegistryClient {
  private readonly endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || process.env.REGISTRY_ENDPOINT || "https://registry.smithery.ai";
    if (!this.endpoint) {
      throw new Error('REGISTRY_ENDPOINT environment variable is not set');
    }
  }

  async resolvePackage(packageName: string): Promise<RegistryServer> {
    try {
      const response = await fetch(`${this.endpoint}/resolve/${packageName}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Package resolution failed with status ${response.status}: ${errorText}`
        );
      }

      const data = await response.json();
      
      if (!data.success || !data.result) {
        throw new Error('Invalid resolution response format');
      }
      
      return data.result.resolvedPackage;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to resolve package: ${error.message}`);
      }
      throw error;
    }
  }

  async fetchConnection(packageName: string, config: ServerConfig): Promise<StdioConnection> {
    try {
      const requestBody = {
        connectionType: 'stdio',
        config,
      };

      const response = await fetch(`${this.endpoint}/servers/${packageName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Registry request failed with status ${response.status}: ${errorText}`
        );
      }

      const data = await response.json();
      
      // Extract the result field before validation
      if (!data.success || !data.result) {
        throw new Error('Invalid server response format');
      }
      
      return StdioConnectionSchema.parse(data.result);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch server metadata: ${error.message}`);
      }
      throw error;
    }
  }
} 