'use client'

import { invoke } from '@tauri-apps/api/core'
import { useState } from 'react'

export default function InstallCLI() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleInstall = async () => {
    try {
      setStatus('loading')
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

  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-medium">Install the command line</h1>
      
      <div className="mt-8 font-mono text-3xl bg-zinc-950 p-6 rounded-lg w-[300px]">
        <span className="text-gray-300">&gt;</span>
        <span className="text-gray-300"> smithery</span>
      </div>

      <button 
        onClick={handleInstall}
        disabled={status === 'loading' || status === 'success'}
        className={`mt-10 px-8 py-2 text-white rounded-md text-xl ${
          status === 'success' 
            ? 'bg-green-500' 
            : status === 'loading' 
            ? 'bg-orange-400'
            : 'bg-orange-500'
        }`}
      >
        {status === 'success' 
          ? 'Installed!' 
          : status === 'loading' 
          ? 'Installing...' 
          : 'Install'}
      </button>

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