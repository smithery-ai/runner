import { RegistryClient } from './registry';
import { ServerConfig } from '../types/registry';
import { createRunner } from './runner';

const registryClient = new RegistryClient();

export async function runCommand(args: string[]) {
    if (args.length < 2 || args[1] !== '--config') {
        throw new Error('Missing required --config parameter');
    }

    const packageName = args[0];
    const configString = args[2];

    let config: ServerConfig;
    try {
        config = JSON.parse(configString);
    } catch (error) {
        throw new Error('Invalid JSON configuration');
    }

    try {
        console.error(`Fetching connection details for package: ${packageName}`);
        const connection = await registryClient.fetchConnection(packageName, config);
        
        console.error('Server connection details retrieved:');
        console.error('- Command:', connection.command);
        if (connection.args) {
            console.error('- Arguments:', connection.args.join(' '));
        }
        if (connection.env) {
            console.error('- Environment variables:', Object.keys(connection.env).join(', '));
        }

        const { cleanup } = await createRunner(connection);
        console.error('[CLI] Server is running. Press Ctrl+C to stop.');
        await new Promise(() => {}); // Keep process alive until Ctrl+C

    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to run package: ${error.message}`);
        }
        throw error;
    }
}