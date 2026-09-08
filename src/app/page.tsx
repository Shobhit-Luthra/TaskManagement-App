import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-semibold">Kanbo</h1>
      <p className="text-muted-foreground">A real-time Kanban board for small teams.</p>
      <div className="flex gap-3">
        <Link href="/signup" className="underline">Sign up</Link>
        <Link href="/login" className="underline">Sign in</Link>
      </div>
    </main>
  );
}
