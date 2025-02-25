/* remove punycode depreciation warning */
process.removeAllListeners("warning")
process.on("warning", (warning) => {
	if (
		warning.name === "DeprecationWarning" &&
		warning.message.includes("punycode")
	) {
		return
	}
	console.warn(warning)
})

import type { ValidClient } from "./constants"
import type { ConfiguredServer } from "./types/registry"
import {
	collectConfigValues,
	promptForRestart,
	normalizeServerId,
} from "./utils"
import { readConfig, writeConfig } from "./client-config"
import { resolvePackage } from "./registry"
import chalk from "chalk"
import { chooseConnection } from "./utils"
import ora from "ora"

function formatServerConfig(
	qualifiedName: string,
	userConfig: Record<string, unknown>,
): ConfiguredServer {
	/* double stringify config to make it shell-safe */
	const encodedConfig = JSON.stringify(JSON.stringify(userConfig))

	return {
		command: "smithery",
		args: [
			"run",
			qualifiedName,
			"--config",
			encodedConfig,
		],
	}
}

/* installs server for given client */
export async function installServer(
	qualifiedName: string,
	client: ValidClient,
): Promise<void> {
	/* start resolving in background */
	const serverPromise = resolvePackage(qualifiedName)

	const spinner = ora(`Resolving ${qualifiedName}...`).start()
	try {
		const server = await serverPromise
		spinner.succeed(`Successfully resolved ${qualifiedName}`)

		const connection = chooseConnection(server)

		/* inform users of remote server installation */
		const remote = server.connections.some(
			(conn) => conn.type === "ws" && "deploymentUrl" in conn,
		)
		if (remote) {
			console.log(
				chalk.blue(
					`Installing remote server. Please ensure you trust the server author, especially when sharing sensitive data.\nFor information on Smithery's data policy, please visit: ${chalk.underline("https://smithery.ai/docs/data-policy")}`,
				),
			)
		}

		/* collect config values from user */
		const configValues = await collectConfigValues(connection)
		const serverConfig = formatServerConfig(qualifiedName, configValues)

		/* read config from client */
		const config = readConfig(client)
		const normalizedName = normalizeServerId(qualifiedName)
		config.mcpServers[normalizedName] = serverConfig
		writeConfig(config, client)
		console.log(
			chalk.green(`${qualifiedName} successfully installed for ${client}`),
		)
		await promptForRestart(client)
	} catch (error) {
		spinner.fail(`Failed to install ${qualifiedName}`)
		if (error instanceof Error) {
			console.error(chalk.red(`Error: ${error.message}`))
		} else {
			console.error(chalk.red('An unexpected error occurred during installation'))
		}
		process.exit(1)
	}
} 