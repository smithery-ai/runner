'use client'

import { useEffect } from 'react';
// import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { Anvil } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function Greet() {
  const greeting = 'Welcome to Smithery';
  const router = useRouter();

  useEffect(() => {
    // Check if we're running in Tauri
    if (typeof window !== 'undefined') {
      getVersion()
        .then(() => {
          // We're in Tauri
          console.log('Running in Tauri')
        })
        .catch(() => {
          // We're not in Tauri
          console.log('Not running in Tauri')
        })
    }
  }, [])

  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-3xl font-medium">{greeting}</h1>
      <p className="text-gray-500 text-xl">
        Let&apos;s get you up and running with<br />
        MCP servers without worrying about dependencies.
      </p>
      <button 
        onClick={() => router.push('/install')} 
        className="mt-4 px-8 py-2 text-white rounded-md text-xl bg-orange-500"
      >
        Next
      </button>
      <Anvil className="w-64 h-64 text-orange-500 mt-0 stroke-[0.5]" />
    </div>
  );
}