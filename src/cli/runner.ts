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