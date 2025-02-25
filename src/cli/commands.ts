import { fetchConnection } from './registry';
import { ServerConfig } from './types/registry';
import { createRunner } from './runner';
import { installServer } from './install';
import { VALID_CLIENTS, ValidClient } from './constants';

export async function runCommand(args: string[]) {
    if (args.length < 2 || args[1] !== '--config') {
        throw new Error('Missing required --config parameter');
    }

    const packageName = args[0];
    const configString = args[2];

    let config: ServerConfig;
    try {
        config = JSON.parse(configString);
        // Handle case where config might be a JSON string itself
        if (typeof config === "string") {
            config = JSON.parse(config);
        }
    } catch (error) {
        throw new Error('Invalid JSON configuration');
    }

    try {
        console.error(`Fetching connection details for package: ${packageName}`);
        const connection = await fetchConnection(packageName, config);
        
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

export async function installCommand(args: string[]) {
    if (args.length < 1) {
        throw new Error('Missing required package name. Usage: smithery install <package> --client <client>');
    }

    const packageName = args[0];
    let client: ValidClient;
    
    // Check if using --client flag format
    const clientFlagIndex = args.indexOf('--client');
    if (clientFlagIndex !== -1 && args.length > clientFlagIndex + 1) {
        const clientInput = args[clientFlagIndex + 1];
        
        // Validate and cast the client type
        if (!VALID_CLIENTS.includes(clientInput as any)) {
            throw new Error(`Invalid client: ${clientInput}. Valid clients are: ${VALID_CLIENTS.join(', ')}`);
        }
        
        client = clientInput as ValidClient;
    } else if (args.length > 1 && !args[1].startsWith('--')) {
        // Original format: smithery install <package> <client>
        const clientInput = args[1];
        
        // Validate and cast the client type
        if (!VALID_CLIENTS.includes(clientInput as any)) {
            throw new Error(`Invalid client: ${clientInput}. Valid clients are: ${VALID_CLIENTS.join(', ')}`);
        }
        
        client = clientInput as ValidClient;
    } else {
        throw new Error('Missing required client. Usage: smithery install <package> --client <client> or smithery install <package> <client>');
    }
    
    try {
        await installServer(packageName, client);
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to install package: ${error.message}`);
        }
        throw error;
    }
}