import { runCommand, installCommand } from './commands';

async function main() {
    try {
        const args = process.argv.slice(2);
        const command = args[0];

        switch (command) {
            case 'run':
                await runCommand(args.slice(1));
                break;
            case 'install':
                await installCommand(args.slice(1));
                break;
            case '--help':
            case '-h':
                showHelp();
                break;
            default:
                console.error('Unknown command. Use --help for usage information.');
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
Smithery MCP Runner

Usage:
  smithery run <package> --config <JSON>     Run a server with given configuration
  smithery install <package> --client <client>   Install a package for a specific client
  smithery install <package> <client>            Alternative install syntax
  smithery --help                           Show this help message
`);
}

main(); 