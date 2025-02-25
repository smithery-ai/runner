'use client'

import InstallCLI from '@/components/install-cli'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function InstallPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24 bg-[#111] text-gray-200">
      <div className="absolute top-4 left-4">
        <Link href="/" className="flex items-center gap-1 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-gray-200 transition-colors">
          <ArrowLeft size={16} />
          <span>Back</span>
        </Link>
      </div>
      <InstallCLI />
    </main>
  )
} 