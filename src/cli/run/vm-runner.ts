import { 
    StdioClientTransport, 
    getDefaultEnvironment 
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StdioConnection } from "../../types/registry"
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

async function ensurePodmanMachineRunning() {
    // Only needed for Windows/macOS
    if (process.platform === 'linux') return;

    try {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        const { stdout } = await execAsync('podman machine list --format json');
        const machines = JSON.parse(stdout);

        if (!machines.length) {
            console.error("[Runner] Initializing new Podman machine...");
            await execAsync('podman machine init');
            console.error("[Runner] Starting new Podman machine...");
            await execAsync('podman machine start');
            console.error("[Runner] Podman machine initialized and started successfully");
        } else if (!machines.some((m: any) => m.Running)) {
            console.error("[Runner] Starting Podman machine...");
            await execAsync('podman machine start');
            console.error("[Runner] Podman machine started successfully");
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