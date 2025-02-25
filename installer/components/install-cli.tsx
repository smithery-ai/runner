'use client'

import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'

type InstallStatus = 'idle' | 'checking' | 'installing-cli' | 'installing-podman' | 'success' | 'error' | 'podman-missing'

export default function InstallCLI() {
  const [status, setStatus] = useState<InstallStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  // const [podmanVersion, setPodmanVersion] = useState('')

  // Get platform-specific installation command
  const getPodmanInstallCommand = () => {
    const userAgent = navigator.userAgent.toLowerCase()
    if (userAgent.includes('mac') || userAgent.includes('darwin')) {
      return 'brew install podman'
    } else if (userAgent.includes('win')) {
      return 'winget install RedHat.Podman'
    } else {
      return 'sudo apt-get install -y podman'
    }
  }

  const checkPodman = async () => {
    try {
      setStatus('checking')
      await invoke<string>('check_podman_installed')
      // Podman is installed, proceed to CLI installation
      installCLI()
    } catch (error) {
      // Podman is not installed
      setStatus('podman-missing')
      setErrorMsg(`Podman is required but not installed: ${error}`)
    }
  }

  const installPodman = async () => {
    try {
      setStatus('installing-podman')
      await invoke('install_podman')
      // After installing podman, proceed to CLI installation
      installCLI()
    } catch (error) {
      setStatus('error')
      setErrorMsg(`Failed to install Podman: ${error}`)
    }
  }

  const installCLI = async () => {
    try {
      setStatus('installing-cli')
      await invoke('install_cli_binary')
      setStatus('success')
    } catch (error) {
      setStatus('error')
      const errorStr = String(error)
      // Format user-friendly error message
      setErrorMsg(
        errorStr.includes('User cancelled') 
          ? 'Installation cancelled - admin access is required'
          : errorStr
      )
    }
  }

  const handleInstall = async () => {
    // First check if podman is installed
    await checkPodman()
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-medium">Install Smithery</h1>
      
      <div className="mt-8 font-mono text-3xl bg-zinc-950 p-6 rounded-lg w-[300px]">
        <span className="text-gray-300">&gt;</span>
        <span className="text-gray-300"> smithery</span>
      </div>

      {status === 'installing-podman' && (
        <div className="mt-4 font-mono text-sm bg-zinc-950 p-4 rounded-lg w-[400px] text-left">
          <p className="text-green-400">$ {getPodmanInstallCommand()}</p>
          <p className="text-gray-300 mt-1">Installing Podman...</p>
          <div className="mt-2 flex items-center">
            <div className="animate-spin h-4 w-4 border-2 border-orange-500 rounded-full border-t-transparent"></div>
            <span className="ml-2 text-orange-400">This may take a few minutes</span>
          </div>
        </div>
      )}

      {status === 'podman-missing' ? (
        <div className="mt-4 p-4 bg-yellow-900/30 border border-yellow-700 rounded-md max-w-md">
          <p className="text-yellow-300 mb-2">Podman is required but not installed</p>
          <p className="text-sm text-gray-300 mb-4">
            Smithery uses Podman to run containers. Would you like to install it now?
          </p>
          <div className="flex gap-3 justify-center">
            <button 
              onClick={installPodman}
              className="px-4 py-1 bg-orange-500 hover:bg-orange-600 rounded-md"
            >
              Install Podman
            </button>
            <button 
              onClick={() => setStatus('idle')}
              className="px-4 py-1 bg-gray-700 hover:bg-gray-600 rounded-md"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button 
          onClick={handleInstall}
          disabled={status === 'checking' || status === 'installing-cli' || status === 'installing-podman' || status === 'success'}
          className={`mt-10 px-8 py-2 text-white rounded-md text-xl ${
            status === 'success' 
              ? 'bg-green-500' 
              : ['checking', 'installing-cli', 'installing-podman'].includes(status)
              ? 'bg-orange-400'
              : 'bg-orange-500'
          }`}
        >
          {status === 'success' 
            ? 'Installed!' 
            : status === 'checking'
            ? 'Checking requirements...'
            : status === 'installing-podman'
            ? 'Installing Podman...'
            : status === 'installing-cli'
            ? 'Installing CLI...'
            : 'Install'}
        </button>
      )}

      <p className="text-sm">
        {status === 'error' ? (
          <span className="text-red-500">
            {errorMsg}
            <br />
            <button 
              onClick={() => setStatus('idle')} 
              className="text-orange-500 hover:text-orange-600 mt-2"
            >
              Try again
            </button>
          </span>
        ) : (
          <span className="text-gray-500">
            You will be prompted for<br />administrator access
          </span>
        )}
      </p>
    </div>
  );
} 