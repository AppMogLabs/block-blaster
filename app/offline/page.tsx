import { Logo } from "@/components/ui/Logo";

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <Logo size={72} />
        <h1 className="text-3xl font-bold mt-6">You're offline</h1>
        <p className="text-moon-white/60 mt-3">
          You need to be online to play Block Blaster — the chain doesn't wait.
        </p>
      </div>
    </main>
  );
}
