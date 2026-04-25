export default function HomePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-text-3 text-xs tracking-widest uppercase font-semibold">World Shaker</p>
        <h1 className="font-serif text-4xl leading-tight">
          Your AI clone is <span className="italic text-accent-warm">awkward.</span>
        </h1>
        <p className="text-text-2">
          Scaffold ready. UX implementation pending — see /supabase/migrations and /app/api for
          backend foundations.
        </p>
        <p className="text-text-3 text-sm font-mono">Set NEXT_PUBLIC_WORLD_APP_ID and start dev.</p>
      </div>
    </main>
  );
}
