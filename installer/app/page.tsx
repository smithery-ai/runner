import Greet from '@/components/greet'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between py-24 pb-4">
      <Greet />
    </main>
  )
}