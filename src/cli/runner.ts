import { 
    StdioClientTransport, 
    getDefaultEnvironment 
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioConnection } from "./types/registry";
import {
	type JSONRPCMessage,
	type JSONRPCError,
	ErrorCode,
} from "@modelcontextprotocol/sdk/types.js"

type RunnerState = {
    transport: StdioClientTransport | null;
    isReady: boolean;
    stdinBuffer: string;
}

/* 
do not use any defaults.
find common defaults used, and do a custom setting of it
*/

async function ensurePodmanMachineRunning() {
    // Only needed for Windows/macOS
    if (process.platform === 'linux') return;

    try {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        const { stdout } = await execAsync('podman machine list --format json');
        const machines = JSON.parse(stdout);
        
        // Custom machine name for our application
        const machineName = 'smithery-vm';

        // Check if our machine exists
        const ourMachine = machines.find((m: any) => m.Name === machineName);
        
        if (!ourMachine) {
            console.error(`[Runner] Initializing new Podman machine '${machineName}'...`);
            // Use the machine name as a positional argument
            await execAsync(`podman machine init ${machineName}`);
            console.error(`[Runner] Starting new Podman machine '${machineName}'...`);
            await execAsync(`podman machine start ${machineName}`);
            console.error(`[Runner] Podman machine '${machineName}' initialized and started successfully`);
        } else if (!ourMachine.Running) {
            console.error(`[Runner] Starting Podman machine '${machineName}'...`);
            await execAsync(`podman machine start ${machineName}`);
            console.error(`[Runner] Podman machine '${machineName}' started successfully`);
        }
        
        // Set our machine as the active connection
        console.error(`[Runner] Setting '${machineName}' as the active Podman machine...`);
        await execAsync(`podman system connection default ${machineName}`);
        
        // Verify the machine is operational by running a simple command
        console.error(`[Runner] Verifying Podman machine connection...`);
        
        // Retry mechanism for Podman connection
        let connected = false;
        let retries = 0;
        const maxRetries = 5;
        
        while (!connected && retries < maxRetries) {
            try {
                // Use the explicit machine name for verification
                await execAsync(`podman --connection ${machineName} info`);
                connected = true;
                console.error(`[Runner] Successfully connected to Podman machine '${machineName}'`);
            } catch (error) {
                retries++;
                console.error(`[Runner] Waiting for Podman connection to '${machineName}' (attempt ${retries}/${maxRetries})...`);
                // Wait 2 seconds before retrying
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        if (!connected) {
            throw new Error(`Failed to connect to Podman machine '${machineName}' after multiple attempts`);
        }
    } catch (error) {
        console.error("[Runner] Error checking/starting Podman machine:", error);
        throw new Error("Failed to ensure Podman machine is running");
    }
}

async function handleContainerPull(command: string, args: string[]) {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    // Find the image name in the arguments
    let imageIndex = -1;
    if (args.includes('pull')) {
        imageIndex = args.indexOf('pull') + 1;
    } else if (args.includes('run')) {
        // For run commands, find the image argument (typically after options)
        // Options that take arguments and should be skipped along with their values
        const optionsWithArgs = ['--mount', '-v', '--volume', '-e', '--env', '-p', '--publish', '--name'];
        
        let skipNext = false;
        for (let i = args.indexOf('run') + 1; i < args.length; i++) {
            if (skipNext) {
                skipNext = false;
                continue;
            }
            
            const arg = args[i];
            
            // Skip option flags and their values
            if (arg.startsWith('-')) {
                // If this is an option that takes an argument, skip the next item too
                if (optionsWithArgs.includes(arg)) {
                    skipNext = true;
                }
                continue;
            }
            
            // First non-option argument should be the image
            imageIndex = i;
            break;
        }
    }
    
    if (imageIndex === -1 || imageIndex >= args.length) {
        console.error("[Runner] Could not identify image in command arguments");
        return { command, args }; // Return unchanged
    }
    
    const imageName = args[imageIndex];
    console.error(`[Runner] Found image name: ${imageName}`);
    
    // Skip pull attempt if the "image" looks like a mount option
    if (imageName.includes('type=bind') || imageName.includes('src=')) {
        console.error("[Runner] Skipping pull for what appears to be a mount option, not an image");
        return { command, args };
    }
    
    // If the image doesn't already have a registry specified, prefix it with docker.io
    let pullImageName = imageName;
    if (!imageName.includes('/') || 
        (!imageName.includes('.') && !imageName.includes(':') && imageName.split('/').length < 3)) {
        pullImageName = `docker.io/${imageName}`;
        console.error(`[Runner] Overriding registry: Prefixing image ${imageName} with docker.io/`);
    } else {
        console.error(`[Runner] Image ${imageName} already has a registry specified`);
    }
    
    console.error(`[Runner] Attempting to pull image: ${pullImageName}`);
    
    try {
        // Try normal pull first
        await execAsync(`${command} pull ${pullImageName}`);
        console.error(`[Runner] Successfully pulled image: ${pullImageName}`);
        return { command, args }; // Return unchanged if successful
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Runner] Error pulling image with existing credentials: ${errorMessage}`);
        console.error("[Runner] Attempting anonymous pull...");
        
        try {
            // Configure for anonymous pull
            await configureContainerCredentials();
            
            // Try anonymous pull
            await execAsync(`${command} pull ${pullImageName}`);
            console.error(`[Runner] Successfully pulled image anonymously: ${pullImageName}`);
            return { command, args }; // Return unchanged
        } catch (anonError: unknown) {
            const errorMessage = anonError instanceof Error ? anonError.message : String(anonError);
            console.error(`[Runner] Anonymous pull also failed: ${errorMessage}`);
            console.error("[Runner] Trying explicit logout and pull...");
            
            try {
                // Try explicit logout
                await execAsync(`${command} logout docker.io`);
                console.error("[Runner] Successfully logged out from Docker Hub");
                
                // Try pull after logout
                await execAsync(`${command} pull ${pullImageName}`);
                console.error(`[Runner] Successfully pulled image after logout: ${pullImageName}`);
                return { command, args }; // Return unchanged if successful
            } catch (logoutError: unknown) {
                const logoutErrorMsg = logoutError instanceof Error ? logoutError.message : String(logoutError);
                console.error(`[Runner] Pull after logout also failed: ${logoutErrorMsg}`);
                // Continue with original command, it might work in the context of run
                return { command, args };
            }
        }
    }
}

async function configureContainerCredentials() {
    try {
        console.error("[Runner] Configuring container credentials for anonymous pulls...");
        
        const fs = require('fs');
        const path = require('path');
        
        // Determine the correct config path based on OS
        let configPath;
        if (process.platform === 'win32') {
            configPath = path.join(process.env.USERPROFILE || '', '.config', 'containers');
        } else {
            configPath = path.join(process.env.HOME || '', '.config', 'containers');
        }
        
        // Ensure directory exists
        if (!fs.existsSync(configPath)) {
            fs.mkdirSync(configPath, { recursive: true });
        }
        
        // Create a proper auth.json file that disables credential helpers
        // Format follows the containers-auth.json(5) specification
        const authConfig = {
            "auths": {
                "docker.io": {
                    "auth": ""
                }
            },
            // Disable credential helpers
            "credHelpers": {},
            // Empty string disables the credential store
            "credsStore": ""
        };
        
        // Write the auth.json file
        const authFilePath = path.join(configPath, 'auth.json');
        fs.writeFileSync(authFilePath, JSON.stringify(authConfig, null, 2));
        
        console.error(`[Runner] Container credentials configured for anonymous pulls at ${authFilePath}`);
        return true;
    } catch (error) {
        console.error("[Runner] Warning: Failed to configure container credentials:", error);
        return false;
    }
}

function setupEventHandlers(state: RunnerState) {
    if (!state.transport) return;

    state.transport.onmessage = (message: JSONRPCMessage) => {
        try {
            if ("error" in message) {
                const errorMessage = message as JSONRPCError;
                if (errorMessage.error?.code !== ErrorCode.MethodNotFound) {
                    console.error(`[Runner] Child process error:`, errorMessage.error);
                }
            }
            process.stdout.write(JSON.stringify(message) + "\n");
        } catch (error) {
            console.error("[Runner] Error handling message:", error);
        }
    };

    state.transport.onclose = () => {
        console.error("[Runner] Child process terminated");
        if (state.isReady) {
            console.error("[Runner] Process terminated unexpectedly while running");
            process.exit(1);
        }
        process.exit(0);
    };

    state.transport.onerror = (err) => {
        console.error("[Runner] Child process error:", err.message);
        if (err.message.includes("spawn")) {
            console.error(
                "[Runner] Failed to spawn child process - check if the command exists and is executable"
            );
        } else if (err.message.includes("permission")) {
            console.error("[Runner] Permission error when running child process");
        }
        process.exit(1);
    };

    process.on("SIGINT", () => cleanup(state));
    process.on("SIGTERM", () => cleanup(state));
}

async function cleanup(state: RunnerState) {
    console.error("[Runner] Starting cleanup...");
    if (state.transport) {
        await state.transport.close();
        state.transport = null;
    }
    console.error("[Runner] Cleanup completed");
    process.exit(0);
}

async function send(state: RunnerState, message: JSONRPCMessage) {
    if (!state.transport || !state.isReady) {
        throw new Error("Transport not ready");
    }
    await state.transport.send(message);
}

async function processMessage(state: RunnerState, data: Buffer) {
    state.stdinBuffer += data.toString("utf8");

    if (!state.isReady) return;

    const lines = state.stdinBuffer.split(/\r?\n/);
    state.stdinBuffer = lines.pop() ?? "";

    for (const line of lines.filter(Boolean)) {
        try {
            const message = JSON.parse(line) as JSONRPCMessage;
            await send(state, message);
        } catch (error) {
            console.error("[Runner] Failed to send message to child process:", error);
        }
    }
}

async function createRunner(connection: StdioConnection) {
    const state: RunnerState = {
        transport: null,
        isReady: false,
        stdinBuffer: ""
    };

    console.error("[Runner] Starting child process...");
    
    const { command, args = [], env = {} } = connection;

    let finalCommand = command;
    let finalArgs = args;

    if (command === 'docker' || command === 'podman') {
        if (command === 'docker') {
            finalCommand = 'podman';
        }
        await ensurePodmanMachineRunning();
        
        // Handle pull commands with fallback to anonymous
        if (args.includes('pull') || args.includes('run')) {
            const result = await handleContainerPull(finalCommand, finalArgs);
            finalCommand = result.command;
            finalArgs = result.args;
        }
        
        // Force the use of Docker Hub registry instead of user's default registry
        if (finalArgs.includes('pull') || finalArgs.includes('run')) {
            // For pull and run commands, we need to ensure the image is pulled from docker.io
            const pullIndex = finalArgs.indexOf('pull');
            const runIndex = finalArgs.indexOf('run');
            const commandIndex = Math.max(pullIndex, runIndex);
            
            if (commandIndex !== -1) {
                // Find the image argument - it's typically the first non-option argument after 'run'
                // that doesn't follow certain option flags that take arguments
                let imageArgIndex = -1;
                let skipNext = false;
                
                // Options that take arguments and should be skipped along with their values
                const optionsWithArgs = ['--mount', '-v', '--volume', '-e', '--env', '-p', '--publish', '--name'];
                
                for (let i = commandIndex + 1; i < finalArgs.length; i++) {
                    if (skipNext) {
                        skipNext = false;
                        continue;
                    }
                    
                    const arg = finalArgs[i];
                    
                    // Skip option flags and their values
                    if (arg.startsWith('-')) {
                        // If this is an option that takes an argument, skip the next item too
                        if (optionsWithArgs.includes(arg)) {
                            skipNext = true;
                        }
                        continue;
                    }
                    
                    // First non-option argument should be the image
                    imageArgIndex = i;
                    break;
                }
                
                if (imageArgIndex !== -1) {
                    const imageName = finalArgs[imageArgIndex];
                    console.error(`[Runner] Found image name: ${imageName}`);
                    
                    // If the image doesn't already have a registry specified, prefix it with docker.io
                    if (!imageName.includes('/') || 
                        (!imageName.includes('.') && !imageName.includes(':') && imageName.split('/').length < 3)) {
                        console.error(`[Runner] Overriding registry: Prefixing image ${imageName} with docker.io/`);
                        finalArgs[imageArgIndex] = `docker.io/${imageName}`;
                    } else {
                        console.error(`[Runner] Image ${imageName} already has a registry specified`);
                    }
                } else {
                    console.error(`[Runner] No image argument found after ${finalArgs[commandIndex]} command`);
                }
            } else {
                console.error(`[Runner] No registry override needed for this command`);
            }
        } else {
            console.error(`[Runner] No registry override needed for this command`);
        }
    }

    console.error("[Runner] Executing:", {
        command: finalCommand,
        args: finalArgs,
    });

    state.transport = new StdioClientTransport({
        command: finalCommand,
        args: finalArgs,
        env: { ...getDefaultEnvironment(), ...env },
    });

    setupEventHandlers(state);
    await state.transport.start();
    state.isReady = true;

    process.stdin.on("data", (data) =>
        processMessage(state, data).catch((error) =>
            console.error("[Runner] Error processing message:", error)
        )
    );

    return {
        send: (message: JSONRPCMessage) => send(state, message),
        cleanup: () => cleanup(state)
    };
}

export { createRunner }; 